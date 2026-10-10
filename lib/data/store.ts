/**
 * Revalidation bus for the local-first client.
 *
 * Every read is a PGLite query in this same tab, so a mutation only has to
 * tell the live queries to run again. A page reload cannot do that job:
 * `navigate(0)` is a no-op in a `MemoryRouter` (the Firefox extension) and a
 * full document reload in a `HashRouter`, which throws away the warm PGLite
 * WASM instance and costs a multi-second cold start.
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
