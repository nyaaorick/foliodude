'use client';

/**
 * Client-side auth actions.
 *
 * Auth (login/logout) is handled via Supabase OAuth in the browser.
 * After login, the user's UUID is read from the Supabase session
 * and used as `user_id` when writing to the local PGLite database.
 *
 * There are NO server-side redirects or cookie-based sessions here.
 * Route protection is handled client-side (see app-shell.tsx).
 */
import { createClient } from '@/lib/supabase/client';

export async function signInWithGoogle(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
    },
  });
  if (error) {
    console.error('[auth] signInWithGoogle error:', error.message);
  }
}

export async function signInWithGithub(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
    },
  });
  if (error) {
    console.error('[auth] signInWithGithub error:', error.message);
  }
}

export async function signInWithMicrosoft(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
      scopes: 'email',
    },
  });
  if (error) {
    console.error('[auth] signInWithMicrosoft error:', error.message);
  }
}

export async function signInWithApple(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
    },
  });
  if (error) {
    console.error('[auth] signInWithApple error:', error.message);
  }
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = '/login';
}
