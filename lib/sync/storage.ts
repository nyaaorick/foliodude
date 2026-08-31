/**
 * `localStorage`, or `null` where there isn't one.
 *
 * Device identity and the writer designation are browser-local by definition,
 * but the code that reads them is also reachable from Node (the test suite) and
 * from a worker context. Absent storage means "this is a standalone device with
 * no sync history", which is exactly the right answer in both cases — it is not
 * an error to swallow.
 */
export function deviceStore(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}
