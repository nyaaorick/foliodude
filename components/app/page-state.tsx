import type { QueryState } from '@/lib/data/use-live-query';

/**
 * Renders the loading and error arms of a `useLiveQuery` so pages only write
 * the ready arm. Errors are shown verbatim rather than swallowed — a failed
 * read here means the local database is unhealthy, which the user needs to see.
 */
export function Loaded<T>({
  state,
  children,
}: {
  state: QueryState<T>;
  children: (data: T) => React.ReactNode;
}) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm font-medium">Could not read the local database</p>
        <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
      </div>
    );
  }

  return <>{children(state.data)}</>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-medium tracking-tight [font-family:var(--font-display)] md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Consistent page gutters. Tight at 350px, roomier once there is space. */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 md:px-8 md:py-8">
      {children}
    </div>
  );
}
