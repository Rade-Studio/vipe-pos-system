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
      storage: null,
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

  describe('S3 storage', () => {
    const s3 = {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'auto',
      S3_BUCKET: 'vipe-dev',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_PUBLIC_BASE_URL: 'http://localhost:9000/vipe-dev/',
      S3_FORCE_PATH_STYLE: 'true',
    };

    it('is null (storage disabled) when no S3 variable is set', () => {
      expect(parseEnv(valid).storage).toBeNull();
    });

    it('returns the typed S3 config, public base URL without a trailing slash', () => {
      expect(parseEnv({ ...valid, ...s3 }).storage).toEqual({
        endpoint: 'http://localhost:9000',
        region: 'auto',
        bucket: 'vipe-dev',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        publicBaseUrl: 'http://localhost:9000/vipe-dev',
        forcePathStyle: true,
      });
    });

    it('defaults the region to us-east-1, path style to false and allows no endpoint (AWS)', () => {
      const { S3_ENDPOINT: _e, S3_REGION: _r, S3_FORCE_PATH_STYLE: _f, ...aws } = s3;
      expect(parseEnv({ ...valid, ...aws }).storage).toMatchObject({ endpoint: undefined, region: 'us-east-1', forcePathStyle: false });
    });

    it('rejects a partial S3 configuration and names the missing variables', () => {
      const { S3_SECRET_ACCESS_KEY: _s, S3_PUBLIC_BASE_URL: _p, ...partial } = s3;
      expect(() => parseEnv({ ...valid, ...partial })).toThrow(/S3_SECRET_ACCESS_KEY.*S3_PUBLIC_BASE_URL/);
    });

    it('rejects invalid URLs and a non-boolean S3_FORCE_PATH_STYLE', () => {
      expect(() => parseEnv({ ...valid, ...s3, S3_ENDPOINT: 'localhost:9000' })).toThrow(/S3_ENDPOINT/);
      expect(() => parseEnv({ ...valid, ...s3, S3_PUBLIC_BASE_URL: 'cdn' })).toThrow(/S3_PUBLIC_BASE_URL/);
      expect(() => parseEnv({ ...valid, ...s3, S3_FORCE_PATH_STYLE: 'yes' })).toThrow(/S3_FORCE_PATH_STYLE/);
    });
  });
});
