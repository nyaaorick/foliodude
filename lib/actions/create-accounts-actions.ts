import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { isUniqueViolation, one } from '@/lib/db/sql';
import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import type { CreateAccountInput, Account } from '@/lib/types/accounts';
import { AIRLINE_PROGRAM_IDS, getAirlineProgramDefinition } from '@/lib/types/mileage';
import { getCloudRewardRuleSet } from '@/lib/data/cloud-rules';
import { getDefaultMileageTransferRates } from '@/lib/data/mileage-transfer-rates';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';
import { roundMoneyDecimal, roundSharesDecimal } from '@/lib/utils/financial-analytics';
import { buildShareAccountName } from '@/lib/utils/share-account-name';
import { buyShareWithinTransaction } from '@/lib/actions/share-actions';
import type { Queryable } from '@/lib/db/session';

const CreateAccountSchema = z.object({
  name: z.string().trim().optional(),
  type: z.nativeEnum(AccountType),
  balance: z.number().finite(),
  currency: z.enum(Object.keys(SUPPORTED_CURRENCIES) as [CurrencyId, ...CurrencyId[]]),
  credit_limit: z.number().finite().optional(),
  reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable().optional(),
  airline_program: z.enum(AIRLINE_PROGRAM_IDS).optional(),
  usd_per_10k_miles: z.number().int().nonnegative().optional(),
  brokerage: z.string().trim().optional(),
  ticker: z.string().trim().optional(),
  brokerage_account_id: z.string().uuid().optional(),
  initial_shares: z.number().finite().min(0).optional(),
  initial_price: z.number().finite().min(0).optional(),
  initial_fee: z.number().finite().min(0).optional(),
  deduct_from_brokerage: z.boolean().optional(),
});

type CreateAccountData = z.infer<typeof CreateAccountSchema>;

interface BrokerageAccountRecord {
  id: string;
  type: AccountType;
  currency: string;
  name: string;
  balance: number;
}

type ShareAccountInput = CreateAccountData & {
  type: AccountType.SHARE;
  ticker: string;
  brokerage_account_id: string;
};

/** Every column, defaulted for a non-SHARE account. Callers override what applies. */
const BLANK_ACCOUNT_DEFAULTS = {
  credit_limit: null as number | null,
  reward_currency: null as string | null,
  reward_rules: [] as unknown[],
  reward_balance: 0,
  airline_program: null as string | null,
  usd_per_10k_miles: 0,
  transfer_rates: {} as Record<string, unknown>,
  ticker: null as string | null,
  brokerage_account_id: null as string | null,
  shares: 0,
  cost_basis: 0,
  last_price: null as number | null,
};

async function insertAccount(
  db: Queryable,
  userId: string,
  accountType: AccountType,
  fields: {
    name: string;
    currency: string;
    balance: number;
    brokerage: string | null;
  } & Partial<typeof BLANK_ACCOUNT_DEFAULTS>,
): Promise<Account> {
  const row = { ...BLANK_ACCOUNT_DEFAULTS, ...fields };

  try {
    return await one<Account>(
      db,
      `INSERT INTO accounts
         (user_id, name, type, currency, balance, credit_limit, reward_currency,
          reward_rules, reward_balance, airline_program, usd_per_10k_miles,
          transfer_rates, brokerage, ticker, brokerage_account_id, shares, cost_basis,
          last_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        userId, row.name, accountType, row.currency, row.balance, row.credit_limit,
        row.reward_currency, JSON.stringify(row.reward_rules), row.reward_balance,
        row.airline_program, row.usd_per_10k_miles, JSON.stringify(row.transfer_rates),
        row.brokerage, row.ticker, row.brokerage_account_id, row.shares, row.cost_basis,
        row.last_price,
      ],
      'Failed to create account',
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(
        accountType === AccountType.SHARE
          ? 'This cash account already has a position for that ticker'
          : 'This airline program already has a mileage account',
      );
    }
    throw error;
  }
}

function requireAccountName(input: CreateAccountData): string {
  const accountName = input.name?.trim() ?? '';
  if (!accountName) throw new Error('Name is required');
  return accountName;
}

function requireShareAccountInput(input: CreateAccountData): ShareAccountInput {
  const ticker = input.ticker?.trim().toUpperCase() ?? '';
  if (!ticker) throw new Error('Ticker is required for share accounts');

  const brokerageAccountId = input.brokerage_account_id?.trim() ?? '';
  if (!brokerageAccountId) throw new Error('Brokerage cash account is required for share accounts');

  return { ...input, type: AccountType.SHARE, ticker, brokerage_account_id: brokerageAccountId };
}

async function loadBrokerageCashAccount(
  db: Queryable,
  userId: string,
  brokerageAccountId: string,
): Promise<BrokerageAccountRecord> {
  const account = await one<BrokerageAccountRecord>(
    db,
    'SELECT id, type, currency, name, balance FROM accounts WHERE id = $1 AND user_id = $2',
    [brokerageAccountId, userId],
    'Brokerage cash account not found',
  );
  if (account.type !== AccountType.ASSET) throw new Error('Brokerage cash account must be an asset account');
  if (account.currency !== 'USD') throw new Error('Brokerage cash account must use USD');
  return account;
}

async function createAssetAccount(db: Queryable, userId: string, input: CreateAccountData): Promise<Account> {
  return insertAccount(db, userId, AccountType.ASSET, {
    name: requireAccountName(input),
    currency: input.currency,
    balance: input.balance,
    brokerage: input.brokerage?.trim() || null,
  });
}

async function createLiabilityAccount(db: Queryable, userId: string, input: CreateAccountData): Promise<Account> {
  const hasRewardCurrency = (input.reward_currency ?? null) !== null;
  let rewardRules: unknown[] = [];

  if (hasRewardCurrency) {
    const defaultLiabilityRuleSet = getCloudRewardRuleSet('amex-gold-core');
    if (!defaultLiabilityRuleSet) {
      throw new Error('Default liability cloud reward rule set not found: amex-gold-core');
    }
    rewardRules = defaultLiabilityRuleSet.rules;
  }

  return insertAccount(db, userId, AccountType.LIABILITY, {
    name: requireAccountName(input),
    currency: input.currency,
    balance: input.balance,
    brokerage: input.brokerage?.trim() || null,
    credit_limit: input.credit_limit ?? null,
    reward_currency: input.reward_currency ?? null,
    reward_rules: rewardRules,
  });
}

async function createAirlineMilesAccount(db: Queryable, userId: string, input: CreateAccountData): Promise<Account> {
  if (!input.airline_program) throw new Error('Airline program is required for mileage accounts');
  if (!Number.isInteger(input.balance) || input.balance < 0) {
    throw new Error('Mileage balance must be a non-negative integer');
  }

  const accountName = getAirlineProgramDefinition(input.airline_program)?.displayName ?? input.airline_program;

  return insertAccount(db, userId, AccountType.AIRLINE_MILES, {
    name: accountName,
    currency: 'USD',
    balance: input.balance,
    brokerage: input.brokerage?.trim() || null,
    airline_program: input.airline_program,
    usd_per_10k_miles: input.usd_per_10k_miles ?? 0,
    transfer_rates: getDefaultMileageTransferRates(),
  });
}

/**
 * Create a SHARE account, and — if an initial position is given — fund it in
 * the same transaction. `deleteCreatedAccountOrThrow` from the old Supabase
 * version does not have an equivalent here: this whole function runs inside
 * one `db.transaction()`, so a failed initial buy rolls the account creation
 * back with it instead of needing an explicit compensating delete.
 */
async function createShareAccount(
  db: Queryable,
  userId: string,
  input: ShareAccountInput,
): Promise<Account> {
  const brokerageAccount = await loadBrokerageCashAccount(db, userId, input.brokerage_account_id);

  const initialShares = roundSharesDecimal(input.initial_shares ?? 0);
  const initialPrice = new Decimal(input.initial_price ?? 0);
  const initialFee = roundMoneyDecimal(input.initial_fee ?? 0);
  const shouldInitializePosition = initialShares.gt(0);
  const shouldDeductFromBrokerage = Boolean(input.deduct_from_brokerage);

  if (shouldInitializePosition && !initialPrice.gt(0)) {
    throw new Error('Cost per share is required when initial shares are greater than 0');
  }

  if (shouldInitializePosition && shouldDeductFromBrokerage) {
    const totalCost = roundMoneyDecimal(initialShares.mul(initialPrice).plus(initialFee));
    if (new Decimal(brokerageAccount.balance).lt(totalCost)) {
      throw new Error('Insufficient cash balance');
    }
  }

  const accountName = buildShareAccountName(input.ticker, brokerageAccount.name);
  const created = await insertAccount(db, userId, AccountType.SHARE, {
    name: accountName,
    currency: 'USD',
    balance: 0,
    brokerage: input.brokerage?.trim() || null,
    ticker: input.ticker,
    brokerage_account_id: input.brokerage_account_id,
  });

  if (!shouldInitializePosition) {
    return created;
  }

  if (shouldDeductFromBrokerage) {
    const buyResult = await buyShareWithinTransaction(db, userId, {
      shareAccountId: created.id,
      brokerageAccountId: input.brokerage_account_id,
      quantity: initialShares.toNumber(),
      price: initialPrice.toNumber(),
      fee: initialFee.toNumber(),
      memo: 'Initial position',
    });
    if (!buyResult.success) throw new Error(buyResult.error);

    return one<Account>(
      db,
      'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
      [created.id, userId],
      'Failed to load created share account',
    );
  }

  // Not funded from the brokerage cash account: the position is seeded
  // directly (e.g. shares transferred in from elsewhere), no cash movement.
  const costBasis = roundMoneyDecimal(initialShares.mul(initialPrice).plus(initialFee));
  const balance = roundMoneyDecimal(initialShares.mul(initialPrice));

  return one<Account>(
    db,
    `UPDATE accounts
        SET shares = $1, cost_basis = $2, last_price = $3, last_price_date = CURRENT_DATE, balance = $4
      WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [initialShares.toNumber(), costBasis.toNumber(), initialPrice.toNumber(), balance.toNumber(), created.id, userId],
    'Failed to initialize share position',
  );
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const { db, userId } = await getSessionContext();
  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid account input');
  }

  return db.transaction(async (tx) => {
    switch (parsed.data.type) {
      case AccountType.SHARE:
        return createShareAccount(tx, userId, requireShareAccountInput(parsed.data));
      case AccountType.AIRLINE_MILES:
        return createAirlineMilesAccount(tx, userId, parsed.data);
      case AccountType.LIABILITY:
        return createLiabilityAccount(tx, userId, parsed.data);
      case AccountType.ASSET:
      default:
        return createAssetAccount(tx, userId, parsed.data);
    }
  });
}
