import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../configure-app';
import type { Env } from '../config/env';

export const ACCESS_COOKIE = 'vipe_access';
export const REFRESH_COOKIE = 'vipe_refresh';

/** The refresh cookie is sent only to the auth routes. */
const REFRESH_PATH = `/${API_PREFIX}/auth`;

const baseOptions = (env: Env): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: env.cookieSecure });

export function setAuthCookies(res: Response, env: Env, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(env),
    path: '/',
    maxAge: env.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(env),
    path: REFRESH_PATH,
    maxAge: env.refreshTokenTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(env), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(env), path: REFRESH_PATH });
}

/**
 * Read one cookie from the request header (Express does not parse cookies).
 * Values are never percent-decoded: the API only sets JWT and base64url
 * values, so a value that would need decoding is not one of ours and reads
 * as absent (401), never as a decoding error (500). Also reads a socket.io
 * handshake, which carries the same headers.
 */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}
