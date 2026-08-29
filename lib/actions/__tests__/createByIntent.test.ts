import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';

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

import {
  createByIntentFromImage,
  createByIntentFromText,
} from '@/lib/actions/createByIntent';

const LIABILITY_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';

function shanghaiMidnightUtcIso(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 8 * 60 * 60 * 1000)
    .toISOString();
}

function makeGeminiResponse(text: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
  };
}

function expectActionResult(
  result: Awaited<ReturnType<typeof createByIntentFromText>>,
) {
  if ('noAction' in result) {
    throw new Error(`Unexpected no_action response: ${result.reply}`);
  }

  return result;
}

describe('createByIntent AI flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());

    mockGetAccounts.mockResolvedValue([
      {
        id: ASSET_ACCOUNT_ID,
        user_id: 'user-1',
        name: 'BoA Checking',
        type: AccountType.ASSET,
        balance: 2500,
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
        id: LIABILITY_ACCOUNT_ID,
        user_id: 'user-1',
        name: 'Amex Gold',
        type: AccountType.LIABILITY,
        balance: -320,
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
        available_credit: 9680,
      },
    ]);

    mockCreateAccount.mockResolvedValue({
      id: CREATED_ACCOUNT_ID,
      name: 'New Card',
      type: AccountType.LIABILITY,
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
      transaction: {
        id: 'transfer-1',
      },
    });
  });

  it('creates an expense from text AI output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        steps: [
          {
            intent: 'create_expense',
            payload: {
              accountId: LIABILITY_ACCOUNT_ID,
              category: 'Dining',
              amount: 18.5,
              memo: 'Lunch',
              date: '2026-03-21',
            },
          },
        ],
      })) as unknown as Response,
    );

    const result = expectActionResult(await createByIntentFromText({
      text: 'Record lunch on Amex Gold for 18.50',
      traceId: 'text-expense',
    }));

    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: LIABILITY_ACCOUNT_ID,
      category: 'Dining',
      amount: 18.5,
      memo: 'Lunch',
      date: shanghaiMidnightUtcIso('2026-03-21'),
    });
    expect(result.intent).toBe('create_expense');
    expect(result.entityId).toBe('expense-1');
    expect(result.steps).toHaveLength(1);
  });

  it('creates an asset expense from text AI output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        steps: [
          {
            intent: 'create_assets_expense',
            payload: {
              accountId: ASSET_ACCOUNT_ID,
              amount: 12.75,
              memo: 'Coffee',
              date: '2026-03-21',
            },
          },
        ],
      })) as unknown as Response,
    );

    const result = expectActionResult(await createByIntentFromText({
      text: 'Record a 12.75 debit card transaction on BoA Checking for coffee',
      traceId: 'text-asset-expense',
    }));

    expect(mockCreateAssetsExpense).toHaveBeenCalledWith({
      accountId: ASSET_ACCOUNT_ID,
      amount: 12.75,
      memo: 'Coffee',
      date: shanghaiMidnightUtcIso('2026-03-21'),
    });
    expect(result.intent).toBe('create_assets_expense');
    expect(result.entityId).toBe('asset-expense-1');
    expect(result.steps).toHaveLength(1);
  });

  it('creates an account from text AI output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        steps: [
          {
            intent: 'create_account',
            payload: {
              name: 'Chase Checking',
              type: 'ASSET',
              currency: 'USD',
              balance: 1200,
              credit_limit: 0,
              reward_currency: null,
            },
          },
        ],
      })) as unknown as Response,
    );

    const result = expectActionResult(await createByIntentFromText({
      text: 'Create an asset account called Chase Checking with balance 1200',
      traceId: 'text-account',
    }));

    expect(mockCreateAccount).toHaveBeenCalledWith({
      name: 'Chase Checking',
      type: 'ASSET',
      currency: 'USD',
      balance: 1200,
      credit_limit: 0,
      reward_currency: null,
    });
    expect(result.intent).toBe('create_account');
    expect(result.entity).toBe('account');
    expect(result.steps).toHaveLength(1);
  });

  it('creates a transfer from text AI output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        steps: [
          {
            intent: 'create_transfer',
            payload: {
              fromAccountId: ASSET_ACCOUNT_ID,
              toAccountId: LIABILITY_ACCOUNT_ID,
              amount: 55.25,
              memo: 'Payment',
            },
          },
        ],
      })) as unknown as Response,
    );

    const result = expectActionResult(await createByIntentFromText({
      text: 'Transfer 55.25 from BoA Checking to Amex Gold',
      traceId: 'text-transfer',
    }));

    expect(mockCreateTransfer).toHaveBeenCalledWith({
      fromAccountId: ASSET_ACCOUNT_ID,
      toAccountId: LIABILITY_ACCOUNT_ID,
      amount: 55.25,
      memo: 'Payment',
    });
    expect(result.intent).toBe('create_transfer');
    expect(result.entityId).toBe('transfer-1');
    expect(result.steps).toHaveLength(1);
  });

  it('creates an account and then an expense from text AI output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        steps: [
          {
            intent: 'create_account',
            resultAlias: 'new_account_1',
            payload: {
              name: 'Amex Platinum',
              type: 'LIABILITY',
              currency: 'USD',
              balance: 0,
              credit_limit: 0,
              reward_currency: null,
            },
          },
          {
            intent: 'create_expense',
            payload: {
              accountId: '@new_account_1',
              category: 'Dining',
              amount: 35.6,
              memo: 'Dinner',
              date: '2026-03-21',
            },
          },
        ],
      })) as unknown as Response,
    );

    const result = expectActionResult(await createByIntentFromText({
      text: 'I do not have this card yet, create an Amex Platinum account first and then record a dining expense of 35.6 on it',
      traceId: 'text-two-step',
    }));

    expect(mockCreateAccount).toHaveBeenCalledWith({
      name: 'Amex Platinum',
      type: 'LIABILITY',
      currency: 'USD',
      balance: 0,
      credit_limit: 0,
      reward_currency: null,
    });
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: CREATED_ACCOUNT_ID,
      category: 'Dining',
      amount: 35.6,
      memo: 'Dinner',
      date: shanghaiMidnightUtcIso('2026-03-21'),
    });
    expect(result.intent).toBe('create_expense');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].intent).toBe('create_account');
    expect(result.steps[1].intent).toBe('create_expense');
  });

  it('creates an expense from image OCR and user note', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'AMEX GOLD\\nUBER\\n$23.45\\n2026-03-20',
          visible_fields: {
            account_label_seen: 'Amex Gold',
            merchant: 'Uber',
            amount: 23.45,
            currency: 'USD',
            transaction_date: '2026-03-20',
            transaction_count: 1,
          },
          normalized_english_text: [
            'account_label_seen: Amex Gold',
            'merchant: Uber',
            'amount: 23.45',
            'transaction_date: 2026-03-20',
          ].join('\\n'),
          user_instruction: 'my account is Amex Gold',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_expense',
              payload: {
                accountId: LIABILITY_ACCOUNT_ID,
                category: 'Transit',
                amount: 23.45,
                memo: 'Uber',
                date: '2026-03-20',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      text: 'my account is Amex Gold',
      traceId: 'image-expense',
    });

    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: LIABILITY_ACCOUNT_ID,
      category: 'Transit',
      amount: 23.45,
      memo: 'Uber',
      date: shanghaiMidnightUtcIso('2026-03-20'),
    });
    expect(result.ocrText).toContain('AMEX GOLD');
    expect(result.normalizedText).toContain('merchant: Uber');
    expect(result.normalizedText).not.toContain('my account is Amex Gold');
    expect(result.normalizedText).not.toContain('user_note_raw:');
    expect(result.userInstruction).toBe('my account is Amex Gold');
    expect(result.conflictNotes).toBeNull();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].intent).toBe('create_expense');

    const firstBody = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    ) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };

    expect(firstBody.contents[0].parts[0]).toMatchObject({
      inlineData: {
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      },
    });

    const secondBody = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]!.body as string,
    ) as {
      contents: Array<{
        parts: Array<{ text?: string }>;
      }>;
    };

    const imagePlannerPrompt = secondBody.contents[0]?.parts[0]?.text ?? '';

    expect(imagePlannerPrompt).toContain('- create_account');
    expect(imagePlannerPrompt).toContain('"no_action": "ignore_transaction" | "no_action"');
    expect(imagePlannerPrompt).toContain('"user_instruction": "my account is Amex Gold"');
    expect(imagePlannerPrompt).not.toContain('user_note_raw:');
  });

  it('treats empty OCR optional string fields as absent', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'AMEX GOLD\\nUBER\\n$23.45\\n2026-03-20',
          visible_fields: {
            account_label_seen: '',
            card_program_label: '   ',
            merchant: 'Uber',
            amount: 23.45,
            currency: '   ',
            transaction_date: '2026-03-20',
            status: '',
            reference_id: '   ',
            location: '',
            installment_details: '   ',
            transaction_count: 1,
          },
          normalized_english_text: [
            'merchant: Uber',
            'amount: 23.45',
            'transaction_date: 2026-03-20',
          ].join('\\n'),
          user_instruction: '',
          conflict_notes: '   ',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_expense',
              payload: {
                accountId: LIABILITY_ACCOUNT_ID,
                category: 'Transit',
                amount: 23.45,
                memo: 'Uber',
                date: '2026-03-20',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
    });

    expect(result.userInstruction).toBeNull();
    expect(result.conflictNotes).toBeNull();
    expect(result.normalizedText).toContain('merchant: Uber');
    expect(result.normalizedText).toContain('transaction_date: 2026-03-20');
    expect(result.normalizedText).not.toContain('account_label_seen:');
    expect(result.normalizedText).not.toContain('currency:');

    const secondBody = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]!.body as string,
    ) as {
      contents: Array<{
        parts: Array<{ text?: string }>;
      }>;
    };

    const imagePlannerPrompt = secondBody.contents[0]?.parts[0]?.text ?? '';

    expect(imagePlannerPrompt).not.toContain('"user_instruction"');
    expect(imagePlannerPrompt).not.toContain('"conflict_notes"');
  });

  it('creates an asset expense from a debit card image request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'BANK OF CHINA\\nDEBIT CARD [2805]\\nKOREAN FOOD\\nCNY 16.64\\n2026-03-10 19:43:24',
          visible_fields: {
            account_label_seen: 'Bank of China (Hong Kong) Limited',
            card_program_label: 'Debit card[2805]',
            merchant: 'Haikou Meilan Jingshangdao Korean Food House',
            amount: 16.64,
            currency: 'CNY',
            transaction_date: '2026-03-10',
            transaction_count: 1,
          },
          normalized_english_text: [
            'merchant: Haikou Meilan Jingshangdao Korean Food House',
            'amount: 16.64',
            'currency: CNY',
            'payment_method: Bank of China (Hong Kong) Limited Debit card[2805]',
            'transaction_date: 2026-03-10',
          ].join('\\n'),
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_assets_expense',
              payload: {
                accountId: ASSET_ACCOUNT_ID,
                amount: 16.64,
                memo: 'Haikou Meilan Jingshangdao Korean Food House',
                date: '2026-03-10',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      traceId: 'image-asset-expense',
    });

    expect(mockCreateAssetsExpense).toHaveBeenCalledWith({
      accountId: ASSET_ACCOUNT_ID,
      amount: 16.64,
      memo: 'Haikou Meilan Jingshangdao Korean Food House',
      date: shanghaiMidnightUtcIso('2026-03-10'),
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].intent).toBe('create_assets_expense');
  });

  it('creates an asset expense from image OCR and user note', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'BOA CHECKING\\nCOFFEE BEAN\\n$9.25\\n2026-03-20',
          visible_fields: {
            account_label_seen: 'BoA Checking',
            merchant: 'Coffee Bean',
            amount: 9.25,
            currency: 'USD',
            transaction_date: '2026-03-20',
            transaction_count: 1,
          },
          normalized_english_text: [
            'account_label_seen: BoA Checking',
            'merchant: Coffee Bean',
            'amount: 9.25',
            'transaction_date: 2026-03-20',
          ].join('\\n'),
          user_instruction: 'my debit account is BoA Checking',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_assets_expense',
              payload: {
                accountId: ASSET_ACCOUNT_ID,
                amount: 9.25,
                memo: 'Coffee Bean',
                date: '2026-03-20',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      text: 'my debit account is BoA Checking',
      traceId: 'image-asset-expense',
    });

    expect(mockCreateAssetsExpense).toHaveBeenCalledWith({
      accountId: ASSET_ACCOUNT_ID,
      amount: 9.25,
      memo: 'Coffee Bean',
      date: shanghaiMidnightUtcIso('2026-03-20'),
    });
    expect(result.userInstruction).toBe('my debit account is BoA Checking');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].intent).toBe('create_assets_expense');
  });

  it('uses a date-only planner contract for image expenses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'HSBC CREDIT CARD\\nDuty Free\\nCNY 8030.00\\n2026.3.5 18:30:09',
          visible_fields: {
            account_label_seen: 'HSBC',
            card_program_label: 'Credit card[8719]',
            merchant: 'China Duty Free',
            amount: 8030,
            currency: 'CNY',
            transaction_date: '2026-03-05',
            transaction_count: 1,
          },
          normalized_english_text: [
            'merchant: China Duty Free',
            'amount: 8030.00',
            'currency: CNY',
            'transaction_date: 2026-03-05',
          ].join('\\n'),
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_expense',
              payload: {
                accountId: LIABILITY_ACCOUNT_ID,
                category: 'Shopping',
                amount: 8030,
                memo: 'China Duty Free',
                date: '2026-03-05',
              },
            },
          ],
        })) as unknown as Response,
      );

    await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      traceId: 'image-effective-date',
    });

    const secondBody = JSON.parse(
      vi.mocked(fetch).mock.calls[1][1]!.body as string,
    ) as {
      contents: Array<{
        parts: Array<{ text?: string }>;
      }>;
    };

    const plannerPrompt = secondBody.contents[0]?.parts[0]?.text ?? '';

    expect(plannerPrompt).toContain('- create_account');
    expect(plannerPrompt).toContain('- create_assets_expense');
    expect(plannerPrompt).toContain('- create_expense');
    expect(plannerPrompt).toContain('- create_transfer');
    expect(plannerPrompt).toContain('"date": "YYYY-MM-DD, for example 2026-03-21"');
    expect(plannerPrompt).toContain('The normalized_text contains only image-derived facts.');
    expect(plannerPrompt).not.toContain('effective_date');
    expect(plannerPrompt).not.toContain('user_note_raw:');
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: LIABILITY_ACCOUNT_ID,
      category: 'Shopping',
      amount: 8030,
      memo: 'China Duty Free',
      date: shanghaiMidnightUtcIso('2026-03-05'),
    });
  });

  it('returns no_action for a declined image transaction', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'ICBC VISA ... 6544 Data Plan Declined 27/1/2026 USD 2.00',
          visible_fields: {
            account_label_seen: 'ICBC Card',
            card_program_label: 'VISA',
            merchant: 'Data Plan',
            amount: 2,
            currency: 'USD',
            transaction_date: '2026-01-27',
            status: 'Declined',
            pending: false,
            transaction_count: 1,
          },
          normalized_english_text: [
            'merchant: Data Plan',
            'amount: 2.00',
            'currency: USD',
            'status: Declined',
            'transaction_date: 2026-01-27',
          ].join('\\n'),
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          no_action: 'ignore_transaction',
          reason: 'declined transaction',
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      traceId: 'image-no-action',
    });

    expect(mockCreateTransaction).not.toHaveBeenCalled();
    expect(mockCreateTransfer).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(result.steps).toHaveLength(0);
    expect(result.noAction).toBe('ignore_transaction');
    expect(result.noActionReason).toBe('declined transaction');
  });

  it('creates only an account from a balance overview image', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'Octopus Balance HKD 32.50 Add Money',
          visible_fields: {
            screen_type: 'balance_overview',
            card_program_label: 'Octopus',
            amount: 32.5,
            currency: 'HKD',
            transaction_date: '2026-03-22',
            transaction_count: 1,
          },
          normalized_english_text: [
            'screen_type: balance_overview',
            'card_program_label: Octopus',
            'displayed_balance: 32.50',
            'currency: HKD',
            'transaction_date: 2026-03-22',
          ].join('\\n'),
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_account',
              payload: {
                name: 'Octopus Card',
                type: 'ASSET',
                currency: 'HKD',
                balance: 0,
                credit_limit: 0,
                reward_currency: null,
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      traceId: 'image-balance-overview',
    });

    expect(mockCreateAccount).toHaveBeenCalledWith({
      name: 'Octopus Card',
      type: 'ASSET',
      currency: 'HKD',
      balance: 0,
      credit_limit: 0,
      reward_currency: null,
    });
    expect(mockCreateTransaction).not.toHaveBeenCalled();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].intent).toBe('create_account');
  });

  it('creates a transfer from one image request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'BOA CHECKING -> AMEX GOLD\\n$55.25',
          visible_fields: {
            amount: 55.25,
            transaction_date: '2026-03-21',
            transaction_count: 1,
          },
          normalized_english_text: [
            'amount: 55.25',
            'transaction_date: 2026-03-21',
          ].join('\\n'),
          user_instruction: 'transfer 55.25 from BoA Checking to Amex Gold',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_transfer',
              payload: {
                fromAccountId: ASSET_ACCOUNT_ID,
                toAccountId: LIABILITY_ACCOUNT_ID,
                amount: 55.25,
                memo: 'Payment',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      text: 'transfer 55.25 from BoA Checking to Amex Gold',
      traceId: 'image-transfer',
    });

    expect(mockCreateTransfer).toHaveBeenCalledWith({
      fromAccountId: ASSET_ACCOUNT_ID,
      toAccountId: LIABILITY_ACCOUNT_ID,
      amount: 55.25,
      memo: 'Payment',
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].intent).toBe('create_transfer');
  });

  it('creates an account and then an expense from one image request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'NEW CARD\\nSTARBUCKS\\n$8.25\\n2026-03-20',
          visible_fields: {
            account_label_seen: 'New Card',
            merchant: 'Starbucks',
            amount: 8.25,
            currency: 'USD',
            transaction_date: '2026-03-20',
            transaction_count: 1,
          },
          normalized_english_text: [
            'account_label_seen: New Card',
            'merchant: Starbucks',
            'amount: 8.25',
            'transaction_date: 2026-03-20',
          ].join('\\n'),
          user_instruction: 'I do not have this account yet, create it first',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_account',
              resultAlias: 'new_account_1',
              payload: {
                name: 'New Card',
                type: 'LIABILITY',
                currency: 'USD',
                balance: 0,
                credit_limit: 0,
                reward_currency: null,
              },
            },
            {
              intent: 'create_expense',
              payload: {
                accountId: '@new_account_1',
                category: 'Dining',
                amount: 8.25,
                memo: 'Starbucks',
                date: '2026-03-20',
              },
            },
          ],
        })) as unknown as Response,
      );

    const result = await createByIntentFromImage({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      text: 'I do not have this account yet, create it first',
      traceId: 'image-two-step',
    });

    expect(mockCreateAccount).toHaveBeenCalledWith({
      name: 'New Card',
      type: 'LIABILITY',
      currency: 'USD',
      balance: 0,
      credit_limit: 0,
      reward_currency: null,
    });
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: CREATED_ACCOUNT_ID,
      category: 'Dining',
      amount: 8.25,
      memo: 'Starbucks',
      date: shanghaiMidnightUtcIso('2026-03-20'),
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].intent).toBe('create_account');
    expect(result.steps[1].intent).toBe('create_expense');
  });

  it('fails when a plan references an unknown alias', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: '',
          visible_fields: {
            transaction_date: '2026-03-21',
            transaction_count: 1,
          },
          normalized_english_text: [
            'transaction_date: 2026-03-21',
          ].join('\\n'),
          user_instruction: 'record 10 for coffee',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_expense',
              payload: {
                accountId: '@missing_alias',
                category: 'Dining',
                amount: 10,
                date: '2026-03-21',
              },
            },
          ],
        })) as unknown as Response,
      );

    await expect(
      createByIntentFromImage({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
        text: 'record 10 for coffee',
      }),
    ).rejects.toThrow('Unknown result alias: missing_alias');
  });

  it('fails when a non-account step defines resultAlias', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          raw_text: 'AMEX GOLD\\n$12.00',
          visible_fields: {
            transaction_date: '2026-03-21',
            transaction_count: 1,
          },
          normalized_english_text: 'transaction_date: 2026-03-21',
        })) as unknown as Response,
      )
      .mockResolvedValueOnce(
        makeGeminiResponse(JSON.stringify({
          steps: [
            {
              intent: 'create_expense',
              resultAlias: 'bad_alias',
              payload: {
                accountId: LIABILITY_ACCOUNT_ID,
                category: 'Dining',
                amount: 12,
                date: '2026-03-21',
              },
            },
          ],
        })) as unknown as Response,
      );

    await expect(
      createByIntentFromImage({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/Unrecognized key/);
  });

  it('fails when the OCR detects multiple transactions in one image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGeminiResponse(JSON.stringify({
        raw_text: 'Transaction 1\\nTransaction 2',
        visible_fields: {
          transaction_date: '2026-03-21',
          transaction_count: 2,
        },
        normalized_english_text: 'multiple transactions detected\\ntransaction_date: 2026-03-21',
      })) as unknown as Response,
    );

    await expect(
      createByIntentFromImage({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Image must contain exactly one transaction');

    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });
});
