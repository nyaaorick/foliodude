'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const headerList = await headers();
  const headerOrigin = headerList.get('origin') ?? '';
  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  const origin = headerOrigin.includes('0.0.0.0') || !headerOrigin ? envOrigin : headerOrigin;
  const redirectTo = origin ? `${origin}/auth/callback` : undefined;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (error || !data?.url) {
    redirect('/login');
  }

  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect('/login');
}
