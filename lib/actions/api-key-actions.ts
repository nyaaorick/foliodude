import { z } from 'zod';
import { getSessionContext } from '@/lib/db/session';
import {
  clearApiKey,
  getApiKey,
  getLlmEndpoint,
  maskApiKey,
  setApiKey,
  type ApiKeyProvider,
  type LlmEndpoint,
} from '@/lib/db/settings';
import { parseOrThrow } from './result';

const PROVIDERS: readonly ApiKeyProvider[] = ['exchangerate', 'finnhub', 'llm'];

const ApiKeySchema = z.string().trim().min(1, 'API key cannot be empty');

const SetApiKeySchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.enum(['exchangerate', 'finnhub']), apiKey: ApiKeySchema }),
  // Any OpenAI-compatible chat-completions API: OpenAI, Gemini's compatibility
  // endpoint, OpenRouter, a local server. Address and model are the user's call,
  // so neither has a default.
  z.object({
    provider: z.literal('llm'),
    apiKey: ApiKeySchema,
    baseUrl: z.string().trim().url('Base URL must be a full http(s) address').regex(/^https?:\/\//),
    model: z.string().trim().min(1, 'Model cannot be empty'),
  }),
]);

const ProviderSchema = z.object({ provider: z.enum(['exchangerate', 'finnhub', 'llm']) });

export interface ApiKeyStatus {
  provider: ApiKeyProvider;
  configured: boolean;
  masked: string | null;
  /** Only for `llm`. */
  endpoint: LlmEndpoint | null;
}

/**
 * Store a user-supplied API key on this device.
 *
 * Nothing ships with a key (PLAN.md §1); this is the only way one enters the
 * database. `device_secrets` is not part of the Phase 4 snapshot, so a key never
 * leaves the device even once cloud sync exists.
 */
export async function saveApiKey(input: z.input<typeof SetApiKeySchema>): Promise<void> {
  const { db } = await getSessionContext();
  const parsed = parseOrThrow(SetApiKeySchema, input);
  await setApiKey(
    db,
    parsed.provider,
    parsed.apiKey,
    parsed.provider === 'llm' ? { baseUrl: parsed.baseUrl, model: parsed.model } : undefined,
  );
}

export async function removeApiKey(input: z.infer<typeof ProviderSchema>): Promise<void> {
  const { db } = await getSessionContext();
  const parsed = ProviderSchema.parse(input);
  await clearApiKey(db, parsed.provider);
}

/** For the settings screen: which providers are configured, key never returned in full. */
export async function listApiKeyStatus(): Promise<ApiKeyStatus[]> {
  const { db } = await getSessionContext();

  return Promise.all(
    PROVIDERS.map(async (provider) => {
      const apiKey = await getApiKey(db, provider);
      return {
        provider,
        configured: apiKey !== null,
        masked: apiKey ? maskApiKey(apiKey) : null,
        endpoint: provider === 'llm' ? await getLlmEndpoint(db) : null,
      };
    }),
  );
}
