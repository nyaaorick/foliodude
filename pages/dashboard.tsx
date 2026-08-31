import { getDashboardAnalytics } from '@/lib/actions/getDashboardAnalytics';
import { useLiveQuery } from '@/lib/data/use-live-query';
import { Loaded, Page, PageHeader } from '@/components/app/page-state';
import { DashboardOverview } from '@/components/features/dashboard';

export default function DashboardPage() {
  // `getDashboardAnalytics` returns an ActionResult rather than throwing, so
  // unwrap it into a rejection and let one error path handle both.
  const state = useLiveQuery(async () => {
    const result = await getDashboardAnalytics();
    if (!result.success) throw new Error(result.error);
    return result.data;
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title="Wealth overview"
        description="Allocations, net worth history, and monthly spending in one USD view."
      />
      <Loaded state={state}>
        {(analytics) => <DashboardOverview analytics={analytics} />}
      </Loaded>
    </Page>
  );
}
