import { z } from 'zod';
import type { Queryable } from '@/lib/db/session';
import { maybeOne } from '@/lib/db/sql';

/** Where an OpenAI-compatible Responses API lives, and how to call it. */
export interface LlmEndpoint {
  baseUrl: string;
  model: string;
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

/** AI-specific endpoint validation; shared secret storage owns persistence. */
export const RemoteApiKeySchema = z.object({
  provider: z.literal('llm'),
  apiKey: z.string().trim().min(1, 'API key cannot be empty'),
  baseUrl: z.string().trim().url('Base URL must be a full http(s) address').regex(/^https?:\/\//),
  model: z.string().trim().min(1, 'Model cannot be empty'),
});
