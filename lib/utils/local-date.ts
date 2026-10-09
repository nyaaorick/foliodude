/**
 * Today's calendar date on this device, as `YYYY-MM-DD`.
 *
 * Every date the app writes ("today" for a trade, a price, a snapshot, a form
 * default) comes from here, so they all agree with the day the user is living
 * in. `toISOString()` and SQL's `CURRENT_DATE` give the UTC day instead, which
 * is yesterday for anyone east of UTC in the morning.
 */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
