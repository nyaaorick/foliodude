import { describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';

const enabled = process.env.AI_FUZZ === '1';
const iterations = Number(process.env.AI_FUZZ_COUNT ?? '10');
const seed = Number(process.env.AI_FUZZ_SEED ?? Date.now());

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
  getSessionContext: vi.fn().mockResolvedValue({ db: {}, userId: 'user-1' }),
}));

vi.mock('@/lib/db/settings', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-gemini-key'),
}));

import { createByIntentFromText } from '@/lib/actions/createByIntent';

const ASSET_ACCOUNTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'BoA Checking', currency: 'USD' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Cash Wallet', currency: 'USD' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Chase Savings', currency: 'USD' },
] as const;

const LIABILITY_ACCOUNTS = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Amex Gold', currency: 'USD' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Sapphire Reserve', currency: 'USD' },
  { id: '66666666-6666-4666-8666-666666666666', name: 'Citi Premier', currency: 'USD' },
] as const;

const ACCOUNT_ROWS = [
  ...ASSET_ACCOUNTS.map((account) => ({
    id: account.id,
    user_id: 'user-1',
    name: account.name,
    type: AccountType.ASSET,
    balance: 1000,
    credit_limit: null,
    reward_currency: null,
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: account.currency,
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_date: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: null,
  })),
  ...LIABILITY_ACCOUNTS.map((account) => ({
    id: account.id,
    user_id: 'user-1',
    name: account.name,
    type: AccountType.LIABILITY,
    balance: -200,
    credit_limit: 10000,
    reward_currency: 'MR',
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: account.currency,
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_date: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: 9800,
  })),
];

type ExpectedIntent =
  | 'create_account'
  | 'create_transfer'
  | 'create_assets_expense'
  | 'create_expense';

function lcg(seedValue: number) {
  let state = seedValue % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function formatAmount(rng: () => number) {
  const value = Math.round((rng() * 180 + 5) * 100) / 100;
  return value.toFixed(2);
}

function makePrompt(rng: () => number): { text: string; expected: ExpectedIntent } {
  const mode = pick(rng, ['asset_expense', 'expense', 'transfer', 'account'] as const);

  if (mode === 'account') {
    const accountName = pick(rng, [
      'Chase Checking',
      'Holiday Fund',
      'Daily Wallet',
      'Travel Cash',
    ] as const);
    const lang = pick(rng, ['en', 'zh'] as const);
    if (lang === 'zh') {
      return {
        expected: 'create_account',
        text: `帮我新建一个叫 ${accountName} 的账户`,
      };
    }
    return {
      expected: 'create_account',
      text: `Create an asset account called ${accountName}`,
    };
  }

  if (mode === 'transfer') {
    const from = pick(rng, ASSET_ACCOUNTS);
    const to = pick(rng, LIABILITY_ACCOUNTS);
    const amount = formatAmount(rng);
    const lang = pick(rng, ['en', 'zh'] as const);
    if (lang === 'zh') {
      return {
        expected: 'create_transfer',
        text: `把 ${amount} 美元从 ${from.name} 转到 ${to.name}`,
      };
    }
    return {
      expected: 'create_transfer',
      text: `Transfer ${amount} from ${from.name} to ${to.name}`,
    };
  }

  const amount = formatAmount(rng);
  const lang = pick(rng, ['en', 'zh'] as const);

  if (mode === 'asset_expense') {
    const account = pick(rng, ASSET_ACCOUNTS);
    if (lang === 'zh') {
      return {
        expected: 'create_assets_expense',
        text: `在 ${account.name} 记录一笔借记卡消费，金额 ${amount}`,
      };
    }
    return {
      expected: 'create_assets_expense',
      text: `Record a debit card transaction of ${amount} on ${account.name}`,
    };
  }

  const card = pick(rng, LIABILITY_ACCOUNTS);
  const category = pick(rng, EXPENSE_CATEGORIES);
  if (lang === 'zh') {
    return {
      expected: 'create_expense',
      text: `在 ${card.name} 记录一笔 ${category} 消费，金额 ${amount}`,
    };
  }
  return {
    expected: 'create_expense',
    text: `Record a ${category} expense of ${amount} on ${card.name}`,
  };
}

describe(enabled ? 'createByIntent text fuzz' : 'createByIntent text fuzz (skipped)', () => {
  it(
    enabled ? 'runs randomized prompts against the live model' : 'skipped',
    async () => {
      if (!enabled) {
        return;
      }

      const rng = lcg(seed);
      mockGetAccounts.mockResolvedValue(ACCOUNT_ROWS);
      mockCreateAccount.mockResolvedValue({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Mock Account',
        type: AccountType.ASSET,
        currency: 'USD',
        balance: 0,
        credit_limit: 0,
        reward_currency: null,
      });
      mockCreateTransaction.mockResolvedValue({
        expense_id: 'expense-1',
        reward_id: null,
        reward_points: 0,
      });
      mockCreateAssetsExpense.mockResolvedValue({
        expense_id: 'asset-expense-1',
        reward_id: null,
        reward_points: 0,
      });
      mockCreateTransfer.mockResolvedValue({
        transaction: {
          id: 'transfer-1',
        },
      });

      const failures: Array<{ input: string; expected: ExpectedIntent; error: string }> = [];

      for (let i = 0; i < iterations; i += 1) {
        mockCreateAccount.mockClear();
        mockCreateAssetsExpense.mockClear();
        mockCreateTransaction.mockClear();
        mockCreateTransfer.mockClear();

        const { text, expected } = makePrompt(rng);
        try {
          const result = await createByIntentFromText({
            text,
            traceId: `fuzz-${i}`,
          });

          if ('noAction' in result) {
            failures.push({
              input: text,
              expected,
              error: `no_action:${result.reply}`,
            });
            continue;
          }

          if (result.intent !== expected) {
            failures.push({
              input: text,
              expected,
              error: `intent_mismatch:${result.intent}`,
            });
            continue;
          }

          if (expected === 'create_account' && !mockCreateAccount.mock.calls.length) {
            failures.push({ input: text, expected, error: 'no_create_account_call' });
          }
          if (
            expected === 'create_assets_expense' &&
            !mockCreateAssetsExpense.mock.calls.length
          ) {
            failures.push({ input: text, expected, error: 'no_create_assets_expense_call' });
          }
          if (expected === 'create_expense' && !mockCreateTransaction.mock.calls.length) {
            failures.push({ input: text, expected, error: 'no_create_transaction_call' });
          }
          if (expected === 'create_transfer' && !mockCreateTransfer.mock.calls.length) {
            failures.push({ input: text, expected, error: 'no_create_transfer_call' });
          }
        } catch (error) {
          failures.push({
            input: text,
            expected,
            error: error instanceof Error ? error.message : 'unknown_error',
          });
        }
      }

      if (failures.length > 0) {
        // Log failures for debugging.
        console.log(JSON.stringify({ seed, iterations, failures }, null, 2));
      }

      expect(failures, `fuzz failures: ${failures.length}`).toHaveLength(0);
    },
    120000,
  );
});
