import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = {
  PORT: '4000',
  DATABASE_URL: 'postgres://vipe_api:secret@localhost:5432/vipe_pos',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('returns typed config from a valid environment', () => {
    expect(parseEnv(valid)).toEqual({
      port: 4000,
      databaseUrl: 'postgres://vipe_api:secret@localhost:5432/vipe_pos',
      webOrigin: 'http://localhost:3000',
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
});
