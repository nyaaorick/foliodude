import { DashboardOverview } from '@/components/features/dashboard';

export default function DashboardPage() {
  // TODO Phase 2: Wire getDashboardAnalytics() via PGLite
  return (
    <div className="mx-auto max-w-7xl p-6 md:p-10">
      <div className="mb-6">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="mt-2 text-4xl font-medium tracking-tight [font-family:var(--font-display)]">
          Wealth overview
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Snapshot allocations, daily net worth history, and monthly spending trends in one USD
          view.
        </p>
      </div>

      <div className="rounded-[1.8rem] border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Dashboard data will be available after PGLite integration (Phase 2).
      </div>
    </div>
  );
}
