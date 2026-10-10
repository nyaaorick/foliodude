import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { createAccount } from '@/lib/actions/create-accounts-actions';
import { seedAccount as rawSeedAccount, createTestContext, getAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('createAccount', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('creates an ASSET account with sensible zeroed-out non-asset fields', async () => {
    const account = await createAccount({
      name: 'Checking',
      type: 'ASSET' as never,
      balance: 100,
      currency: 'USD' as never,
    });

    expect(account).toMatchObject({ name: 'Checking', type: 'ASSET', balance: 100 });
    expect(account.shares).toBe(0);
    expect(account.reward_currency).toBeNull();
  });

  it('rejects a blank name', async () => {
    await expect(
      createAccount({ name: '   ', type: 'ASSET' as never, balance: 0, currency: 'USD' as never }),
    ).rejects.toThrow('Name is required');
  });

  it('attaches the default cloud rule set when a LIABILITY declares a reward currency', async () => {
    const account = await createAccount({
      name: 'Amex Gold',
      type: 'LIABILITY' as never,
      balance: 0,
      currency: 'USD' as never,
      reward_currency: 'MR' as never,
    });

    expect(account.reward_currency).toBe('MR');
    expect(Array.isArray(account.reward_rules)).toBe(true);
    expect((account.reward_rules as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects a fractional mileage balance', async () => {
    await expect(
      createAccount({
        name: 'Miles',
        type: 'AIRLINE_MILES' as never,
        balance: 10.5,
        currency: 'USD' as never,
        airline_program: 'KRISFLYER' as never,
      }),
    ).rejects.toThrow('Mileage balance must be a non-negative integer');
  });

  it('rejects an AIRLINE_MILES account without a program', async () => {
    await expect(
      createAccount({ name: 'Miles', type: 'AIRLINE_MILES' as never, balance: 0, currency: 'USD' as never }),
    ).rejects.toThrow('Airline program is required for mileage accounts');
  });

  it('rejects a second mileage account for the same program', async () => {
    const input = {
      name: 'Miles',
      type: 'AIRLINE_MILES' as never,
      balance: 0,
      currency: 'USD' as never,
      airline_program: 'KRISFLYER' as never,
    };
    await createAccount(input);
    await expect(createAccount(input)).rejects.toThrow(
      'This airline program already has a mileage account',
    );
  });

  it('creates a SHARE account with no initial position when shares are omitted', async () => {
    const brokerageId = await rawSeedAccount(ctx, { type: 'ASSET', name: 'IBKR', balance: 1000 });

    const account = await createAccount({
      name: 'ignored',
      type: 'SHARE' as never,
      balance: 0,
      currency: 'USD' as never,
      ticker: 'aapl' as never,
      brokerage_account_id: brokerageId as never,
    });

    expect(account).toMatchObject({ ticker: 'AAPL', shares: 0, balance: 0 });
    // Brokerage cash is untouched — no purchase happened.
    expect((await getAccount(ctx.db, brokerageId)).balance).toBe(1000);
  });

  it('funds an initial SHARE position from the brokerage cash account atomically', async () => {
    const brokerageId = await rawSeedAccount(ctx, { type: 'ASSET', name: 'IBKR', balance: 1000 });

    const account = await createAccount({
      name: 'ignored',
      type: 'SHARE' as never,
      balance: 0,
      currency: 'USD' as never,
      ticker: 'AAPL' as never,
      brokerage_account_id: brokerageId as never,
      initial_shares: 2,
      initial_price: 100,
      deduct_from_brokerage: true,
    });

    expect(account).toMatchObject({ shares: 2, cost_basis: 200, balance: 200 });
    expect((await getAccount(ctx.db, brokerageId)).balance).toBe(800); // 1000 - 2*100
  });

  it('rolls back account creation entirely when the initial buy fails insufficient-funds', async () => {
    const brokerageId = await rawSeedAccount(ctx, { type: 'ASSET', name: 'IBKR', balance: 10 });

    await expect(
      createAccount({
        name: 'ignored',
        type: 'SHARE' as never,
        balance: 0,
        currency: 'USD' as never,
        ticker: 'AAPL' as never,
        brokerage_account_id: brokerageId as never,
        initial_shares: 5,
        initial_price: 100,
        deduct_from_brokerage: true,
      }),
    ).rejects.toThrow('Insufficient balance');

    // No orphaned SHARE row — the whole transaction rolled back.
    const { rows } = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts WHERE type = 'SHARE'");
    expect(rows[0]?.n).toBe(0);
  });

  it('seeds an initial position directly when not deducting from brokerage cash', async () => {
    const brokerageId = await rawSeedAccount(ctx, { type: 'ASSET', name: 'IBKR', balance: 1000 });

    const account = await createAccount({
      name: 'ignored',
      type: 'SHARE' as never,
      balance: 0,
      currency: 'USD' as never,
      ticker: 'AAPL' as never,
      brokerage_account_id: brokerageId as never,
      initial_shares: 3,
      initial_price: 50,
      deduct_from_brokerage: false,
    });

    expect(account).toMatchObject({ shares: 3, cost_basis: 150, balance: 150 });
    // Cash is untouched: this position was seeded, not purchased.
    expect((await getAccount(ctx.db, brokerageId)).balance).toBe(1000);
  });

  it('rejects a SHARE account without a brokerage cash account', async () => {
    await expect(
      createAccount({
        name: 'ignored',
        type: 'SHARE' as never,
        balance: 0,
        currency: 'USD' as never,
        ticker: 'AAPL' as never,
      }),
    ).rejects.toThrow('Brokerage cash account is required for share accounts');
  });

  it('rejects a brokerage cash account that is not USD', async () => {
    const brokerageId = await rawSeedAccount(ctx, { type: 'ASSET', currency: 'EUR' });
    await expect(
      createAccount({
        name: 'ignored',
        type: 'SHARE' as never,
        balance: 0,
        currency: 'USD' as never,
        ticker: 'AAPL' as never,
        brokerage_account_id: brokerageId as never,
      }),
    ).rejects.toThrow('Brokerage cash account must use USD');
  });
});
