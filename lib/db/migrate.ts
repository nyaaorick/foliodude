import type { PGlite } from '@electric-sql/pglite';

import init001 from './migrations/001_init.sql?raw';

/**
 * Ordered migration list. Pre-release, 001_init is the schema's source and is
 * edited in place. Once a build ships, this becomes append only — never edit or
 * reorder an entry that has shipped, because `schema_version` records what
 * already ran by `id`.
 */
export const MIGRATIONS: ReadonlyArray<{ id: number; name: string; sql: string }> = [
  { id: 1, name: '001_init', sql: init001 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.id;

const SCHEMA_VERSION_DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    id          INTEGER     PRIMARY KEY,
    name        TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * Apply every migration that has not run yet, in order.
 *
 * Each migration runs inside its own transaction, so a failure leaves the
 * database at the last complete version rather than half-migrated. The
 * `schema_version` insert happens in that same transaction: a migration is
 * recorded if and only if its DDL committed.
 */
export async function runMigrations(db: PGlite): Promise<number> {
  await db.exec(SCHEMA_VERSION_DDL);

  const applied = await db.query<{ id: number }>('SELECT id FROM schema_version');
  const appliedIds = new Set(applied.rows.map((row) => row.id));

  let ran = 0;
  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_version (id, name) VALUES ($1, $2)', [
        migration.id,
        migration.name,
      ]);
    });
    ran += 1;
  }

  return ran;
}

/**
 * Guard against opening a database written by a newer build — the user may have
 * synced a snapshot from a device running a later version. Reading it with old
 * code risks silent data loss, so callers should refuse rather than continue.
 */
export async function assertSchemaNotAhead(db: PGlite): Promise<void> {
  const result = await db.query<{ max: number | null }>(
    'SELECT MAX(id) AS max FROM schema_version',
  );
  const current = result.rows[0]?.max ?? 0;

  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this build (v${LATEST_SCHEMA_VERSION}). Update FolioDude before opening it.`,
    );
  }
}
