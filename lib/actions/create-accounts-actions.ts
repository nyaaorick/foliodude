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
import { buyShareWithinTransaction, syncShareBalance } from '@/lib/actions/share-actions';
import type { Tx } from '@/lib/db/tx';
import { localToday } from '@/lib/utils/local-date';

const CreateAccountSchema = z.object({
  name: z.string().trim().optional(),
  type: z.nativeEnum(AccountType),
  balance: z.number().finite(),
  currency: z.enum(Object.keys(SUPPORTED_CURRENCIES) as [CurrencyId, ...CurrencyId[]]),
  credit_limit: z.number().finite().optional(),
  reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable().optional(),
  airline_program: z.enum(AIRLINE_PROGRAM_IDS).optional(),
  usd_per_10k_miles: z.number().int().nonnegative().optional(),
  ticker: z.string().trim().optional(),
  brokerage_account_id: z.string().uuid().optional(),
  initial_shares: z.number().finite().min(0).optional(),
  initial_price: z.number().finite().min(0).optional(),
  deduct_from_brokerage: z.boolean().optional(),
});

type CreateAccountData = z.infer<typeof CreateAccountSchema>;

interface BrokerageAccountRecord {
  id: string;
  type: AccountType;
  currency: string;
  name: string;
}

type ShareAccountInput = CreateAccountData & {
  type: AccountType.SHARE;
  ticker: string;
  brokerage_account_id: string;
};

/** Insert the `accounts` row every account has; returns its id. */
async function insertBaseAccount(
  tx: Tx,
  fields: { name: string; type: AccountType; currency: string; balance: number },
): Promise<string> {
  const created = await one<{ id: string }>(
    tx,
    `INSERT INTO accounts (name, type, currency, balance) VALUES ($1, $2, $3, $4) RETURNING id`,
    [fields.name, fields.type, fields.currency, fields.balance],
    'Failed to create account',
  );
  return created.id;
}

function loadCreatedAccount(tx: Tx, id: string): Promise<Account> {
  return one<Account>(
    tx,
    'SELECT * FROM accounts_flat WHERE id = $1',
    [id],
    'Failed to load created account',
  );
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
  tx: Tx,
  brokerageAccountId: string,
): Promise<BrokerageAccountRecord> {
  const account = await one<BrokerageAccountRecord>(
    tx,
    'SELECT id, type, currency, name FROM accounts WHERE id = $1',
    [brokerageAccountId],
    'Brokerage cash account not found',
  );
  if (account.type !== AccountType.ASSET) throw new Error('Brokerage cash account must be an asset account');
  if (account.currency !== 'USD') throw new Error('Brokerage cash account must use USD');
  return account;
}

async function createAssetAccount(tx: Tx, input: CreateAccountData): Promise<Account> {
  const id = await insertBaseAccount(tx, {
    name: requireAccountName(input),
    type: AccountType.ASSET,
    currency: input.currency,
    balance: input.balance,
  });
  return loadCreatedAccount(tx, id);
}

async function createLiabilityAccount(tx: Tx, input: CreateAccountData): Promise<Account> {
  const hasRewardCurrency = (input.reward_currency ?? null) !== null;
  let rewardRules: unknown[] = [];

  if (hasRewardCurrency) {
    const defaultLiabilityRuleSet = getCloudRewardRuleSet('amex-gold-core');
    if (!defaultLiabilityRuleSet) {
      throw new Error('Default liability cloud reward rule set not found: amex-gold-core');
    }
    rewardRules = defaultLiabilityRuleSet.rules;
  }

  const id = await insertBaseAccount(tx, {
    name: requireAccountName(input),
    type: AccountType.LIABILITY,
    currency: input.currency,
    balance: input.balance,
  });
  await tx.query(
    `INSERT INTO liability_details (account_id, credit_limit, reward_currency, reward_rules)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [id, input.credit_limit ?? null, input.reward_currency ?? null, JSON.stringify(rewardRules)],
  );
  return loadCreatedAccount(tx, id);
}

async function createAirlineMilesAccount(tx: Tx, input: CreateAccountData): Promise<Account> {
  if (!input.airline_program) throw new Error('Airline program is required for mileage accounts');
  if (!Number.isInteger(input.balance) || input.balance < 0) {
    throw new Error('Mileage balance must be a non-negative integer');
  }

  const accountName = getAirlineProgramDefinition(input.airline_program)?.displayName ?? input.airline_program;

  const id = await insertBaseAccount(tx, {
    name: accountName,
    type: AccountType.AIRLINE_MILES,
    currency: 'USD',
    balance: input.balance,
  });

  try {
    await tx.query(
      `INSERT INTO mileage_details (account_id, airline_program, usd_per_10k_miles, transfer_rates)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        id,
        input.airline_program,
        input.usd_per_10k_miles ?? 0,
        JSON.stringify(getDefaultMileageTransferRates()),
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('This airline program already has a mileage account');
    throw error;
  }
  return loadCreatedAccount(tx, id);
}

/**
 * Create a SHARE account, and — if an initial position is given — fund it in
 * the same transaction. This whole function runs inside one `db.transaction()`,
 * so a failed initial buy rolls the account creation back with it.
 */
async function createShareAccount(tx: Tx, input: ShareAccountInput): Promise<Account> {
  const brokerageAccount = await loadBrokerageCashAccount(tx, input.brokerage_account_id);

  const initialShares = roundSharesDecimal(input.initial_shares ?? 0);
  const initialPrice = new Decimal(input.initial_price ?? 0);
  const shouldInitializePosition = initialShares.gt(0);
  const shouldDeductFromBrokerage = Boolean(input.deduct_from_brokerage);

  if (shouldInitializePosition && !initialPrice.gt(0)) {
    throw new Error('Cost per share is required when initial shares are greater than 0');
  }

  const id = await insertBaseAccount(tx, {
    name: buildShareAccountName(input.ticker, brokerageAccount.name),
    type: AccountType.SHARE,
    currency: 'USD',
    balance: 0,
  });

  // A position that is not funded from the brokerage cash account is seeded
  // directly (e.g. shares transferred in from elsewhere): no cash movement.
  const seeded = shouldInitializePosition && !shouldDeductFromBrokerage;

  try {
    await tx.query(
      `INSERT INTO share_details
         (account_id, brokerage_account_id, ticker, shares, cost_basis, last_price, last_price_date)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::numeric IS NULL THEN NULL ELSE $7::date END)`,
      [
        id,
        input.brokerage_account_id,
        input.ticker,
        seeded ? initialShares.toNumber() : 0,
        seeded ? roundMoneyDecimal(initialShares.mul(initialPrice)).toNumber() : 0,
        seeded ? initialPrice.toNumber() : null,
        localToday(),
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('This cash account already has a position for that ticker');
    throw error;
  }

  if (seeded) {
    await syncShareBalance(tx, id);
  } else if (shouldInitializePosition) {
    await buyShareWithinTransaction(tx, {
      shareAccountId: id,
      brokerageAccountId: input.brokerage_account_id,
      quantity: initialShares.toNumber(),
      price: initialPrice.toNumber(),
      memo: 'Initial position',
    });
  }

  return loadCreatedAccount(tx, id);
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const { db } = await getSessionContext();
  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid account input');
  }

  return db.transaction(async (tx) => {
    switch (parsed.data.type) {
      case AccountType.SHARE:
        return createShareAccount(tx, requireShareAccountInput(parsed.data));
      case AccountType.AIRLINE_MILES:
        return createAirlineMilesAccount(tx, parsed.data);
      case AccountType.LIABILITY:
        return createLiabilityAccount(tx, parsed.data);
      case AccountType.ASSET:
      default:
        return createAssetAccount(tx, parsed.data);
    }
  });
}
