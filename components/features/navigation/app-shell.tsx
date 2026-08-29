'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { FlaskConical, LayoutGrid, LogOut, Mail, WalletCards } from 'lucide-react';
import { InlineLinkLoading } from '@/components/features/navigation/loading-ui';
import { signOut } from '@/lib/actions/auth-actions';
import { cn } from '@/lib/utils';

const NoticeDialog = dynamic(
  () =>
    import('@/components/features/notice/notice-dialog').then(
      (module) => module.NoticeDialog,
    ),
  { ssr: false },
);

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: 'exact' | 'prefix';
}

const BASE_NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutGrid,
    match: 'exact',
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: WalletCards,
    match: 'prefix',
  },
  {
    href: '/lab',
    label: 'Lab',
    icon: FlaskConical,
    match: 'exact',
  },
  {
    href: '/contact-us',
    label: 'Contact US',
    icon: Mail,
    match: 'exact',
  },
];

function getNavItems(): NavItem[] {
  return BASE_NAV_ITEMS;
}

function AuthNavItem({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  const Icon = LogOut;
  const className = cn(
    'group flex items-center gap-2 rounded-[1.1rem] border border-transparent text-sm tracking-tight text-muted-foreground transition-colors duration-200',
    'hover:bg-sidebar-accent/70 hover:text-foreground',
    mobile ? 'min-w-fit px-3 py-2' : 'px-3 py-2.5',
  );

  return (
    <form action={signOut}>
      <button type="submit" className={className}>
        <Icon className={cn('shrink-0', mobile ? 'size-3.5' : 'size-4')} />
        <span className={cn(mobile ? 'text-[0.82rem]' : 'text-[0.92rem]')}>
          logout
        </span>
      </button>
    </form>
  );
}

function isActive(pathname: string, item: NavItem) {
  if (item.match === 'exact') {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({
  pathname,
  mobile = false,
}: {
  pathname: string;
  mobile?: boolean;
}) {
  const items = getNavItems();

  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2 rounded-[1.1rem] border border-transparent text-sm tracking-tight text-muted-foreground transition-colors duration-200',
              active
                ? 'border-sidebar-border/80 bg-sidebar-accent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
                : 'hover:bg-sidebar-accent/70 hover:text-foreground',
              mobile ? 'min-w-fit px-3 py-2' : 'px-3 py-2.5',
              'relative',
            )}
          >
            <InlineLinkLoading className="absolute right-3 top-1/2 -translate-y-1/2" />
            <Icon className={cn('shrink-0', mobile ? 'size-3.5' : 'size-4')} />
            <span className={cn(mobile ? 'text-[0.82rem]' : 'text-[0.92rem]')}>
              {item.label}
            </span>
          </Link>
        );
      })}
      <AuthNavItem mobile={mobile} />
    </>
  );
}

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === '/') {
    return <>{children}</>;
  }

  const showNotice = pathname !== '/login';

  return (
    <div className="min-h-screen">
      {showNotice ? <NoticeDialog /> : null}

      <aside className="fixed inset-y-6 left-6 z-30 hidden w-40 flex-col rounded-[1.9rem] border border-sidebar-border/80 bg-sidebar/88 p-3 shadow-[0_18px_45px_rgba(48,33,22,0.08)] backdrop-blur md:flex">
        <div className="space-y-6">
          <div className="flex items-center justify-center rounded-[1.45rem] border border-sidebar-border/70 bg-background/60 px-3 py-3 text-center">
            <p className="text-base leading-none font-medium tracking-tight [font-family:var(--font-display)]">
              FolioDude.it.com
            </p>
          </div>
          <nav className="space-y-1.5">
            <NavLinks pathname={pathname} />
          </nav>
        </div>
        <p className="px-2 text-[0.72rem] leading-5 text-muted-foreground">
          Quiet navigation for your finance workspace.
        </p>
      </aside>

      <div className="fixed inset-x-4 top-4 z-30 md:hidden">
        <div className="rounded-[1.7rem] border border-sidebar-border/80 bg-sidebar/92 p-2 shadow-[0_14px_36px_rgba(48,33,22,0.08)] backdrop-blur">
          <div className="mb-2 flex items-center justify-between px-2 pt-1">
            <p className="text-xs font-medium tracking-tight text-muted-foreground">
              FolioDude.it.com
            </p>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLinks pathname={pathname} mobile />
          </nav>
        </div>
      </div>

      <main className="min-h-screen pt-24 md:pl-56 md:pt-0">
        {children}
      </main>
    </div>
  );
}
