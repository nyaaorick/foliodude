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
    // Most test files spin up their own in-memory PGlite (WASM Postgres).
    // Running files in parallel starts many WASM instances at once and causes
    // sporadic timeouts under load; sequential files keep the suite reliable.
    fileParallelism: false,
  },
});
