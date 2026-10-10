import type { PGlite, Transaction } from '@electric-sql/pglite';

import { assertWritable } from '@/lib/sync/writer';

import { getDb } from './client';
import { brandTransactions, type LedgerDb } from './tx';

/**
 * `Queryable` is satisfied by both `PGlite` and a transaction handle, so a read
 * can run standalone or inside a caller's transaction. Writes take `Tx` instead
 * (lib/db/tx.ts).
 */
export type Queryable = Pick<PGlite, 'query'> | Transaction;

export interface SessionContext {
  db: LedgerDb;
}

/**
 * The single choke point for the single-writer model (PLAN.md §5 Phase 4):
 * every ledger mutation in `lib/actions` runs inside `db.transaction()`, so
 * refusing to open one on a read-only device blocks them all. Reads go through
 * `db.query` and are untouched. A few writes also use `query` directly and so
 * are *not* guarded: the dashboard's daily snapshot row and the API keys
 * (device-local, intentional), and the reward/mileage rate and rule updates
 * (a known gap — they edit synced tables).
 *
 * Guarding here rather than in `getDb()` is deliberate: the sync engine holds
 * the raw handle, so restoring a downloaded snapshot — the one write a
 * read-only device *must* be able to perform — is not blocked by its own rule.
 */
function guardWrites(db: PGlite): LedgerDb {
  const ledger = brandTransactions(db);
  return {
    query: ledger.query,
    exec: ledger.exec,
    transaction: (callback) => {
      assertWritable();
      return ledger.transaction(callback);
    },
  };
}

export async function getSessionContext(): Promise<SessionContext> {
  return { db: guardWrites(await getDb()) };
}
