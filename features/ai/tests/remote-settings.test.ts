import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: session }));
import { createTestContext } from '@/lib/db/testing';
import { getLlmConfig } from '../application/remote-settings';
import { saveApiKey, listApiKeyStatus, removeApiKey } from '@/lib/actions/api-key-actions';

describe('remote AI settings on shared secret storage', () => {
  beforeEach(async () => session.mockResolvedValue(await createTestContext()));
  it('keeps endpoint/key together, masks the key, rejects invalid endpoints and clears configuration', async () => {
    const { db } = await session();
    expect(await getLlmConfig(db)).toBeNull();
    await saveApiKey({ provider: 'llm', apiKey: 'sk-llm-9999', baseUrl: 'https://api.example.test/v1/', model: 'responses-model' });
    expect(await getLlmConfig(db)).toEqual({ apiKey: 'sk-llm-9999', baseUrl: 'https://api.example.test/v1', model: 'responses-model' });
    expect(await listApiKeyStatus()).toContainEqual({ provider: 'llm', configured: true, masked: '••••9999', endpoint: { baseUrl: 'https://api.example.test/v1', model: 'responses-model' } });
    await expect(saveApiKey({ provider: 'llm', apiKey: 'k', baseUrl: 'not-a-url', model: 'm' })).rejects.toThrow();
    // @ts-expect-error The endpoint is mandatory for an AI credential.
    await expect(saveApiKey({ provider: 'llm', apiKey: 'k' })).rejects.toThrow();
    await removeApiKey({ provider: 'llm' });
    expect(await getLlmConfig(db)).toBeNull();
  });
});
