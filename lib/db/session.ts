import type { PGlite, Transaction } from '@electric-sql/pglite';

import { assertWritable } from '@/lib/sync/writer';

import { getDb } from './client';

/**
 * `Queryable` is satisfied by both `PGlite` and a transaction handle, so an
 * action can run its statements standalone or inside a caller's transaction
 * without changing shape.
 */
export type Queryable = Pick<PGlite, 'query'> | Transaction;

export interface SessionContext {
  db: PGlite;
}

/**
 * Wrap the handle so `transaction()` refuses to run on a read-only device.
 *
 * This is the single choke point for the single-writer model (PLAN.md §5 Phase
 * 4): every ledger mutation in `lib/actions` runs inside `db.transaction()`,
 * and nothing else does. Reads go through `db.query` and are untouched, as are
 * the two legitimate device-local writes that use `query` directly — the
 * dashboard's daily snapshot row and the API keys.
 *
 * Guarding here rather than in `getDb()` is deliberate: the sync engine holds
 * the raw handle, so restoring a downloaded snapshot — the one write a
 * read-only device *must* be able to perform — is not blocked by its own rule.
 */
function guardWrites(db: PGlite): PGlite {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return (...args: Parameters<PGlite['transaction']>) => {
          assertWritable();
          return target.transaction(...args);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function getSessionContext(): Promise<SessionContext> {
  return { db: guardWrites(await getDb()) };
}
