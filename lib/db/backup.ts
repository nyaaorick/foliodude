import type { PGlite } from '@electric-sql/pglite';

import { LATEST_SCHEMA_VERSION } from './migrate';
import { rows } from './sql';

/**
 * Logical snapshot of the user's ledger, for Google Drive sync (PLAN.md §5
 * Phase 4).
 *
 * **Logical, not `dumpDataDir()`.** A raw data-directory dump would be simpler,
 * but it carries the whole database — including `local_settings` rows in the
 * `apikey:` namespace, which are device-local secrets that must never leave the
 * device (PLAN §7, and the SYNC NOTE in 003_local_settings.sql). Filtering
 * those requires reading the data logically anyway, and doing so also makes the
 * snapshot an order of magnitude smaller than a Postgres data directory and
 * readable by a future version with a different page layout.
 *
 * Rows travel as `row_to_json`/`jsonb_populate_recordset` pairs, so every column
 * type — enums, jsonb, dates, numerics — round-trips through Postgres' own
 * casts rather than hand-written per-column mapping.
 */

/** Bump when the envelope shape changes incompatibly. */
export const SNAPSHOT_FORMAT_VERSION = 1;

/**
 * Ledger tables, in FK-safe insert order — parents before children.
 *
 * Order matters only *between* statements. Within one statement it does not:
 * Postgres implements foreign keys as AFTER ROW triggers that fire at end of
 * statement, so a single bulk insert satisfies `accounts.brokerage_account_id`
 * and `transactions.reference_transaction_id` pointing at rows in the same
 * batch. Nulling those columns for a second pass would be worse than
 * unnecessary — `transactions_shape_check` requires REWARD_EARN to carry its
 * `reference_transaction_id`, so a nulled first pass fails outright.
 */
const TABLES = ['accounts', 'transactions', 'reward_rates', 'net_worth_snapshots'] as const;

export interface Snapshot {
  formatVersion: number;
  schemaVersion: number;
  writerDeviceId: string;
  writerDeviceName: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
  /** `local_settings` minus the `apikey:` namespace. */
  settings: unknown[];
}

export async function buildSnapshot(
  db: PGlite,
  userId: string,
  writer: { deviceId: string; deviceName: string },
): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    const result = await rows<{ row: unknown }>(
      db,
      `SELECT row_to_json(t) AS row FROM ${table} t WHERE user_id = $1`,
      [userId],
    );
    tables[table] = result.map((entry) => entry.row);
  }

  const settings = await rows<{ row: unknown }>(
    db,
    `SELECT row_to_json(t) AS row FROM local_settings t
     WHERE user_id = $1 AND key NOT LIKE 'apikey:%'`,
    [userId],
  );

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION,
    writerDeviceId: writer.deviceId,
    writerDeviceName: writer.deviceName,
    createdAt: new Date().toISOString(),
    tables,
    settings: settings.map((entry) => entry.row),
  };
}

/**
 * Replace this device's ledger with the snapshot's, atomically.
 *
 * Destructive by design: this is whole-file snapshot sync, so the downloaded
 * state *is* the truth (PLAN §5 Phase 4, single-writer model). Running inside
 * one transaction means a failure leaves the previous ledger untouched rather
 * than half-replaced.
 *
 * Rows are re-keyed onto this device's local `user_id`. The app never learns a
 * Google account id — it only requests `drive.appdata`, not `openid` — so
 * identity stays device-local and the snapshot is simply "this user's data".
 */
export async function restoreSnapshot(
  db: PGlite,
  userId: string,
  snapshot: Snapshot,
): Promise<void> {
  if (snapshot.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `Snapshot format v${snapshot.formatVersion} is not readable by this build (v${SNAPSHOT_FORMAT_VERSION}).`,
    );
  }

  if (snapshot.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Snapshot was written by a newer FolioDude (schema v${snapshot.schemaVersion} > v${LATEST_SCHEMA_VERSION}). Update before syncing, or this restore would drop columns it cannot read.`,
    );
  }

  await db.transaction(async (tx) => {
    // Children before parents.
    for (const table of [...TABLES].reverse()) {
      await tx.query(`DELETE FROM ${table}`);
    }
    // API keys are device-local and were never in the snapshot, so they must
    // survive a restore rather than being wiped by it.
    await tx.query(`DELETE FROM local_settings WHERE key NOT LIKE 'apikey:%'`);

    for (const table of TABLES) {
      const data = snapshot.tables[table] ?? [];
      if (data.length === 0) continue;

      await tx.query(
        `INSERT INTO ${table}
         SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
        [JSON.stringify(data)],
      );

      await tx.query(`UPDATE ${table} SET user_id = $1`, [userId]);
    }

    if (snapshot.settings.length > 0) {
      await tx.query(
        `INSERT INTO local_settings
         SELECT * FROM jsonb_populate_recordset(NULL::local_settings, $1::jsonb)`,
        [JSON.stringify(snapshot.settings)],
      );
      await tx.query(`UPDATE local_settings SET user_id = $1 WHERE key NOT LIKE 'apikey:%'`, [
        userId,
      ]);
    }

    // `transactions.seq` is a BIGSERIAL restored with explicit values; without
    // advancing the sequence the next local insert reuses a taken number.
    await tx.query(
      `SELECT setval(
         pg_get_serial_sequence('transactions', 'seq'),
         COALESCE((SELECT MAX(seq) FROM transactions), 1))`,
    );
  });
}
