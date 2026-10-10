import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { listApiKeyStatus, removeApiKey, saveApiKey } from '@/lib/actions/api-key-actions';
import { getLlmConfig } from '@/lib/db/settings';
import { createTestContext } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('api-key-actions', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('masks stored keys and keeps the llm endpoint with its key', async () => {
    expect((await listApiKeyStatus()).every((status) => !status.configured)).toBe(true);

    await saveApiKey({ provider: 'finnhub', apiKey: '  sk_live_abcd1234  ' });
    await saveApiKey({
      provider: 'llm',
      apiKey: 'sk-llm-9999',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-2.5-flash',
    });

    const status = await listApiKeyStatus();
    expect(status).toContainEqual({
      provider: 'finnhub', configured: true, masked: '••••1234', endpoint: null,
    });
    expect(status).toContainEqual({
      provider: 'llm',
      configured: true,
      masked: '••••9999',
      // The trailing slash is dropped so `${baseUrl}/chat/completions` is well formed.
      endpoint: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
    });
    expect(await getLlmConfig(ctx.db)).toMatchObject({ apiKey: 'sk-llm-9999', model: 'gemini-2.5-flash' });
  });

  it('rejects an empty key and an llm entry without a usable endpoint', async () => {
    await expect(saveApiKey({ provider: 'finnhub', apiKey: '   ' })).rejects.toThrow('API key cannot be empty');
    await expect(
      saveApiKey({ provider: 'llm', apiKey: 'k', baseUrl: 'not-a-url', model: 'm' }),
    ).rejects.toThrow();
    await expect(
      // @ts-expect-error — an llm entry must carry its endpoint
      saveApiKey({ provider: 'llm', apiKey: 'k' }),
    ).rejects.toThrow();
  });

  it('removes a key, and removing an unset one is not an error', async () => {
    await saveApiKey({ provider: 'exchangerate', apiKey: 'fx-key-0001' });
    await removeApiKey({ provider: 'exchangerate' });
    await expect(removeApiKey({ provider: 'exchangerate' })).resolves.toBeUndefined();

    const [row] = (await listApiKeyStatus()).filter((s) => s.provider === 'exchangerate');
    expect(row?.configured).toBe(false);
  });
});
