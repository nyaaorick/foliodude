import type { PGlite } from '@electric-sql/pglite';

import { createMemoryDb } from './client';
import type { SessionContext } from './session';

/**
 * A fully migrated in-memory database plus its local user id.
 *
 * Tests run against real Postgres rather than a mocked query builder, so the
 * CHECK constraints in 001_init actually execute — a malformed reward row fails
 * the test instead of being silently accepted by a mock.
 */
export async function createTestContext(): Promise<SessionContext & { db: PGlite }> {
  const db = await createMemoryDb();
  const result = await db.query<{ user_id: string }>(
    'SELECT user_id FROM local_identity WHERE singleton',
  );
  return { db, userId: result.rows[0]!.user_id };
}

type AccountSeed = {
  id?: string;
  name?: string;
  type?: 'ASSET' | 'LIABILITY' | 'AIRLINE_MILES' | 'SHARE';
  currency?: string;
  balance?: number;
  [column: string]: unknown;
};

/** Insert an account with sensible defaults; returns its id. */
export async function seedAccount(
  { db, userId }: SessionContext,
  seed: AccountSeed = {},
): Promise<string> {
  const row: Record<string, unknown> = {
    user_id: userId,
    name: 'Test account',
    type: 'ASSET',
    currency: 'USD',
    balance: 0,
    ...seed,
  };

  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const values = columns.map((column) => {
    const value = row[column];
    return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  });

  const result = await db.query<{ id: string }>(
    `INSERT INTO accounts (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0]!.id;
}

/** Every transaction, oldest first — the order assertions read most naturally in. */
export async function allTransactions(db: PGlite): Promise<Record<string, unknown>[]> {
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM transactions ORDER BY seq',
  );
  return result.rows;
}

export async function getAccount(db: PGlite, id: string): Promise<Record<string, unknown>> {
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM accounts WHERE id = $1',
    [id],
  );
  return result.rows[0]!;
}
