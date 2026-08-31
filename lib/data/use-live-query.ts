import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

import { getVersion, subscribe } from './store';

export type QueryState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: string };

/**
 * Run a PGLite read and re-run it whenever `revalidate()` fires or `deps` change.
 *
 * `load` is wrapped in `useEffectEvent` so callers can pass a fresh closure every
 * render without it becoming a refetch trigger — the dependency list stays
 * explicit rather than accidental.
 */
export function useLiveQuery<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
): QueryState<T> {
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const run = useEffectEvent(load);

  useEffect(() => {
    let cancelled = false;

    run().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return state;
}
