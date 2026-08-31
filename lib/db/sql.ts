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

/** Postgres SQLSTATE for a unique-constraint violation. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * PGlite returns `numeric` as a string to preserve precision (`'12.34'`), while
 * the app's types model money as `number` and do exact arithmetic with
 * decimal.js on top. Convert at the query boundary so callers never see the
 * string form.
 */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : Number(value);
}
