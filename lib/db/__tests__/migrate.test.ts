import { describe, expect, it } from 'vitest';

import { createMemoryDb } from '@/lib/db/client';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from '@/lib/db/migrate';

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

  it('pins UTC so snapshot_date does not drift by host timezone', async () => {
    const db = await createMemoryDb();
    const result = await db.query<{ TimeZone: string }>('SHOW timezone');
    expect(result.rows[0]?.TimeZone).toBe('UTC');
  });

  it('mints exactly one local identity', async () => {
    const db = await createMemoryDb();
    const result = await db.query<{ user_id: string }>('SELECT user_id FROM local_identity');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.user_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('enforces the transaction discriminant constraints', async () => {
    const db = await createMemoryDb();
    const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM local_identity');
    const userId = rows[0]!.user_id;

    // REWARD_EARN without a reference transaction is exactly what the old
    // query-builder mocks accepted without complaint.
    await expect(
      db.query(
        `INSERT INTO transactions (user_id, type, amount, reward_currency, to_account, transaction_date)
         VALUES ($1, 'REWARD_EARN', 10, 'MR', NULL, now())`,
        [userId],
      ),
    ).rejects.toThrow();
  });

  describe('schema constraints', () => {
    async function ctx() {
      const db = await createMemoryDb();
      const { rows } = await db.query<{ user_id: string }>(
        'SELECT user_id FROM local_identity',
      );
      return { db, userId: rows[0]!.user_id };
    }

    it('rejects shares on a non-SHARE account', async () => {
      const { db, userId } = await ctx();
      await expect(
        db.query(
          `INSERT INTO accounts (user_id, name, type, currency, shares)
           VALUES ($1, 'Cash', 'ASSET', 'USD', 5)`,
          [userId],
        ),
      ).rejects.toThrow();
    });

    it('rejects a transfer to the same account', async () => {
      const { db, userId } = await ctx();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO accounts (user_id, name, type, currency)
         VALUES ($1, 'Cash', 'ASSET', 'USD') RETURNING id`,
        [userId],
      );
      const id = rows[0]!.id;

      await expect(
        db.query(
          `INSERT INTO transactions
             (user_id, type, amount, currency, from_account, to_account, transaction_date)
           VALUES ($1, 'TRANSFER', 10, 'USD', $2, $2, CURRENT_DATE)`,
          [userId, id],
        ),
      ).rejects.toThrow();
    });

    it('rejects a JSON scalar in a JSONB object column', async () => {
      const { db, userId } = await ctx();
      await expect(
        db.query(
          `INSERT INTO accounts (user_id, name, type, currency, spend_stats)
           VALUES ($1, 'Cash', 'ASSET', 'USD', '"oops"'::jsonb)`,
          [userId],
        ),
      ).rejects.toThrow();
    });

    it('only touches updated_at when the row actually changes', async () => {
      const { db, userId } = await ctx();
      // Seed a stale date via INSERT — the trigger is BEFORE UPDATE, so it does
      // not interfere here.
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO accounts (user_id, name, type, currency, updated_at)
         VALUES ($1, 'Cash', 'ASSET', 'USD', '2020-01-01') RETURNING id`,
        [userId],
      );
      const id = rows[0]!.id;

      const readDate = async () =>
        (
          await db.query<{ updated_at: string }>(
            'SELECT updated_at FROM accounts WHERE id = $1',
            [id],
          )
        ).rows[0]?.updated_at;

      // Same value written back: the WHEN guard stops the trigger firing.
      await db.query("UPDATE accounts SET name = 'Cash' WHERE id = $1", [id]);
      expect(await readDate()).toBe('2020-01-01');

      // A real change does move it.
      await db.query("UPDATE accounts SET name = 'Renamed' WHERE id = $1", [id]);
      expect(await readDate()).not.toBe('2020-01-01');
    });
  });
});
