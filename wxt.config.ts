import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'FolioDude',
    description: 'Local-first personal finance tracker. Your data never leaves your device.',
    version: '0.1.0',
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self' blob:",
    },
    // `storage` backs WXT's browser.storage helpers; the financial data itself
    // lives in IndexedDB/OPFS via PGLite (Phase 2), which needs no permission.
    // `identity` backs the OAuth flow (launchWebAuthFlow + getRedirectURL).
    permissions: ['storage', 'identity'],
    // Host permissions, not for reach but for CORS: an extension page's fetch
    // to Google's token and Drive endpoints is cross-origin, and these let it
    // through without depending on Google's CORS headers for a Desktop-type
    // OAuth client. Both are narrow — no <all_urls>, nothing user-facing.
    host_permissions: [
      'https://oauth2.googleapis.com/*',
      'https://www.googleapis.com/*',
    ],
    // Toolbar button; the background script opens the app in a full tab so the
    // extension is not locked to the ~350px sidebar. See entrypoints/background.ts.
    action: {
      default_title: 'Open FolioDude in a tab',
    },
    browser_specific_settings: {
      gecko: {
        id: 'foliodude@foliodude.it.com',
        // 109 is the first Firefox with MV3 support.
        strict_min_version: '109.0',
      },
    },
  },
  vite: () => ({
    cacheDir: 'node_modules/.vite-wxt',
    plugins: [tailwindcss()],
  }),
});
