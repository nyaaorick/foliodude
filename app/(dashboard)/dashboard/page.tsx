import { redirect } from 'next/navigation';
import { getDashboardAnalytics } from '@/lib/actions/getDashboardAnalytics';
import { getSessionContext } from '@/lib/supabase/server';
import { DashboardOverview } from '@/components/features/dashboard';

export default async function DashboardPage() {
  const context = await getSessionContext();

  if (!context) {
    redirect('/login');
  }

  const analyticsResult = await getDashboardAnalytics(context);

  if (!analyticsResult.success) {
    return (
      <div className="mx-auto max-w-6xl p-6 md:p-10">
        <div className="rounded-[1.8rem] border border-destructive/20 bg-destructive/5 p-6">
          <h1 className="text-2xl font-medium tracking-tight [font-family:var(--font-display)]">
            Dashboard unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{analyticsResult.error}</p>
        </div>
      </div>
    );
  }

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

      <DashboardOverview analytics={analyticsResult.data} />
    </div>
  );
}
