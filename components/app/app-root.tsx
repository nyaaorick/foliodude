import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/features/navigation/app-shell';

/**
 * Shared React root for every build target.
 *
 * The only thing that differs between targets is the router:
 * - `memory` for the Firefox sidebar, where there is no address bar to own
 *   and the extension page must never appear to navigate.
 * - `hash`   for the iOS PWA, so deep links survive a reload on any static
 *   host without server-side rewrite rules.
 */
export type RouterMode = 'memory' | 'hash';

const HOME_ROUTE = '/dashboard';

const DashboardPage = lazy(() => import('@/pages/dashboard'));
const AccountsPage = lazy(() => import('@/pages/accounts'));
const AccountDetailPage = lazy(() => import('@/pages/account-detail'));
const LabPage = lazy(() => import('@/pages/lab'));
const ContactUsPage = lazy(() => import('@/pages/contact-us'));
const LoginPage = lazy(() => import('@/pages/login'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center p-10">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function MemoryRouterAtHome({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={[HOME_ROUTE]}>{children}</MemoryRouter>;
}

const ROUTERS: Record<RouterMode, ComponentType<{ children: ReactNode }>> = {
  memory: MemoryRouterAtHome,
  hash: HashRouter,
};

export function AppRoot({ router }: { router: RouterMode }) {
  const Router = ROUTERS[router];

  return (
    <Router>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to={HOME_ROUTE} replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id" element={<AccountDetailPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/contact-us" element={<ContactUsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to={HOME_ROUTE} replace />} />
          </Routes>
        </Suspense>
      </AppShell>
    </Router>
  );
}
