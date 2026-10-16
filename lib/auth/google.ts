import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_SCOPE,
  GOOGLE_TOKEN_ENDPOINT,
  getClientId,
  isExtension,
} from './config';
import { createState, createVerifier, deriveChallenge } from './pkce';
import { clearSession, isExpired, loadSession, saveSession, type GoogleSession } from './tokens';

/**
 * Google sign-in, Authorization Code + PKCE, no client secret and no server.
 *
 * Two flows behind one API, because the targets differ in how they can receive
 * a redirect (docs/PLAN.md §5 Phase 4):
 *
 * - **Extension** — `identity.launchWebAuthFlow()` opens the consent screen and
 *   hands back the redirect URL directly, so the whole exchange happens inside
 *   one awaited call.
 * - **PWA** — a full-page redirect, because a home-screen PWA has no popup to
 *   hand a result back to. The verifier is parked in `sessionStorage` across
 *   the navigation and picked up by `completeRedirectSignIn()` on return.
 *
 * The PWA half is **unverified on real iOS hardware** (PLAN §8 risk #6): Safari
 * ITP and Google's `disallowed_useragent` detection have both broken OAuth in
 * non-standard browser contexts before, and a standalone home-screen PWA's
 * classification is not confirmed. If it fails there, leave
 * `VITE_GOOGLE_CLIENT_ID_WEB` unset — the PWA then reports sign-in as
 * unavailable instead of failing mid-flow.
 */

const PENDING_KEY = 'foliodude:oauth-pending';

interface PendingAuth {
  verifier: string;
  state: string;
  redirectUri: string;
}

/** Google appends the code to a redirect URI; the PWA's must be registered exactly. */
function webRedirectUri(): string {
  // No hash and no query: the app routes with HashRouter, so the bare document
  // URL is a stable redirect target on any static host.
  return `${window.location.origin}${window.location.pathname}`;
}

function requireClientId(): string {
  const clientId = getClientId();

  if (!clientId) {
    throw new Error(
      isExtension()
        ? 'Google sign-in is not configured for this build (VITE_GOOGLE_CLIENT_ID_EXTENSION).'
        : 'Google sign-in is not configured for this build (VITE_GOOGLE_CLIENT_ID_WEB).',
    );
  }

  return clientId;
}

function buildAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: input.state,
    // `offline` + `consent` is what makes Google return a refresh token. Without
    // it the access token dies after an hour and the user re-consents every
    // session, which for a background sync engine means it simply stops working.
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchange(body: Record<string, string>): Promise<GoogleSession> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Google token exchange failed: ${payload.error_description ?? payload.error ?? response.status}`,
    );
  }

  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    refreshToken: payload.refresh_token ?? null,
  };
}

function parseCallback(url: string, expectedState: string): string {
  const params = new URL(url).searchParams;
  const error = params.get('error');

  if (error) {
    throw new Error(`Google sign-in was refused: ${error}`);
  }

  // A mismatched state means this response belongs to a different request;
  // continuing would exchange a code we did not ask for.
  if (params.get('state') !== expectedState) {
    throw new Error('Google sign-in state mismatch — the response did not match the request.');
  }

  const code = params.get('code');
  if (!code) {
    throw new Error('Google sign-in returned no authorization code.');
  }

  return code;
}

/**
 * Begin sign-in.
 *
 * Resolves with a session in the extension. In the PWA it navigates away and
 * never resolves — the caller should not expect anything after it.
 */
export async function signIn(): Promise<GoogleSession | never> {
  const clientId = requireClientId();
  const verifier = createVerifier();
  const challenge = await deriveChallenge(verifier);
  const state = createState();

  if (isExtension()) {
    const redirectUri = browser.identity.getRedirectURL();
    const responseUrl = await browser.identity.launchWebAuthFlow({
      url: buildAuthUrl({ clientId, redirectUri, challenge, state }),
      interactive: true,
    });

    // Firefox resolves with `undefined` when the user closes the consent window.
    if (!responseUrl) {
      throw new Error('Google sign-in was cancelled.');
    }

    const session = await exchange({
      client_id: clientId,
      code: parseCallback(responseUrl, state),
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    saveSession(session);
    return session;
  }

  const redirectUri = webRedirectUri();
  const pending: PendingAuth = { verifier, state, redirectUri };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(buildAuthUrl({ clientId, redirectUri, challenge, state }));

  // The navigation above ends this document; nothing after it runs.
  return new Promise<never>(() => {});
}

/**
 * Finish a PWA redirect sign-in, if this load is one.
 *
 * Call once at startup. Returns `null` on an ordinary load. The `?code=` is
 * stripped from the address bar afterwards so a refresh cannot replay a
 * single-use code.
 */
export async function completeRedirectSignIn(): Promise<GoogleSession | null> {
  if (isExtension()) return null;

  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) return null;

  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  window.history.replaceState(null, '', webRedirectUri() + window.location.hash);

  if (!raw) {
    throw new Error('Google sign-in could not be completed — the pending request was lost.');
  }

  const pending = JSON.parse(raw) as PendingAuth;
  const session = await exchange({
    client_id: requireClientId(),
    code: parseCallback(window.location.href, pending.state),
    code_verifier: pending.verifier,
    grant_type: 'authorization_code',
    redirect_uri: pending.redirectUri,
  });

  saveSession(session);
  return session;
}

/** Whether a stored session exists, expired or not. */
export function isSignedIn(): boolean {
  return loadSession() !== null;
}

/**
 * A usable access token, refreshing when the stored one has expired.
 *
 * Throws when signed out or when the refresh token is gone or rejected —
 * callers surface that as "sign in again" rather than retrying silently.
 */
export async function getAccessToken(): Promise<string> {
  const session = loadSession();
  if (!session) throw new Error('Not signed in to Google.');
  if (!isExpired(session)) return session.accessToken;

  if (!session.refreshToken) {
    clearSession();
    throw new Error('Google session expired. Sign in again.');
  }

  try {
    const refreshed = await exchange({
      client_id: requireClientId(),
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    });

    // A refresh response usually omits the refresh token; keep the one we have.
    const next = { ...refreshed, refreshToken: refreshed.refreshToken ?? session.refreshToken };
    saveSession(next);
    return next.accessToken;
  } catch (error) {
    clearSession();
    throw error;
  }
}

export async function signOut(): Promise<void> {
  const session = loadSession();
  clearSession();

  if (!session) return;

  // Best effort: revoke so the grant does not linger in the user's Google
  // account after they signed out here. A failure changes nothing locally.
  await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: session.refreshToken ?? session.accessToken }).toString(),
  }).catch(() => undefined);
}
