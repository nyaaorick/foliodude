import { describe, expect, it } from 'vitest';
import type { AirlineProgram } from '@/lib/types/mileage';
import type { RewardCurrencyId } from '@/lib/types/rewards';
import { getAirlineProgramLabel, getRewardCurrencyLabel } from '@/lib/utils/display-labels';

// The label strings restate the source; the part worth guarding is that an
// unknown id fails loudly instead of rendering a blank.
describe('display labels', () => {
  it('throws on unsupported values', () => {
    expect(() => getAirlineProgramLabel('BAD_VALUE' as AirlineProgram)).toThrowError(
      'Unknown airline program: BAD_VALUE',
    );
    expect(() => getRewardCurrencyLabel('BAD_VALUE' as RewardCurrencyId)).toThrowError(
      'Unknown reward currency: BAD_VALUE',
    );
  });
});
