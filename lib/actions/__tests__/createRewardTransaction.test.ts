import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { createRewardTransaction } from '@/lib/actions/reward-actions';
import { TransactionType } from '@/lib/types/transactions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

const DATE = '2026-03-16';

describe('createRewardTransaction', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('adds reward balance for a transfer-in transaction', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_currency: 'MR',
      reward_balance: 1000,
    });

    const result = await createRewardTransaction({
      accountId,
      type: TransactionType.REWARD_TRANSFER_IN,
      amount: 500,
      memo: 'Welcome bonus',
      date: DATE,
    });

    expect(result.transaction).toMatchObject({
      type: 'REWARD_TRANSFER_IN',
      reward_currency: 'MR',
      to_account: accountId,
      from_account: null,
    });
    expect((await getAccount(ctx.db, accountId)).reward_balance).toBe(1500);
  });

  it('subtracts reward balance for a redeem', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_currency: 'MR',
      reward_balance: 1000,
    });

    const result = await createRewardTransaction({
      accountId,
      type: TransactionType.REWARD_REDEEM,
      amount: 400,
      date: DATE,
    });

    expect(result.transaction).toMatchObject({ from_account: accountId, to_account: null });
    expect((await getAccount(ctx.db, accountId)).reward_balance).toBe(600);
  });

  it('rejects a redeem that would overdraw the reward balance', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_currency: 'MR',
      reward_balance: 200,
    });

    await expect(
      createRewardTransaction({
        accountId,
        type: TransactionType.REWARD_REDEEM,
        amount: 500,
        date: DATE,
      }),
    ).rejects.toThrow('Insufficient reward balance');

    // No partial write on rejection.
    expect((await getAccount(ctx.db, accountId)).reward_balance).toBe(200);
  });

  it('rejects an account with no fixed reward currency', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY' });
    await expect(
      createRewardTransaction({
        accountId,
        type: TransactionType.REWARD_TRANSFER_IN,
        amount: 100,
        date: DATE,
      }),
    ).rejects.toThrow('This account does not have a fixed reward currency');
  });

  it('rejects a non-liability account', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });
    await expect(
      createRewardTransaction({
        accountId,
        type: TransactionType.REWARD_TRANSFER_IN,
        amount: 100,
        date: DATE,
      }),
    ).rejects.toThrow('Reward actions are only supported on liability accounts');
  });
});
