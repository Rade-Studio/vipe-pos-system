import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` path mapping in tsconfig.json.
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // Pure logic only for now: no jsdom / React Testing Library yet.
    environment: 'node',
    include: ['lib/**/*.test.ts', 'store/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    globals: false,
  },
});