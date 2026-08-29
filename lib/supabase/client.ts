/**
 * Supabase browser client — used ONLY for OAuth authentication.
 * All financial data is stored locally in PGLite (IndexedDB / OPFS),
 * not in the remote Supabase database.
 *
 * After login, call supabase.auth.getUser() to get the user's UUID,
 * then pass that UUID into PGLite queries as user_id.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
