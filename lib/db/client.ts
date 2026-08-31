import { PGlite } from '@electric-sql/pglite';

import { assertSchemaNotAhead, runMigrations } from './migrate';

/** IndexedDB is the only driver Safari supports; see PLAN.md §2. */
const DATA_DIR = 'idb://foliodude';

/**
 * Type parsers that make PGlite's output match what the app's types declare.
 * Without these, `DATE` arrives as a JS Date (reintroducing the timezone
 * handling the schema was flattened to remove) and `DECIMAL` as a string.
 */
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
const INT8_OID = 20;

const PARSERS = {
  [DATE_OID]: (value: string) => value,
  // DECIMAL/NUMERIC arrives as text to preserve precision. The app models money
  // as `number` (see lib/types/database.ts) and does exact arithmetic with
  // decimal.js on top, so convert here rather than making every declared type a
  // lie. DECIMAL(12,2) and DECIMAL(18,6) both fit well inside 2^53.
  [NUMERIC_OID]: (value: string) => Number(value),
  [INT8_OID]: (value: string) => Number(value),
};

let instance: PGlite | null = null;
let opening: Promise<PGlite> | null = null;

async function open(dataDir: string): Promise<PGlite> {
  const db = await PGlite.create({ dataDir, parsers: PARSERS });

  // CURRENT_DATE reads the session timezone, so an unpinned connection would
  // roll the day over at the host's midnight and break the one-snapshot-per-day
  // unique index. Everything in this app is UTC.
  await db.exec("SET TIME ZONE 'UTC';");

  await runMigrations(db);
  await assertSchemaNotAhead(db);

  return db;
}

/**
 * The process-wide database handle. Concurrent callers share one open attempt,
 * so a burst of queries at startup cannot race two PGlite instances onto the
 * same IndexedDB directory.
 */
export function getDb(): Promise<PGlite> {
  if (instance) return Promise.resolve(instance);

  opening ??= open(DATA_DIR).then(
    (db) => {
      instance = db;
      opening = null;
      return db;
    },
    (error) => {
      opening = null;
      throw error;
    },
  );

  return opening;
}

/** Fresh in-memory database, fully migrated. For tests and the import path. */
export async function createMemoryDb(): Promise<PGlite> {
  const db = await PGlite.create({ parsers: PARSERS });
  await db.exec("SET TIME ZONE 'UTC';");
  await runMigrations(db);
  return db;
}

/** Close and forget the handle. Used by import, which swaps the whole dataDir. */
export async function closeDb(): Promise<void> {
  const db = instance;
  instance = null;
  opening = null;
  await db?.close();
}
