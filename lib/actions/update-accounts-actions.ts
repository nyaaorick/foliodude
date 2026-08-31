import Decimal from 'decimal.js';
import { z } from 'zod';
import { getSessionContext } from '@/lib/db/session';
import { loadAccount } from '@/lib/db/ledger';
import { one } from '@/lib/db/sql';
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

/** Rename an account, and optionally correct its balance in the same write. */
export async function updateAccount(
  input: z.infer<typeof UpdateAccountSchema>,
): Promise<Account> {
  const { db, userId } = await getSessionContext();
  const parsed = UpdateAccountSchema.parse(input);

  return db.transaction(async (tx) => {
    const existing = await loadAccount<{ type: AccountType }>(tx, userId, parsed.id, 'type');

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

    return one<Account>(
      tx,
      balance === undefined
        ? `UPDATE accounts SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *`
        : `UPDATE accounts SET name = $1, balance = $4 WHERE id = $2 AND user_id = $3 RETURNING *`,
      balance === undefined
        ? [parsed.name.trim(), parsed.id, userId]
        : [parsed.name.trim(), parsed.id, userId, balance],
      'Account not found',
    );
  });
}

/**
 * Store an asset account's APY.
 *
 * APY lives inside the `auto_pay_config` JSONB blob, so the update merges rather
 * than replaces — jsonb_set would drop sibling keys if the blob were rewritten
 * wholesale.
 */
export async function setAssetApy(
  input: z.infer<typeof SetAssetApySchema>,
): Promise<Account> {
  const { db, userId } = await getSessionContext();
  const parsed = SetAssetApySchema.parse(input);
  const normalizedApy = roundMoneyNumber(parsed.apy);

  return db.transaction(async (tx) => {
    const account = await loadAccount<{ type: AccountType }>(tx, userId, parsed.id, 'type');

    if (account.type !== AccountType.ASSET) {
      throw new Error('APY can only be set on asset accounts');
    }

    return one<Account>(
      tx,
      `UPDATE accounts
          SET auto_pay_config = COALESCE(auto_pay_config, '{}'::jsonb) || jsonb_build_object('asset_apy', $1::numeric)
        WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [normalizedApy, parsed.id, userId],
      'Account not found',
    );
  });
}
