import Decimal from 'decimal.js';
import { z } from 'zod';
import { getSessionContext } from '@/lib/db/session';
import { loadAccount } from '@/lib/db/ledger';
import { one } from '@/lib/db/sql';
import type { Queryable } from '@/lib/db/session';
import { AccountType } from '@/lib/types/accounts';
import type { Account } from '@/lib/types/accounts';
import { roundMoneyNumber } from '@/lib/utils/financial-analytics';

const UpdateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  balance: z.number().finite().optional(),
});

const SetAssetApySchema = z.object({
  id: z.string().uuid(),
  apy: z.number().finite().nonnegative(),
});

function loadAccountFlat(db: Queryable, id: string): Promise<Account> {
  return one<Account>(db, 'SELECT * FROM accounts_flat WHERE id = $1', [id], 'Account not found');
}

/** Rename an account, and optionally correct its balance in the same write. */
export async function updateAccount(
  input: z.infer<typeof UpdateAccountSchema>,
): Promise<Account> {
  const { db } = await getSessionContext();
  const parsed = UpdateAccountSchema.parse(input);

  return db.transaction(async (tx) => {
    const existing = await loadAccount<{ type: AccountType }>(tx, parsed.id, 'type');

    let balance: number | undefined;

    if (parsed.balance !== undefined) {
      if (existing.type === AccountType.SHARE) {
        throw new Error('Share account balances cannot be edited directly');
      }

      if (existing.type === AccountType.AIRLINE_MILES) {
        if (!Number.isInteger(parsed.balance)) {
          throw new Error('Mileage balances must be whole numbers');
        }
        balance = parsed.balance;
      } else {
        const value = new Decimal(parsed.balance);
        if ((value.decimalPlaces() ?? 0) > 2) {
          throw new Error('Balance must have at most 2 decimal places');
        }
        balance = value.toNumber();
      }
    }

    await tx.query(
      balance === undefined
        ? 'UPDATE accounts SET name = $1 WHERE id = $2'
        : 'UPDATE accounts SET name = $1, balance = $3 WHERE id = $2',
      balance === undefined ? [parsed.name.trim(), parsed.id] : [parsed.name.trim(), parsed.id, balance],
    );
    return loadAccountFlat(tx, parsed.id);
  });
}

/** Store an asset account's APY. */
export async function setAssetApy(
  input: z.infer<typeof SetAssetApySchema>,
): Promise<Account> {
  const { db } = await getSessionContext();
  const parsed = SetAssetApySchema.parse(input);
  const normalizedApy = roundMoneyNumber(parsed.apy);

  return db.transaction(async (tx) => {
    const account = await loadAccount<{ type: AccountType }>(tx, parsed.id, 'type');

    if (account.type !== AccountType.ASSET) {
      throw new Error('APY can only be set on asset accounts');
    }

    await tx.query('UPDATE accounts SET apy = $1 WHERE id = $2', [normalizedApy, parsed.id]);
    return loadAccountFlat(tx, parsed.id);
  });
}
