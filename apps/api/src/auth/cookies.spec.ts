import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../config/env';
import { readCookie, setAuthCookies } from './cookies';

const env = parseEnv({
  DATABASE_URL: 'postgres://vipe_api:secret@localhost:5432/vipe_pos',
  WEB_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'x'.repeat(32),
});
const req = (cookie: string) => ({ headers: { cookie } }) as Request;

describe('readCookie', () => {
  it('returns the value of the named cookie', () => {
    expect(readCookie(req('a=1; vipe_access=tok.en; b=2'), 'vipe_access')).toBe('tok.en');
  });

  it('returns undefined for a malformed percent-encoding instead of throwing', () => {
    expect(readCookie(req('vipe_access=%E0%A4%A'), 'vipe_access')).toBeUndefined();
  });

  it('returns undefined for a missing or empty cookie', () => {
    expect(readCookie(req('vipe_access='), 'vipe_access')).toBeUndefined();
    expect(readCookie({ headers: {} } as Request, 'vipe_access')).toBeUndefined();
  });
});

describe('setAuthCookies', () => {
  it('sets both cookies httpOnly, SameSite=Lax and Secure by default, with their paths and lifetimes', () => {
    const cookie = vi.fn();
    setAuthCookies({ cookie } as unknown as Response, env, { accessToken: 'a', refreshToken: 'r' });
    expect(env.cookieSecure).toBe(true);
    expect(cookie).toHaveBeenCalledWith('vipe_access', 'a', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 900_000,
    });
    expect(cookie).toHaveBeenCalledWith('vipe_refresh', 'r', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/api/auth',
      maxAge: 2_592_000_000,
    });
  });
});
