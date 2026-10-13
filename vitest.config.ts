import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Mirrors the `@/*` path mapping in tsconfig.json.
const alias = { '@': path.resolve(__dirname, '.') };

// Two suites with different environments, kept side by side in one runner:
//   - `node`  : pure-logic suites (lib/**, store/**, supabase/functions/**).
//   - `dom`   : React component suites (*.test.tsx), which need jsdom plus the
//               Testing Library matchers from vitest.setup.ts.
// `test.projects` is the Vitest 5 mechanism (the old `workspace` file and
// `environmentMatchGlobs` are both gone in this major).
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'store/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
          globals: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          // Every `.tsx` suite is a component suite; jsdom plus setupFiles.
          include: ['components/**/*.test.tsx', '**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
          globals: false,
        },
      },
    ],
  },
});