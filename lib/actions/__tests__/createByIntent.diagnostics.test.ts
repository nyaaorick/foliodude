import { describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import fs from 'node:fs';
import path from 'node:path';

const enabled = process.env.AI_DIAG === '1';

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

vi.mock('@/lib/actions/createAssetsExpense', () => ({
  createAssetsExpense: mockCreateAssetsExpense,
}));

vi.mock('@/lib/actions/createTransfer', () => ({
  createTransfer: mockCreateTransfer,
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
const HSBC_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

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
    id: HSBC_ACCOUNT_ID,
    user_id: 'user-1',
    name: 'HSBC',
    type: AccountType.ASSET,
    balance: 5000,
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
];

type ExpectedIntent =
  | 'create_account'
  | 'create_transfer'
  | 'create_assets_expense'
  | 'create_expense';

const CASES: Array<{
  name: string;
  text: string;
  expected: ExpectedIntent;
}> = [
  {
    name: 'asset expense (english, explicit date)',
    text: 'Record a debit card transaction of 6.80 on BoA Checking for coffee on 2026-03-21',
    expected: 'create_assets_expense',
  },
  {
    name: 'asset expense (chinese, explicit date)',
    text: '在 Cash Wallet 记一笔借记卡消费 8.60，备注 milk tea，日期 2026-03-21',
    expected: 'create_assets_expense',
  },
  {
    name: 'liability expense (english, explicit date)',
    text: 'Record a dining expense of 18.50 on Amex Gold for lunch on 2026-03-21',
    expected: 'create_expense',
  },
  {
    name: 'liability expense (chinese, explicit date)',
    text: '在 Amex Gold 上记一笔 Grocery 消费 63.20，备注 whole foods，日期 2026-03-21',
    expected: 'create_expense',
  },
  {
    name: 'asset expense (chinese, hsbc shorthand, implicit date)',
    text: '往我汇丰帐上记录200块',
    expected: 'create_assets_expense',
  },
  {
    name: 'transfer (english)',
    text: 'Transfer 25.75 from Cash Wallet to BoA Checking',
    expected: 'create_transfer',
  },
  {
    name: 'transfer (chinese)',
    text: '把 100 从 BoA Checking 转到 Amex Gold',
    expected: 'create_transfer',
  },
  {
    name: 'create account (english)',
    text: 'Create an asset account called Holiday Fund',
    expected: 'create_account',
  },
  {
    name: 'create account (chinese)',
    text: '帮我新建一张信用卡账户，名字叫 Freedom Flex',
    expected: 'create_account',
  },
];

function getLastCallArg(mockFn: ReturnType<typeof vi.fn>) {
  return mockFn.mock.calls.at(-1)?.[0] ?? null;
}

describe(enabled ? 'createByIntent diagnostics (live model)' : 'createByIntent diagnostics (skipped)', () => {
  it(
    enabled ? 'runs curated prompts and prints intent+payload' : 'skipped',
    async () => {
      if (!enabled) return;

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
      mockCreateAssetsExpense.mockResolvedValue({
        expense_id: 'asset-expense-1',
        reward_id: null,
        reward_points: 0,
      });
      mockCreateTransaction.mockResolvedValue({
        expense_id: 'expense-1',
        reward_id: null,
        reward_points: 0,
      });
      mockCreateTransfer.mockResolvedValue({
        transaction: { id: 'transfer-1' },
      });

      const failures: Array<{
        name: string;
        input: string;
        expected: ExpectedIntent;
        got: string | null;
        error?: string;
        payload?: unknown;
      }> = [];
      const results: Array<{
        name: string;
        input: string;
        expected: ExpectedIntent;
        got: string | null;
        payload?: unknown;
        error?: string;
      }> = [];

      for (const testCase of CASES) {
        mockCreateAccount.mockClear();
        mockCreateAssetsExpense.mockClear();
        mockCreateTransaction.mockClear();
        mockCreateTransfer.mockClear();

        try {
          const result = await createByIntentFromText({
            text: testCase.text,
            traceId: `diag-${testCase.name}`,
          });

          if ('noAction' in result) {
            results.push({
              name: testCase.name,
              input: testCase.text,
              expected: testCase.expected,
              got: 'no_action',
              error: result.reply,
            });

            failures.push({
              name: testCase.name,
              input: testCase.text,
              expected: testCase.expected,
              got: 'no_action',
              error: result.reply,
            });
            continue;
          }

          const payload =
            result.intent === 'create_account'
              ? getLastCallArg(mockCreateAccount)
              : result.intent === 'create_transfer'
                ? getLastCallArg(mockCreateTransfer)
                : result.intent === 'create_assets_expense'
                  ? getLastCallArg(mockCreateAssetsExpense)
                  : getLastCallArg(mockCreateTransaction);

          results.push({
            name: testCase.name,
            input: testCase.text,
            expected: testCase.expected,
            got: result.intent,
            payload,
          });

          if (result.intent !== testCase.expected) {
            failures.push({
              name: testCase.name,
              input: testCase.text,
              expected: testCase.expected,
              got: result.intent,
              payload,
            });
          }
        } catch (error) {
          results.push({
            name: testCase.name,
            input: testCase.text,
            expected: testCase.expected,
            got: null,
            error: error instanceof Error ? error.message : 'unknown_error',
          });

          failures.push({
            name: testCase.name,
            input: testCase.text,
            expected: testCase.expected,
            got: null,
            error: error instanceof Error ? error.message : 'unknown_error',
          });
        }
      }

      const outDir = path.resolve(process.cwd(), 'coverage');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'ai-diagnostics.latest.json'),
        JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            cases: results,
            failures,
          },
          null,
          2,
        ),
        'utf8',
      );

      expect(failures, `diagnostic failures: ${failures.length}`).toHaveLength(0);
    },
    180000,
  );
});
