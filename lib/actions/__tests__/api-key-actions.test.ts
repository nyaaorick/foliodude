import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { listApiKeyStatus, removeApiKey, saveApiKey } from '@/lib/actions/api-key-actions';
import { createTestContext } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('api-key-actions', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('masks stored keys', async () => {
    expect((await listApiKeyStatus()).every((status) => !status.configured)).toBe(true);

    await saveApiKey({ provider: 'finnhub', apiKey: '  sk_live_abcd1234  ' });


    const status = await listApiKeyStatus();
    expect(status).toContainEqual({
      provider: 'finnhub', configured: true, masked: '••••1234', endpoint: null,
    });

  });

  it('rejects an empty key', async () => {
    await expect(saveApiKey({ provider: 'finnhub', apiKey: '   ' })).rejects.toThrow('API key cannot be empty');

  });

  it('removes a key, and removing an unset one is not an error', async () => {
    await saveApiKey({ provider: 'exchangerate', apiKey: 'fx-key-0001' });
    await removeApiKey({ provider: 'exchangerate' });
    await expect(removeApiKey({ provider: 'exchangerate' })).resolves.toBeUndefined();

    const [row] = (await listApiKeyStatus()).filter((s) => s.provider === 'exchangerate');
    expect(row?.configured).toBe(false);
  });
});
