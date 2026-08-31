/**
 * Revalidation bus for the local-first client.
 *
 * Under Next.js, a mutation called `revalidatePath()` and the server re-rendered
 * the page. There is no server now: every read is a PGLite query in this same
 * tab, so a mutation only has to tell the live queries to run again.
 *
 * `navigate(0)` — the placeholder left behind by the router port — cannot do
 * that job. In a `MemoryRouter` (the Firefox extension) it is a no-op, and in a
 * `HashRouter` it is a full document reload, which throws away the warm PGLite
 * WASM instance and costs a multi-second cold start. Both are wrong.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

/** Tell every `useLiveQuery` to refetch. Call after any successful write. */
export function revalidate(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVersion(): number {
  return version;
}
