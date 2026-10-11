/**
 * Google OAuth client ids.
 *
 * A client id is the one credential this app may ship (PLAN.md §1): Google's
 * PKCE flow for public clients has no client secret, so there is nothing to
 * protect. It still is not hard-coded — it differs per person running this
 * project — so it comes from the build environment, and the app degrades
 * cleanly to signed-out when absent.
 *
 * **Two client ids, because the two targets need different Google client
 * types.** PLAN §5 Phase 4 only named the extension's. They cannot be merged:
 *
 * - Extension → Google **Desktop app** type. Firefox's
 *   `identity.getRedirectURL()` resolves to a loopback address since Firefox 86
 *   (RFC 8252 §7.3), which is exactly what the Desktop type expects and what
 *   the Web type rejects.
 * - PWA → Google **Web application** type, with the deployed https origin
 *   registered as an authorized redirect URI.
 *
 * Set `VITE_GOOGLE_CLIENT_ID_EXTENSION` and/or `VITE_GOOGLE_CLIENT_ID_WEB` at
 * build time. Configuring only one leaves the other target signed-out, which is
 * a supported state — it is also the documented fallback if the iOS PWA flow
 * turns out to be blocked (PLAN §8 risk #6).
 */
const env = import.meta.env as Record<string, string | undefined>;

function read(name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

const GOOGLE_CLIENT_ID_EXTENSION = read('VITE_GOOGLE_CLIENT_ID_EXTENSION');
const GOOGLE_CLIENT_ID_WEB = read('VITE_GOOGLE_CLIENT_ID_WEB');

/**
 * `drive.appdata` only. Google classifies it non-sensitive, so the project
 * needs basic app verification rather than the sensitive-scope review with its
 * privacy-policy URL, demo video, and review queue. Adding any scope — even
 * `email`, to show who is signed in — is a decision about that review, not just
 * about the UI, so this stays deliberately minimal.
 */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** True inside the WebExtension, false in the PWA. Picks the flow and client id. */
export function isExtension(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser?.identity);
}

export function getClientId(): string | null {
  return isExtension() ? GOOGLE_CLIENT_ID_EXTENSION : GOOGLE_CLIENT_ID_WEB;
}

/** Whether this build/target pair was given a client id at all. */
export function isAuthConfigured(): boolean {
  return getClientId() !== null;
}
