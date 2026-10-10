import type { Queryable } from './session';
import { maybeOne } from './sql';

/**
 * Bring-your-own-key API credentials, stored in `device_secrets` (001_init.sql).
 * Nothing ships with a value — every row is something this user typed into
 * Settings on this device. See PLAN.md §1 (Standing Constraint: No Shipped
 * Credentials) and §7 (Paused Features).
 *
 * The table is excluded from snapshot sync by construction (lib/db/backup.ts
 * does not export it), so a key never leaves the device.
 */

export type ApiKeyProvider = 'exchangerate' | 'finnhub' | 'llm';

/** Where an OpenAI-compatible chat-completions API lives, and how to call it. */
export interface LlmEndpoint {
  baseUrl: string;
  model: string;
}

export async function getApiKey(db: Queryable, provider: ApiKeyProvider): Promise<string | null> {
  const row = await maybeOne<{ api_key: string }>(
    db,
    'SELECT api_key FROM device_secrets WHERE provider = $1',
    [provider],
  );
  return row?.api_key ?? null;
}

/** The `llm` provider's full configuration, or `null` until the user has set it. */
export interface LlmConfig extends LlmEndpoint {
  apiKey: string;
}

export async function getLlmConfig(db: Queryable): Promise<LlmConfig | null> {
  const row = await maybeOne<{ api_key: string; base_url: string; model: string }>(
    db,
    "SELECT api_key, base_url, model FROM device_secrets WHERE provider = 'llm'",
  );
  return row ? { apiKey: row.api_key, baseUrl: row.base_url, model: row.model } : null;
}

export async function getLlmEndpoint(db: Queryable): Promise<LlmEndpoint | null> {
  const config = await getLlmConfig(db);
  return config && { baseUrl: config.baseUrl, model: config.model };
}

export async function setApiKey(
  db: Queryable,
  provider: ApiKeyProvider,
  apiKey: string,
  endpoint?: LlmEndpoint,
): Promise<void> {
  await db.query(
    `INSERT INTO device_secrets (provider, api_key, base_url, model) VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider) DO UPDATE
       SET api_key = EXCLUDED.api_key, base_url = EXCLUDED.base_url, model = EXCLUDED.model,
           updated_at = now()`,
    [provider, apiKey.trim(), endpoint?.baseUrl.trim().replace(/\/+$/, '') ?? null, endpoint?.model.trim() ?? null],
  );
}

export async function clearApiKey(db: Queryable, provider: ApiKeyProvider): Promise<void> {
  await db.query('DELETE FROM device_secrets WHERE provider = $1', [provider]);
}

/** Last 4 characters only — enough for the user to recognize which key is set. */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return tail.length === apiKey.length ? '••••' : `••••${tail}`;
}
