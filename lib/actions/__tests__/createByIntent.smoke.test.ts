import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';

const enabled = process.env.AI_SMOKE === '1';
const PER_REQUEST_DELAY_MS = 13_000;

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

import { createByIntentFromText } from '@/lib/actions/createByIntent';

const BOA_CHECKING_ID = '11111111-1111-4111-8111-111111111111';
const CASH_WALLET_ID = '33333333-3333-4333-8333-333333333333';
const AMEX_GOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAPPHIRE_RESERVE_ID = '55555555-5555-4555-8555-555555555555';

const ACCOUNT_ROWS = [
  {
    id: BOA_CHECKING_ID,
    user_id: 'user-1',
    name: 'BoA Checking',
    type: AccountType.ASSET,
    balance: 1000,
    credit_limit: null,
    reward_currency: null,
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: 'USD',
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: null,
  },
  {
    id: CASH_WALLET_ID,
    user_id: 'user-1',
    name: 'Cash Wallet',
    type: AccountType.ASSET,
    balance: 120,
    credit_limit: null,
    reward_currency: null,
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: 'USD',
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: null,
  },
  {
    id: AMEX_GOLD_ID,
    user_id: 'user-1',
    name: 'Amex Gold',
    type: AccountType.LIABILITY,
    balance: -200,
    credit_limit: 10000,
    reward_currency: 'MR',
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: 'USD',
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: 9800,
  },
  {
    id: SAPPHIRE_RESERVE_ID,
    user_id: 'user-1',
    name: 'Sapphire Reserve',
    type: AccountType.LIABILITY,
    balance: -400,
    credit_limit: 12000,
    reward_currency: 'UR',
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: 'USD',
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-21T00:00:00.000Z',
    updated_at: '2026-03-21T00:00:00.000Z',
    available_credit: 11600,
  },
];

type SmokeCase =
  | {
      name: string;
      text: string;
      expectedIntent: 'create_account';
      assert: () => void;
    }
  | {
      name: string;
      text: string;
      expectedIntent: 'create_assets_expense';
      assert: () => void;
    }
  | {
      name: string;
      text: string;
      expectedIntent: 'create_expense';
      assert: () => void;
    }
  | {
      name: string;
      text: string;
      expectedIntent: 'create_transfer';
      assert: () => void;
    };

const SMOKE_CASES: SmokeCase[] = [
  {
    name: 'english asset account creation',
    text: 'Create a checking account called Chase Checking',
    expectedIntent: 'create_account',
    assert: () => {
      expect(mockCreateAccount).toHaveBeenCalledTimes(1);
      expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Chase Checking',
        type: 'ASSET',
        currency: 'USD',
        balance: 0,
      }));
    },
  },
  {
    name: 'chinese liability account creation',
    text: '帮我添加一张信用卡账户，名字叫 Amex Platinum',
    expectedIntent: 'create_account',
    assert: () => {
      expect(mockCreateAccount).toHaveBeenCalledTimes(1);
      expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Amex Platinum',
        type: 'LIABILITY',
        currency: 'USD',
        credit_limit: 0,
      }));
    },
  },
  {
    name: 'english debit card expense',
    text: 'Record a debit card transaction of 14.25 on BoA Checking for coffee today',
    expectedIntent: 'create_assets_expense',
    assert: () => {
      expect(mockCreateAssetsExpense).toHaveBeenCalledTimes(1);
      expect(mockCreateAssetsExpense).toHaveBeenCalledWith(expect.objectContaining({
        accountId: BOA_CHECKING_ID,
        amount: 14.25,
      }));
    },
  },
  {
    name: 'chinese cash wallet expense',
    text: '在 Cash Wallet 记一笔 8.60 的借记卡消费，备注 milk tea',
    expectedIntent: 'create_assets_expense',
    assert: () => {
      expect(mockCreateAssetsExpense).toHaveBeenCalledTimes(1);
      expect(mockCreateAssetsExpense).toHaveBeenCalledWith(expect.objectContaining({
        accountId: CASH_WALLET_ID,
        amount: 8.6,
        memo: 'milk tea',
      }));
    },
  },
  {
    name: 'english card expense',
    text: 'Record a dining expense of 18.50 on Amex Gold for lunch today',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        accountId: AMEX_GOLD_ID,
        category: 'Dining',
        amount: 18.5,
      }));
    },
  },
  {
    name: 'chinese grocery expense',
    text: '在 Sapphire Reserve 上记一笔 Grocery 消费，金额 63.20，备注 whole foods',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        accountId: SAPPHIRE_RESERVE_ID,
        category: 'Grocery',
        amount: 63.2,
      }));
    },
  },
  {
    name: 'english transfer to credit card',
    text: 'Transfer 100 from BoA Checking to Amex Gold',
    expectedIntent: 'create_transfer',
    assert: () => {
      expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
      expect(mockCreateTransfer).toHaveBeenCalledWith(expect.objectContaining({
        fromAccountId: BOA_CHECKING_ID,
        toAccountId: AMEX_GOLD_ID,
        amount: 100,
      }));
    },
  },
  {
    name: 'chinese wallet transfer',
    text: '把 25.75 从 Cash Wallet 转到 BoA Checking',
    expectedIntent: 'create_transfer',
    assert: () => {
      expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
      expect(mockCreateTransfer).toHaveBeenCalledWith(expect.objectContaining({
        fromAccountId: CASH_WALLET_ID,
        toAccountId: BOA_CHECKING_ID,
        amount: 25.75,
      }));
    },
  },
  {
    name: 'mixed language card expense without explicit date',
    text: '帮我在 Amex Gold record 一笔 dining 23.8, memo 写 ramen',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        accountId: AMEX_GOLD_ID,
        category: 'Dining',
        amount: 23.8,
        memo: 'ramen',
      }));
      expect(
        String(mockCreateTransaction.mock.calls[0]?.[0]?.date ?? ''),
      ).toMatch(/^2026-03-21T/);
    },
  },
  {
    name: 'mixed language expense with unclear category',
    text: '帮我在 Amex Gold record 12.3, memo 写 coffee',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      const payload = mockCreateTransaction.mock.calls[0]?.[0];
      expect(payload).toEqual(expect.objectContaining({
        accountId: AMEX_GOLD_ID,
        amount: 12.3,
        memo: 'coffee',
      }));
      expect(EXPENSE_CATEGORIES).toContain(payload?.category);
      expect(String(payload?.date ?? '')).toMatch(/^2026-03-21T/);
    },
  },
  {
    name: 'chinese short transfer with shorthand names',
    text: '把 300 从 boa 转到 amex',
    expectedIntent: 'create_transfer',
    assert: () => {
      expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
      expect(mockCreateTransfer).toHaveBeenCalledWith(expect.objectContaining({
        fromAccountId: BOA_CHECKING_ID,
        toAccountId: AMEX_GOLD_ID,
        amount: 300,
      }));
    },
  },
  {
    name: 'multi-action text create account then expense',
    text: 'Create a new card called Freedom Flex then add a grocery expense of 45 on it',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateAccount).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
    },
  },
  {
    name: 'mixed language transfer with shorthand account names',
    text: '帮我 transfer 88.6 from boa checking 到 amex',
    expectedIntent: 'create_transfer',
    assert: () => {
      expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
      expect(mockCreateTransfer).toHaveBeenCalledWith(expect.objectContaining({
        fromAccountId: BOA_CHECKING_ID,
        toAccountId: AMEX_GOLD_ID,
        amount: 88.6,
      }));
    },
  },
  {
    name: 'expense without explicit category infers from merchant',
    text: '在 Amex Gold 记一笔 12.30 的消费，备注 subway',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        accountId: AMEX_GOLD_ID,
        category: 'Dining',
        amount: 12.3,
        memo: 'subway',
      }));
    },
  },
  {
    name: 'ambiguous card phrasing still maps to liability account',
    text: '记到我那张 amex 的一笔 shopping，49.99，买衣服',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        accountId: AMEX_GOLD_ID,
        category: 'Shopping',
        amount: 49.99,
      }));
    },
  },
  {
    name: 'single sentence create account then expense',
    text: 'I do not have this card yet, create an Amex Platinum account first and then record a dining expense of 35.6 on it',
    expectedIntent: 'create_expense',
    assert: () => {
      expect(mockCreateAccount).toHaveBeenCalledTimes(1);
      expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
    },
  },
];

describe(enabled ? 'createByIntent text smoke' : 'createByIntent text smoke (skipped)', () => {
  beforeEach(() => {
    mockGetAccounts.mockResolvedValue(ACCOUNT_ROWS);
    mockCreateAccount.mockReset();
    mockCreateAssetsExpense.mockReset();
    mockCreateTransfer.mockReset();
    mockCreateTransaction.mockReset();

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
  });

  it(
    enabled ? 'validates common user inputs against the live model' : 'skipped',
    async () => {
      if (!enabled) {
        return;
      }

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const failures: Array<{ name: string; input: string; expected: string; error: string }> = [];

      for (const [index, testCase] of SMOKE_CASES.entries()) {
        mockCreateAccount.mockClear();
        mockCreateAssetsExpense.mockClear();
        mockCreateTransfer.mockClear();
        mockCreateTransaction.mockClear();

        try {
          const result = await createByIntentFromText({
            text: testCase.text,
            traceId: `smoke-${testCase.name}`,
          });

          if ('noAction' in result) {
            failures.push({
              name: testCase.name,
              input: testCase.text,
              expected: testCase.expectedIntent,
              error: `no_action:${result.reply}`,
            });
            continue;
          }

          if (result.intent !== testCase.expectedIntent) {
            failures.push({
              name: testCase.name,
              input: testCase.text,
              expected: testCase.expectedIntent,
              error: `intent_mismatch:${result.intent}`,
            });
            continue;
          }

          testCase.assert();
        } catch (error) {
          failures.push({
            name: testCase.name,
            input: testCase.text,
            expected: testCase.expectedIntent,
            error: error instanceof Error ? error.message : 'unknown_error',
          });
        } finally {
          if (index < SMOKE_CASES.length - 1) {
            await sleep(PER_REQUEST_DELAY_MS);
          }
        }
      }

      if (failures.length > 0) {
        console.log(JSON.stringify({ failures }, null, 2));
      }

      expect(failures, `smoke failures: ${failures.length}`).toHaveLength(0);
    },
    240000,
  );
});
