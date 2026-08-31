/**
 * Auth surface for the local-first client.
 *
 * Nothing here talks to a network yet. Phase 4 backs this with Google OAuth
 * (PKCE, no client secret — see PLAN.md §5 Phase 4) and stores the returned
 * user id as the `user_id` written into the local PGLite database. Until then
 * the app is fully usable signed-out: all data lives on-device, and sign-in
 * only ever unlocks Google Drive snapshot sync. Google is the only provider —
 * Apple requires a paid Developer Program enrollment with no free path, and
 * GitHub/Microsoft would each need their own storage integration for no
 * benefit over Google alone.
 *
 * The previous Next.js implementation lived in `lib/actions/auth-actions.ts`
 * (see git history at 53c84e9) and depended on `lib/supabase/client`, which
 * no longer exists.
 */

export const AUTH_PROVIDERS = ['google'] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const AUTH_PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: 'Google',
};

/** True once Phase 4 lands. Guards UI that is pointless without a session. */
export const isAuthEnabled = false;

export async function signInWithProvider(provider: AuthProvider): Promise<void> {
  console.warn(
    `[auth] ${provider} sign-in is not wired up yet (Phase 4: Google OAuth + Drive snapshot sync).`,
  );
}

export async function signOut(): Promise<void> {
  console.warn('[auth] sign-out is a no-op until Phase 4 introduces sessions.');
}
