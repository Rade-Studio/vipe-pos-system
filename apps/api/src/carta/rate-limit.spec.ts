import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter, RATE_LIMIT_MESSAGE, RateLimitGuard } from './rate-limit';

describe('FixedWindowLimiter', () => {
  it('allows `limit` hits per key and window, then refuses with the seconds left', () => {
    let now = 1_000_000;
    const limiter = new FixedWindowLimiter(() => now);
    const rule = { limit: 3, windowMs: 60_000 };
    expect([1, 2, 3].map(() => limiter.hit('a', rule))).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    now += 10_500;
    expect(limiter.hit('a', rule)).toEqual({ ok: false, retryAfterSeconds: 50 });
    // Another key has its own window.
    expect(limiter.hit('b', rule)).toEqual({ ok: true });
  });

  it('a new window starts once the previous one ended', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(() => now);
    const rule = { limit: 1, windowMs: 1_000 };
    expect(limiter.hit('a', rule).ok).toBe(true);
    now = 999;
    expect(limiter.hit('a', rule)).toEqual({ ok: false, retryAfterSeconds: 1 });
    now = 1_000;
    expect(limiter.hit('a', rule).ok).toBe(true);
  });

  it('evicts expired windows, and the oldest ones when over the key cap', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(() => now, 3);
    const rule = { limit: 1, windowMs: 1_000 };
    limiter.hit('a', rule);
    limiter.hit('b', rule);
    now = 2_000;
    limiter.hit('c', rule);
    limiter.hit('d', rule);
    expect(limiter.size).toBe(2);
    limiter.hit('e', rule);
    limiter.hit('f', rule);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});

describe('RateLimitGuard', () => {
  const context = (ip: string, path: string, headers: Record<string, string>, rule = { limit: 2, windowMs: 60_000 }) => {
    const handler = () => undefined;
    Reflect.defineMetadata('carta:rate-limit', rule, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ ip, route: { path } }),
        getResponse: () => ({ setHeader: (name: string, value: string) => (headers[name] = value) }),
      }),
    } as never;
  };

  it('counts per IP and route; over the limit is a 429 in Spanish with Retry-After', async () => {
    const { Reflector } = await import('@nestjs/core');
    const guard = new RateLimitGuard(new Reflector(), new FixedWindowLimiter(() => 0));
    const headers: Record<string, string> = {};
    expect(guard.canActivate(context('1.1.1.1', '/carta/:slug', headers))).toBe(true);
    expect(guard.canActivate(context('1.1.1.1', '/carta/:slug', headers))).toBe(true);
    expect(guard.canActivate(context('2.2.2.2', '/carta/:slug', headers))).toBe(true);
    expect(guard.canActivate(context('1.1.1.1', '/carta/:slug/p/:dishId', headers))).toBe(true);
    let error: unknown;
    try {
      guard.canActivate(context('1.1.1.1', '/carta/:slug', headers));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toBe(RATE_LIMIT_MESSAGE);
    expect(RATE_LIMIT_MESSAGE).toBe('Demasiadas solicitudes. Intenta de nuevo en un momento.');
    expect(headers['Retry-After']).toBe('60');
  });

  it('a route without @RateLimit() is not counted', async () => {
    const { Reflector } = await import('@nestjs/core');
    const guard = new RateLimitGuard(new Reflector(), new FixedWindowLimiter(() => 0));
    const handler = () => undefined;
    const ctx = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ ip: '1.1.1.1' }), getResponse: () => ({}) }),
    } as never;
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });
});
