'use client';

import { useLinkStatus } from 'next/link';
import { cn } from '@/lib/utils';

export function InlineLinkLoading({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  if (!pending) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none size-3 animate-spin rounded-full border-2 border-primary/20 border-t-primary',
        className,
      )}
    />
  );
}

export function AccountDetailActionSkeleton() {
  return <div className="min-h-[36px]" />;
}

export function AccountDetailHeaderSkeleton() {
  return (
    <div className="min-h-[140px]" />
  );
}

export function AccountDetailSupportSkeleton() {
  return <div className="min-h-[320px]" />;
}

export function AccountDetailTransactionsSkeleton() {
  return (
    <div className="min-h-[240px]" />
  );
}

export function AccountDetailPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <AccountDetailHeaderSkeleton />
      <AccountDetailSupportSkeleton />
      <AccountDetailTransactionsSkeleton />
    </div>
  );
}
