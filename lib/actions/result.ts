import type { z } from 'zod';

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * The boundary between "actions throw" and "the UI reads a result".
 *
 * Inside an action, every failure is a `throw`: `db.transaction()` rolls back
 * on a throw but *commits* on a return, so a failure returned from inside one
 * could persist a half-written ledger entry. Only the exported functions the UI
 * consumes as `ActionResult` wrap their body in this, once, outside the
 * transaction.
 */
export async function toActionResult<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await run() };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    throw error;
  }
}

/** Parse input or throw the first issue's message. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input');
  return parsed.data;
}

/** The value of a successful result; a failed one becomes a thrown `Error`. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}
