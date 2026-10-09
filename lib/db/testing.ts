import type { PGlite } from '@electric-sql/pglite';

import { createMemoryDb } from './client';
import type { SessionContext } from './session';

/**
 * A fully migrated in-memory database.
 *
 * Tests run against real Postgres rather than a mocked query builder, so the
 * CHECK constraints in 001_init actually execute — a malformed reward row fails
 * the test instead of being silently accepted by a mock.
 */
export async function createTestContext(): Promise<SessionContext & { db: PGlite }> {
  return { db: await createMemoryDb() };
}

type AccountSeed = {
  id?: string;
  name?: string;
  type?: 'ASSET' | 'LIABILITY' | 'AIRLINE_MILES' | 'SHARE';
  currency?: string;
  balance?: number;
  [column: string]: unknown;
};

const BASE_COLUMNS = ['id', 'name', 'type', 'currency', 'balance', 'apy'];
const DETAIL_TABLE = {
  LIABILITY: 'liability_details',
  AIRLINE_MILES: 'mileage_details',
  SHARE: 'share_details',
} as const;

function jsonParam(value: unknown): unknown {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

async function insertRow(
  db: PGlite,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const result = await db.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${
      table === 'accounts' ? 'id' : 'account_id AS id'
    }`,
    columns.map((column) => jsonParam(row[column])),
  );
  return result.rows[0]!.id;
}

/**
 * Insert an account with sensible defaults; returns its id. Columns that belong
 * to the type's details table (`reward_balance`, `ticker`, …) are routed there.
 */
export async function seedAccount(
  { db }: SessionContext,
  seed: AccountSeed = {},
): Promise<string> {
  const row: Record<string, unknown> = {
    name: 'Test account',
    type: 'ASSET',
    currency: 'USD',
    balance: 0,
    ...seed,
  };

  const base: Record<string, unknown> = {};
  const detail: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    (BASE_COLUMNS.includes(column) ? base : detail)[column] = value;
  }

  const id = await insertRow(db, 'accounts', base);

  const table = DETAIL_TABLE[base.type as keyof typeof DETAIL_TABLE];
  if (table) {
    // A price always carries its date (share_price_pair_check).
    if (detail.last_price != null && detail.last_price_date === undefined) {
      detail.last_price_date = '2026-01-01';
    }
    await insertRow(db, table, { account_id: id, ...detail });
  } else if (Object.keys(detail).length > 0) {
    throw new Error(`seedAccount: ${base.type} accounts have no details table for ${Object.keys(detail)}`);
  }

  return id;
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
    'SELECT * FROM accounts_flat WHERE id = $1',
    [id],
  );
  return result.rows[0]!;
}
