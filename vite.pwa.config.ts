import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * Standalone PWA build (iOS Safari "Add to Home Screen").
 *
 * Shares every source file with the WXT extension build — only the HTML shell,
 * the manifest, and the router mode differ. WXT owns `entrypoints/`; this owns
 * `pwa/`. Output lands next to the extension build under `.output/`.
 *
 * `base: './'` keeps the bundle host-agnostic, so the same artifact works at a
 * domain root, a Cloudflare Pages preview URL, or a project subpath.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'pwa'),
  base: './',
  publicDir: path.resolve(__dirname, 'pwa/public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '.output/pwa'),
    emptyOutDir: true,
    target: 'safari16',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5174,
  },
});
