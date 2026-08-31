/**
 * PKCE (RFC 7636) helpers.
 *
 * PKCE is what lets a public client — a browser extension or a static PWA —
 * complete an authorization code flow with no client secret, which is the whole
 * reason Phase 4 needs no server of ours. See PLAN.md §1 and §5 Phase 4.
 */

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A fresh high-entropy verifier. 32 bytes → 43 chars, the RFC's minimum. */
export function createVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Opaque value echoed back by the provider, to detect a swapped response. */
export function createState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}
