import type { PGlite } from '@electric-sql/pglite';

import { LATEST_SCHEMA_VERSION } from './migrate';
import { rows } from './sql';

/**
 * Logical snapshot of the user's ledger, for Google Drive sync (PLAN.md §5
 * Phase 4).
 *
 * **Logical, not `dumpDataDir()`.** A raw data-directory dump would be simpler,
 * but it carries the whole database — including `device_secrets`, the API keys
 * that must never leave the device (PLAN §7). Exporting an explicit list of
 * tables keeps them out by construction, makes the snapshot an order of
 * magnitude smaller than a Postgres data directory, and readable by a future
 * version with a different page layout.
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
 * statement, so a single bulk insert satisfies `share_details.brokerage_account_id`
 * and `transactions.reference_transaction_id` pointing at rows in the same
 * batch.
 */
const TABLES = [
  'accounts',
  'liability_details',
  'mileage_details',
  'share_details',
  'transactions',
  'reward_rates',
  'net_worth_snapshots',
] as const;

export interface Snapshot {
  formatVersion: number;
  schemaVersion: number;
  writerDeviceId: string;
  writerDeviceName: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

export async function buildSnapshot(
  db: PGlite,
  writer: { deviceId: string; deviceName: string },
): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    const result = await rows<{ row: unknown }>(db, `SELECT row_to_json(t) AS row FROM ${table} t`);
    tables[table] = result.map((entry) => entry.row);
  }

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    schemaVersion: LATEST_SCHEMA_VERSION,
    writerDeviceId: writer.deviceId,
    writerDeviceName: writer.deviceName,
    createdAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Replace this device's ledger with the snapshot's, atomically.
 *
 * Destructive by design: this is whole-file snapshot sync, so the downloaded
 * state *is* the truth (PLAN §5 Phase 4, single-writer model). Running inside
 * one transaction means a failure leaves the previous ledger untouched rather
 * than half-replaced. `device_secrets` is not in TABLES, so this device's API
 * keys survive a restore.
 */
export async function restoreSnapshot(db: PGlite, snapshot: Snapshot): Promise<void> {
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

    for (const table of TABLES) {
      const data = snapshot.tables[table] ?? [];
      if (data.length === 0) continue;

      await tx.query(
        `INSERT INTO ${table}
         SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
        [JSON.stringify(data)],
      );
    }

    // `transactions.seq` is an identity column restored with explicit values;
    // without advancing its sequence the next local insert reuses a taken number.
    await tx.query(
      `SELECT setval(
         pg_get_serial_sequence('transactions', 'seq'),
         COALESCE((SELECT MAX(seq) FROM transactions), 1))`,
    );
  });
}
