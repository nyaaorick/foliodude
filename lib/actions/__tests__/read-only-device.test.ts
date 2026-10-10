import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/session')>()),
  getSessionContext: mockGetSessionContext,
}));

import {
  applyCloudRewardRules,
  importRewardRules,
  updateRewardRate,
} from '@/lib/actions/reward-actions';
import { updateMileageRate, updateMileageTransferRates } from '@/lib/actions/mileage-actions';
import { createMemoryDb } from '@/lib/db/client';
import { guardWrites } from '@/lib/db/session';
import { seedAccount } from '@/lib/db/testing';
import { clearWriter, observeWriter } from '@/lib/sync/writer';

// The single-writer rule is enforced at `db.transaction()`. These edit tables
// that sync to Drive, so a read-only device that managed to write them would
// have its edit silently replaced by the next restore.
describe('read-only device', () => {
  let attempts: Array<() => Promise<unknown>>;

  beforeEach(async () => {
    const raw = await createMemoryDb();
    const card = await seedAccount({ db: raw }, { type: 'LIABILITY', reward_currency: 'MR' });
    const miles = await seedAccount(
      { db: raw },
      { type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER' },
    );
    mockGetSessionContext.mockResolvedValue({ db: guardWrites(raw) });

    attempts = [
      () => updateRewardRate({ rewardCurrency: 'MR', usdPer10kPoints: 180 }),
      () => updateMileageRate({ accountId: miles, usdPer10kMiles: 130 }),
      () => updateMileageTransferRates({ accountId: miles, rates: { MR: 1 } }),
      () =>
        importRewardRules({
          accountId: card,
          ruleSet: {
            id: 'local-json',
            name: 'Local Import',
            source: 'imported',
            version: 1,
            rules: [{ category: 'Dining', multiplier: 3, currency: 'MR', rule_source: 'cloud' }],
          },
        }),
      () => applyCloudRewardRules({ accountId: card, ruleSetId: 'amex-gold-core' }),
    ];
  });

  afterEach(() => clearWriter());

  /** Why the action did not succeed, or null if it wrote. */
  async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
      const result = (await run()) as { success?: boolean; error?: string } | undefined;
      return result?.success === false ? (result.error ?? 'failed') : null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('refuses every reward/mileage rate and rule edit, and allows them once it is the writer', async () => {
    observeWriter({ deviceId: 'another-device', deviceName: 'Mac · Web' });
    for (const run of attempts) {
      expect(await refusal(run)).toMatch(/read-only/);
    }

    // Control: with no other writer the same calls succeed, so the refusals
    // above came from the guard and not from bad input.
    clearWriter();
    for (const run of attempts) {
      expect(await refusal(run)).toBeNull();
    }
  });
});
