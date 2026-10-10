import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateAccount,
  mockCreateAssetsExpense,
  mockCreateTransfer,
  mockCreateTransaction,
  mockGetAccounts,
} = vi.hoisted(() => ({
  mockCreateAccount: vi.fn(),
  mockCreateAssetsExpense: vi.fn(),
  mockCreateTransfer: vi.fn(),
  mockCreateTransaction: vi.fn(),
  mockGetAccounts: vi.fn(),
}));

vi.mock('@/lib/actions/create-accounts-actions', () => ({
  createAccount: mockCreateAccount,
}));

vi.mock('@/lib/actions/createTransfer', () => ({
  createTransfer: mockCreateTransfer,
}));

vi.mock('@/lib/actions/createAssetsExpense', () => ({
  createAssetsExpense: mockCreateAssetsExpense,
}));

vi.mock('@/lib/actions/createTransaction', () => ({
  createTransaction: mockCreateTransaction,
}));

vi.mock('@/lib/actions/account-read-actions', () => ({
  getAccounts: mockGetAccounts,
}));

vi.mock('@/lib/db/session', () => ({
  getSessionContext: vi.fn().mockResolvedValue({ db: {} }),
}));

vi.mock('@/lib/db/settings', () => ({
  getLlmConfig: vi.fn().mockResolvedValue({
    apiKey: 'test-key',
    baseUrl: 'https://llm.example.test/v1',
    model: 'test-model',
  }),
}));

import { createByIntentFromText } from '@/lib/actions/createByIntent';

const CREATED_ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';

// An OpenAI-style /chat/completions reply carrying the planner's JSON.
function makeChatResponse(steps: unknown[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ steps }) } }],
    }),
  } as unknown as Response;
}

// The orchestrator's own risk is plan execution: a step may reference the
// account an earlier step created via `@alias`, and an alias that was never
// defined must abort rather than book against a wrong account.
describe('createByIntent plan execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mockGetAccounts.mockResolvedValue([]);
    mockCreateAccount.mockResolvedValue({ id: CREATED_ACCOUNT_ID });
    mockCreateTransaction.mockResolvedValue({ expense_id: 'expense-1' });
  });

  it('resolves @alias to the account created by an earlier step', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeChatResponse([
        {
          intent: 'create_account',
          resultAlias: 'new_account_1',
          payload: { name: 'Amex Platinum', type: 'LIABILITY', currency: 'USD', balance: 0, credit_limit: 0, reward_currency: null },
        },
        {
          intent: 'create_expense',
          payload: { accountId: '@new_account_1', category: 'Dining', amount: 35.6, memo: 'Dinner', date: '2026-03-21' },
        },
      ]),
    );

    const result = await createByIntentFromText({ text: 'new card, then dinner 35.6', traceId: 'alias' });

    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: CREATED_ACCOUNT_ID, amount: 35.6 }),
    );

    // The OpenAI-compatible contract: where it calls, how it authenticates,
    // and that it asks for JSON.
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://llm.example.test/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'test-model',
      response_format: { type: 'json_object' },
    });
    expect('steps' in result && result.steps.map((step) => step.intent)).toEqual([
      'create_account',
      'create_expense',
    ]);
  });

  it('aborts before writing when a plan references an unknown alias', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeChatResponse([
        {
          intent: 'create_expense',
          payload: { accountId: '@missing_alias', category: 'Dining', amount: 10, date: '2026-03-21' },
        },
      ]),
    );

    await expect(
      createByIntentFromText({ text: 'coffee 10', traceId: 'bad-alias' }),
    ).rejects.toThrow('Unknown result alias: missing_alias');
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });
});
