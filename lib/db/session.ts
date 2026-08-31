import type { PGlite, Transaction } from '@electric-sql/pglite';

import { getDb } from './client';

/**
 * A database handle plus the user the caller is acting as.
 *
 * `Queryable` is satisfied by both `PGlite` and a transaction handle, so an
 * action can run its statements standalone or inside a caller's transaction
 * without changing shape.
 */
export type Queryable = Pick<PGlite, 'query'> | Transaction;

export interface SessionContext {
  db: PGlite;
  userId: string;
}

let cachedUserId: string | null = null;

/**
 * Resolve the local user id, minting one on first run.
 *
 * Phase 2 is offline-only, so this is a device-local uuid rather than an account
 * id. Every write goes through here, which is what makes the Phase 4 cutover a
 * single `UPDATE ... SET user_id = $real` per table rather than a schema change.
 */
async function resolveUserId(db: PGlite): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const result = await db.query<{ user_id: string }>(
    'SELECT user_id FROM local_identity WHERE singleton',
  );
  const userId = result.rows[0]?.user_id;

  if (!userId) {
    throw new Error('local_identity row is missing — the database did not migrate cleanly.');
  }

  cachedUserId = userId;
  return userId;
}

export async function getSessionContext(): Promise<SessionContext> {
  const db = await getDb();
  return { db, userId: await resolveUserId(db) };
}

/** Drop the memoized id. Tests and the import path swap databases underneath. */
export function resetSessionCache(): void {
  cachedUserId = null;
}
