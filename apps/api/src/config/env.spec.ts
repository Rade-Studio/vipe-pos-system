import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = {
  PORT: '4000',
  DATABASE_URL: 'postgres://vipe_api:secret@localhost:5432/vipe_pos',
  WEB_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('returns typed config from a valid environment', () => {
    expect(parseEnv(valid)).toEqual({
      port: 4000,
      databaseUrl: 'postgres://vipe_api:secret@localhost:5432/vipe_pos',
      webOrigin: 'http://localhost:3000',
      jwtSecret: 'x'.repeat(32),
      cookieSecure: true,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2592000,
    });
  });

  it('defaults PORT to 4000 when absent', () => {
    const { PORT: _port, ...withoutPort } = valid;
    expect(parseEnv(withoutPort).port).toBe(4000);
  });

  it('rejects a missing DATABASE_URL and names the variable', () => {
    const { DATABASE_URL: _url, ...withoutDb } = valid;
    expect(() => parseEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects a WEB_ORIGIN that is not an absolute URL', () => {
    expect(() => parseEnv({ ...valid, WEB_ORIGIN: 'localhost' })).toThrow(/WEB_ORIGIN/);
  });

  it('rejects a missing JWT_SECRET and names the variable', () => {
    const { JWT_SECRET: _secret, ...withoutSecret } = valid;
    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
  });

  it('reads COOKIE_SECURE=false as false and anything else invalid', () => {
    expect(parseEnv({ ...valid, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(parseEnv({ ...valid, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    expect(() => parseEnv({ ...valid, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  it('reads custom token TTLs and rejects non-positive ones', () => {
    const env = parseEnv({ ...valid, ACCESS_TOKEN_TTL_SECONDS: '60', REFRESH_TOKEN_TTL_SECONDS: '3600' });
    expect(env.accessTokenTtlSeconds).toBe(60);
    expect(env.refreshTokenTtlSeconds).toBe(3600);
    expect(() => parseEnv({ ...valid, ACCESS_TOKEN_TTL_SECONDS: '0' })).toThrow(/ACCESS_TOKEN_TTL_SECONDS/);
    expect(() => parseEnv({ ...valid, REFRESH_TOKEN_TTL_SECONDS: 'abc' })).toThrow(/REFRESH_TOKEN_TTL_SECONDS/);
  });
});
