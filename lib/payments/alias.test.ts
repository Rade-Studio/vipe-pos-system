import { describe, expect, it } from 'vitest';
import { assertWholePesos } from '@/lib/payments/money';

// Guards the `@/*` alias in vitest.config.ts: tests must resolve the same
// way the Next.js app does, otherwise every suite would need relative paths.
describe('@ alias', () => {
  it('resolves the same module the relative path does', async () => {
    const viaRelative = await import('./money');
    expect(viaRelative.assertWholePesos).toBe(assertWholePesos);
  });
});