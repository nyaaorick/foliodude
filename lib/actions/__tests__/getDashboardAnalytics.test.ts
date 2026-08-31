import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext, mockFetchUsdExchangeRates } = vi.hoisted(() => ({
  mockGetSessionContext: vi.fn(),
  mockFetchUsdExchangeRates: vi.fn().mockResolvedValue({ USD: 1 }),
}));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));
vi.mock('@/lib/utils/fx-rates', () => ({ fetchUsdExchangeRates: mockFetchUsdExchangeRates }));

import { getDashboardAnalytics } from '@/lib/actions/getDashboardAnalytics';
import { createTestContext, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('getDashboardAnalytics', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('summarizes accounts and creates today\'s net worth snapshot once', async () => {
    await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 1000 });
    await seedAccount(ctx, { type: 'LIABILITY', currency: 'USD', balance: -200 });

    const result = await getDashboardAnalytics();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.totals).toEqual({ assetsUsd: 1000, liabilitiesUsd: 200, netWorthUsd: 800 });

    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM net_worth_snapshots');

    await getDashboardAnalytics(); // second call, same day
    const again = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM net_worth_snapshots');
    expect(again.rows[0]?.n).toBe((rows[0] as { n: number }).n);
  });
});
