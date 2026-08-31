import type { Queryable } from './session';
import { maybeOne } from './sql';

/**
 * Typed access to `local_settings` — see 003_local_settings.sql for the table
 * and its two jobs: manual valuation inputs, and bring-your-own-key API
 * credentials. This module is the only place that reads or writes it.
 */

export async function getSetting<T>(
  db: Queryable,
  userId: string,
  key: string,
): Promise<T | null> {
  const row = await maybeOne<{ value: T }>(
    db,
    'SELECT value FROM local_settings WHERE user_id = $1 AND key = $2',
    [userId, key],
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: Queryable,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO local_settings (user_id, key, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, key, JSON.stringify(value)],
  );
}

export async function deleteSetting(db: Queryable, userId: string, key: string): Promise<void> {
  await db.query('DELETE FROM local_settings WHERE user_id = $1 AND key = $2', [userId, key]);
}

// ── Bring-your-own-key API credentials ──────────────────────────────────────
// Namespaced 'apikey:<provider>'. Nothing ships with a value here — every row
// is something this user typed into Settings on this device. See PLAN.md §1
// (Standing Constraint: No Shipped Credentials) and §7 (Paused Features).

export type ApiKeyProvider = 'exchangerate' | 'finnhub' | 'gemini';

function apiKeySettingKey(provider: ApiKeyProvider): string {
  return `apikey:${provider}`;
}

export async function getApiKey(
  db: Queryable,
  userId: string,
  provider: ApiKeyProvider,
): Promise<string | null> {
  const value = await getSetting<string>(db, userId, apiKeySettingKey(provider));
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function setApiKey(
  db: Queryable,
  userId: string,
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<void> {
  await setSetting(db, userId, apiKeySettingKey(provider), apiKey.trim());
}

export async function clearApiKey(
  db: Queryable,
  userId: string,
  provider: ApiKeyProvider,
): Promise<void> {
  await deleteSetting(db, userId, apiKeySettingKey(provider));
}

/** Last 4 characters only — enough for the user to recognize which key is set. */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return tail.length === apiKey.length ? '••••' : `••••${tail}`;
}
