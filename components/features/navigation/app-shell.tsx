import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { FlaskConical, LayoutGrid, Mail, RefreshCw, WalletCards } from 'lucide-react';
import { getWriter, isWritable } from '@/lib/sync/engine';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: 'exact' | 'prefix';
}

/**
 * Five items — the ceiling for a thumb-zone bar. At 350px (the Firefox sidebar,
 * the narrowest target) that is 70px per tab, still above the 44px minimum.
 *
 * PLAN.md §3.2 lists four, matching the routes that existed when it was
 * written, and says to revise the tabs and routes together. Phase 4 added
 * `/sync`, so this is that revision.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid, match: 'exact' },
  { href: '/accounts', label: 'Accounts', icon: WalletCards, match: 'prefix' },
  { href: '/sync', label: 'Sync', icon: RefreshCw, match: 'exact' },
  { href: '/lab', label: 'Lab', icon: FlaskConical, match: 'exact' },
  { href: '/contact-us', label: 'Contact', icon: Mail, match: 'exact' },
];

function isActive(pathname: string, item: NavItem) {
  return item.match === 'exact'
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Fixed bottom tab bar — the narrow layout for both the Firefox sidebar and
 * iOS portrait. `pb-[env(safe-area-inset-bottom)]` keeps the row above the home
 * indicator; the bar's own height is published as `--app-tabbar-h` so page
 * content can reserve the space without hard-coding it.
 */
function BottomTabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border/80 bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // min-h-14 keeps every tap target above the 44px iOS minimum.
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
                <span className="text-[0.66rem] leading-none font-medium tracking-tight">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SideRail({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-52 flex-col border-r border-sidebar-border/80 bg-sidebar/90 p-4 backdrop-blur md:flex">
      <p className="px-2 py-3 text-lg leading-none font-medium tracking-tight [font-family:var(--font-display)]">
        FolioDude
      </p>
      <nav aria-label="Primary" className="mt-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.92rem] tracking-tight transition-colors',
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * One responsive layout for every target. The breakpoint is the viewport, not
 * the platform: the Firefox sidebar at ~350px gets the same bottom-tab layout
 * as an iPhone, and widening it — or opening the extension in a full tab — is
 * all it takes to get the desktop rail. Nothing here branches on the build.
 */
/**
 * Read-only notice for a device that is not the sync writer.
 *
 * The database guard already blocks the write, but a bare error thrown from a
 * dialog is a poor way to learn the rule — this states it before the user
 * starts typing, and points at the page that can change it.
 */
function ReadOnlyBanner() {
  const writer = getWriter();

  return (
    <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-xs">
      Read-only — <span className="font-medium">{writer?.deviceName}</span> is the sync writer.{' '}
      <Link to="/sync" className="underline underline-offset-2">
        Change
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const readOnly = !isWritable();

  return (
    // 100dvh rather than 100vh: iOS Safari's collapsing URL bar makes vh lie.
    <div className="min-h-[100dvh]">
      <SideRail pathname={pathname} />
      <BottomTabBar pathname={pathname} />

      <main
        className={cn(
          'min-h-[100dvh] pt-[env(safe-area-inset-top)] md:pl-52 md:pt-0',
          // Clears the fixed bottom bar (min-h-14) plus the home indicator.
          'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0',
        )}
      >
        {readOnly && <ReadOnlyBanner />}
        {children}
      </main>
    </div>
  );
}
