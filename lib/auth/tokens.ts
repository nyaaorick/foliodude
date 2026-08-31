/**
 * Device-local OAuth token storage.
 *
 * `localStorage`, deliberately — never the PGlite database. The database is the
 * thing uploaded to Drive, so a token stored there would be synced to every
 * other device, which is exactly what a per-device credential must not do. Same
 * reasoning as the `apikey:` exclusion in PLAN.md §7.
 */
const SESSION_KEY = 'foliodude:google-session';

export interface GoogleSession {
  accessToken: string;
  /** Epoch ms. Treated as expired a minute early to absorb clock skew. */
  expiresAt: number;
  /** Absent when Google declines to reissue one on a repeat consent. */
  refreshToken: string | null;
}

const EXPIRY_SKEW_MS = 60_000;

export function loadSession(): GoogleSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as GoogleSession;
  return parsed.accessToken ? parsed : null;
}

export function saveSession(session: GoogleSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function isExpired(session: GoogleSession): boolean {
  return Date.now() >= session.expiresAt - EXPIRY_SKEW_MS;
}
