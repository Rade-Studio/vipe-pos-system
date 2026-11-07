import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Local pages of the desktop app (title bar, Estación panel, first-run setup).
// Tests are *.spec.ts(x) so the repository's root vitest run does not pick them up.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    globals: false,
  },
});
