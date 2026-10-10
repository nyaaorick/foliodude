import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    // Booting a WASM Postgres is slow, and slower still with files running in
    // parallel; the first test (or hook) in a file pays for it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
