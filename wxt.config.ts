import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'FolioDude',
    description: 'Local-first personal finance tracker. Your data never leaves your device.',
    version: '0.1.0',
    // `storage` backs WXT's browser.storage helpers; the financial data itself
    // lives in IndexedDB/OPFS via PGLite (Phase 2), which needs no permission.
    permissions: ['storage'],
    browser_specific_settings: {
      gecko: {
        id: 'foliodude@foliodude.it.com',
        // 109 is the first Firefox with MV3 support.
        strict_min_version: '109.0',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
