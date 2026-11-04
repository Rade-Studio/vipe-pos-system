import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS dependency injection relies on `emitDecoratorMetadata`, which esbuild
// (Vitest's default transformer) does not implement. SWC does, so every spec is
// transformed through it; this is the setup the NestJS docs recommend for Vitest.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  resolve: {
    // Specs run against the db package sources; `nest build` uses its dist.
    alias: { '@vipe/db': path.resolve(__dirname, '../../packages/db/src/index.ts') },
  },
  test: {
    name: 'api',
    // Integration specs start a Postgres container and apply every migration.
    hookTimeout: 180_000,
    testTimeout: 30_000,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
  },
});
