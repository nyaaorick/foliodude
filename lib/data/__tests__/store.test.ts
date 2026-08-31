import { describe, expect, it } from 'vitest';

import { getVersion, revalidate, subscribe } from '../store';

describe('revalidation bus', () => {
  it('notifies subscribers and advances the version they read', () => {
    const seen: number[] = [];
    const unsubscribe = subscribe(() => seen.push(getVersion()));
    const before = getVersion();

    revalidate();
    revalidate();
    unsubscribe();
    revalidate();

    // Two notifications while subscribed, each already carrying the bumped
    // version, and none after unsubscribing.
    expect(seen).toEqual([before + 1, before + 2]);
  });
});
