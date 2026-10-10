import type { Queryable } from './session';

/**
 * Thin helpers over `db.query`. These exist to remove repetition, not to hide
 * SQL: every caller still writes its own statement.
 */

/** Rows from a query. */
export async function rows<T>(
  db: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

/** Exactly one row, or `null` when the query matched nothing. */
export async function maybeOne<T>(
  db: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await db.query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Exactly one row. Throws `notFoundMessage` when the query matched nothing —
 * the common case where a caller has already validated ownership and a miss
 * means the record does not exist or belongs to someone else.
 */
export async function one<T>(
  db: Queryable,
  text: string,
  params: unknown[],
  notFoundMessage: string,
): Promise<T> {
  const row = await maybeOne<T>(db, text, params);
  if (!row) throw new Error(notFoundMessage);
  return row;
}

/**
 * `col = ANY($n)` against an enum-typed column: bind $n as a plain JS string
 * array and cast the COLUMN to text (`type::text = ANY($n)`), not the
 * parameter to `enum_name[]`. PGlite's bind-array parser cannot resolve an
 * enum array type from a placeholder and throws "malformed array literal" —
 * confirmed by direct probe against PGlite 0.5.8. `id = ANY($n)` against a
 * plain uuid/text column needs no such workaround.
 */

/** Postgres SQLSTATEs for a unique-constraint and a CHECK-constraint violation. */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

function hasSqlState(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, UNIQUE_VIOLATION);
}

export function isCheckViolation(error: unknown): boolean {
  return hasSqlState(error, CHECK_VIOLATION);
}
