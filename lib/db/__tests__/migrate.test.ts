import { describe, expect, it } from 'vitest';

import { createMemoryDb } from '@/lib/db/client';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from '@/lib/db/migrate';
import { AIRLINE_PROGRAM_IDS } from '@/lib/types/mileage';

describe('migrations', () => {
  it('applies every migration and records the version', async () => {
    const db = await createMemoryDb();

    const applied = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM schema_version ORDER BY id',
    );
    // Derived from the list rather than hard-coded, so appending a migration
    // does not mean editing this assertion.
    expect(applied.rows.map((row) => row.id)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(applied.rows.map((row) => row.name)).toEqual(MIGRATIONS.map((m) => m.name));
    expect(applied.rows.at(-1)?.id).toBe(LATEST_SCHEMA_VERSION);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const db = await createMemoryDb();
    expect(await runMigrations(db)).toBe(0);
  });

  it('pins UTC so timestamptz text parses the same on every host', async () => {
    const db = await createMemoryDb();
    const result = await db.query<{ TimeZone: string }>('SHOW timezone');
    expect(result.rows[0]?.TimeZone).toBe('UTC');
  });

  it('knows every airline program the app offers', async () => {
    const db = await createMemoryDb();
    const result = await db.query<{ value: string }>(
      `SELECT unnest(enum_range(NULL::airline_program_type))::text AS value`,
    );
    expect(result.rows.map((row) => row.value).sort()).toEqual([...AIRLINE_PROGRAM_IDS].sort());
  });

  describe('schema constraints', () => {
    async function insertAccount(db: Awaited<ReturnType<typeof createMemoryDb>>, type: string) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO accounts (name, type, currency) VALUES ('Acct', $1, 'USD') RETURNING id`,
        [type],
      );
      return rows[0]!.id;
    }

    it('rejects a details row on an account of a different type', async () => {
      const db = await createMemoryDb();
      const cash = await insertAccount(db, 'ASSET');

      await expect(
        db.query(
          `INSERT INTO mileage_details (account_id, airline_program) VALUES ($1, 'KRISFLYER')`,
          [cash],
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('refuses to delete a brokerage that still has a position, and cascades details with their account', async () => {
      const db = await createMemoryDb();
      const cash = await insertAccount(db, 'ASSET');
      const share = await insertAccount(db, 'SHARE');
      await db.query(
        `INSERT INTO share_details (account_id, brokerage_account_id, ticker) VALUES ($1, $2, 'AAPL')`,
        [share, cash],
      );

      await expect(db.query('DELETE FROM accounts WHERE id = $1', [cash])).rejects.toThrow(
        /foreign key/i,
      );

      await db.query('DELETE FROM accounts WHERE id = $1', [share]);
      const left = await db.query('SELECT 1 FROM share_details');
      expect(left.rows).toHaveLength(0);
    });

    it('enforces the transaction shape: a one-sided transfer and a reward without its expense', async () => {
      const db = await createMemoryDb();
      const cash = await insertAccount(db, 'ASSET');

      await expect(
        db.query(
          `INSERT INTO transactions (type, amount, currency, from_account, transaction_date)
           VALUES ('TRANSFER', 10, 'USD', $1, CURRENT_DATE)`,
          [cash],
        ),
      ).rejects.toThrow(/transactions_shape_check/);

      await expect(
        db.query(
          `INSERT INTO transactions (type, amount, reward_currency, to_account, transaction_date)
           VALUES ('REWARD_EARN', 10, 'MR', $1, CURRENT_DATE)`,
          [cash],
        ),
      ).rejects.toThrow(/transactions_shape_check/);
    });

    it('rejects malformed JSONB structure in reward rules', async () => {
      const db = await createMemoryDb();
      const card = await insertAccount(db, 'LIABILITY');

      await expect(
        db.query(
          `INSERT INTO liability_details (account_id, reward_currency, reward_rules)
           VALUES ($1, 'MR', '[{"category": "Dining"}]'::jsonb)`,
          [card],
        ),
      ).rejects.toThrow(/liability_reward_rules_check/);
    });

    it('only touches updated_at when the row actually changes', async () => {
      const db = await createMemoryDb();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO accounts (name, type, currency, updated_at)
         VALUES ('Cash', 'ASSET', 'USD', '2020-01-01') RETURNING id`,
      );
      const id = rows[0]!.id;

      const readYear = async () =>
        (
          await db.query<{ year: number }>(
            'SELECT extract(year FROM updated_at)::int AS year FROM accounts WHERE id = $1',
            [id],
          )
        ).rows[0]?.year;

      // Same value written back: the WHEN guard stops the trigger firing.
      await db.query("UPDATE accounts SET name = 'Cash' WHERE id = $1", [id]);
      expect(await readYear()).toBe(2020);

      // A real change does move it.
      await db.query("UPDATE accounts SET name = 'Renamed' WHERE id = $1", [id]);
      expect(await readYear()).not.toBe(2020);
    });
  });
});
