import { z } from 'zod';
import { getSessionContext } from '@/lib/db/session';
import {
  clearApiKey,
  getApiKey,
  maskApiKey,
  setApiKey,
  type ApiKeyProvider,
} from '@/lib/db/settings';

const PROVIDERS: readonly ApiKeyProvider[] = ['exchangerate', 'finnhub', 'gemini'];

const SetApiKeySchema = z.object({
  provider: z.enum(['exchangerate', 'finnhub', 'gemini']),
  apiKey: z.string().trim().min(1, 'API key cannot be empty'),
});

const ProviderSchema = z.object({ provider: z.enum(['exchangerate', 'finnhub', 'gemini']) });

export interface ApiKeyStatus {
  provider: ApiKeyProvider;
  configured: boolean;
  masked: string | null;
}

/**
 * Store a user-supplied API key on this device.
 *
 * Nothing ships with a key (PLAN.md §1); this is the only way one enters the
 * database. `device_secrets` is not part of the Phase 4 snapshot, so a key never
 * leaves the device even once cloud sync exists.
 */
export async function saveApiKey(input: z.infer<typeof SetApiKeySchema>): Promise<void> {
  const { db } = await getSessionContext();
  const parsed = SetApiKeySchema.parse(input);
  await setApiKey(db, parsed.provider, parsed.apiKey);
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
      };
    }),
  );
}
