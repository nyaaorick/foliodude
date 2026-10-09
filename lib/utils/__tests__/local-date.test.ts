import { describe, expect, it } from 'vitest';

import { localToday } from '@/lib/utils/local-date';

describe('localToday', () => {
  it('returns the device calendar day, not the UTC day', () => {
    // 07:00 local: east of UTC the UTC day is still yesterday, west it is the same day.
    expect(localToday(new Date(2026, 0, 2, 7, 0))).toBe('2026-01-02');
    expect(localToday(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
