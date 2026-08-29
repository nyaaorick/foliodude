import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/supabase/server';
import { LabClient } from './lab-client';

export default async function LabPage() {
  const context = await getSessionContext();

  if (!context) {
    redirect('/login');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Lab
        </p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight [font-family:var(--font-display)]">
          Lab
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Lab is for features under test, and users who want to give feedback are
          always welcome.
        </p>
      </div>
      <LabClient />
    </div>
  );
}
