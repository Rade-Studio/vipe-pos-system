import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Clock } from '../common/clock';

export const RATE_LIMIT_KEY = 'carta:rate-limit';
export const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo en un momento.';

export interface RateLimitRule {
  /** Requests allowed per key and window. */
  limit: number;
  windowMs: number;
}

/** The public carta's reads (S2): 120 a minute per client IP and route. */
export const CARTA_READ_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };
/** Guest writes from the table QR (S12, S14), per client IP and route. */
export const CARTA_PROPOSAL_LIMIT: RateLimitRule = { limit: 10, windowMs: 60_000 };
export const CARTA_REQUEST_LIMIT: RateLimitRule = { limit: 6, windowMs: 60_000 };
export const CARTA_FEEDBACK_LIMIT: RateLimitRule = { limit: 3, windowMs: 60_000 };
/** Guest delivery (S15): sending an order, and the pricing preview the cart refreshes. */
export const CARTA_DELIVERY_LIMIT: RateLimitRule = { limit: 3, windowMs: 60_000 };
export const CARTA_PRICING_LIMIT: RateLimitRule = { limit: 30, windowMs: 60_000 };

/** Limit the route per client IP (RateLimitGuard); stricter rules suit guest writes. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

type Hit = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * In-memory fixed-window counter per key, for one API process. Memory is
 * bounded: past `maxKeys` the expired windows are evicted, then the oldest.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { endsAt: number; count: number }>();

  constructor(
    private readonly now: () => number,
    private readonly maxKeys = 10_000,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  hit(key: string, rule: RateLimitRule): Hit {
    const now = this.now();
    const current = this.windows.get(key);
    if (current && now < current.endsAt) {
      if (current.count >= rule.limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((current.endsAt - now) / 1000)) };
      }
      current.count++;
      return { ok: true };
    }
    this.windows.delete(key);
    if (this.windows.size >= this.maxKeys) {
      this.evict(now);
    }
    this.windows.set(key, { endsAt: now + rule.windowMs, count: 1 });
    return { ok: true };
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.endsAt <= now) {
        this.windows.delete(key);
      }
    }
    // Insertion order is window start order: drop the oldest windows still running.
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) {
        break;
      }
      this.windows.delete(key);
    }
  }
}

/** The limiter of the API process, on the shared Clock. */
export const rateLimiterProvider = {
  provide: FixedWindowLimiter,
  useFactory: (clock: Clock) => new FixedWindowLimiter(() => clock.now().getTime()),
  inject: [Clock],
};

/**
 * Applies @RateLimit() keyed by req.ip (trust proxy decides it, configure-app)
 * and the route path; over the limit is a 429 in Spanish with Retry-After.
 * Routes without @RateLimit() pass.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: FixedWindowLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!rule) {
      return true;
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const route = (req.route as { path?: string } | undefined)?.path ?? '';
    const hit = this.limiter.hit(`${req.ip ?? ''} ${route}`, rule);
    if (!hit.ok) {
      http.getResponse<Response>().setHeader('Retry-After', String(hit.retryAfterSeconds));
      throw new HttpException(RATE_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
