import type { PGlite, Transaction } from '@electric-sql/pglite';

declare const txBrand: unique symbol;

/**
 * A transaction handle handed out by `LedgerDb.transaction()` and by nothing
 * else. Every ledger write takes a `Tx`, so a caller holding only the raw
 * database cannot compile a write that silently runs outside a transaction.
 */
export type Tx = Transaction & { readonly [txBrand]: true };

/** The database as actions see it: queries, plus a `transaction()` that yields `Tx`. */
export interface LedgerDb extends Pick<PGlite, 'query' | 'exec'> {
  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
}

/** The one place a PGlite transaction becomes a `Tx`. */
export function brandTransactions(db: PGlite): LedgerDb {
  return {
    query: db.query.bind(db),
    exec: db.exec.bind(db),
    transaction: (callback) => db.transaction((tx) => callback(tx as Tx)),
  };
}
