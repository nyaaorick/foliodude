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

  it('starts with nothing configured', async () => {
    const status = await listApiKeyStatus();
    expect(status).toEqual([
      { provider: 'exchangerate', configured: false, masked: null },
      { provider: 'finnhub', configured: false, masked: null },
      { provider: 'gemini', configured: false, masked: null },
    ]);
  });

  it('saves a key, masking everything but the last 4 characters on read-back', async () => {
    await saveApiKey({ provider: 'finnhub', apiKey: 'sk_live_abcd1234' });

    const status = await listApiKeyStatus();
    expect(status).toContainEqual({
      provider: 'finnhub',
      configured: true,
      masked: '••••1234',
    });
    // The exchangerate slot is untouched.
    expect(status).toContainEqual({
      provider: 'exchangerate',
      configured: false,
      masked: null,
    });
  });

  it('trims whitespace before storing', async () => {
    await saveApiKey({ provider: 'exchangerate', apiKey: '  spaced-key  ' });
    const [row] = (await listApiKeyStatus()).filter((s) => s.provider === 'exchangerate');
    expect(row?.masked).toBe('••••-key');
  });

  it('rejects an empty key', async () => {
    await expect(saveApiKey({ provider: 'finnhub', apiKey: '   ' })).rejects.toThrow();
  });

  it('overwrites an existing key for the same provider', async () => {
    await saveApiKey({ provider: 'finnhub', apiKey: 'first-key-0001' });
    await saveApiKey({ provider: 'finnhub', apiKey: 'second-key-9999' });

    const [row] = (await listApiKeyStatus()).filter((s) => s.provider === 'finnhub');
    expect(row?.masked).toBe('••••9999');
  });

  it('removes a configured key', async () => {
    await saveApiKey({ provider: 'finnhub', apiKey: 'sk_live_abcd1234' });
    await removeApiKey({ provider: 'finnhub' });

    const [row] = (await listApiKeyStatus()).filter((s) => s.provider === 'finnhub');
    expect(row).toEqual({ provider: 'finnhub', configured: false, masked: null });
  });

  it('removing an unconfigured key is a no-op, not an error', async () => {
    await expect(removeApiKey({ provider: 'exchangerate' })).resolves.toBeUndefined();
  });
});
