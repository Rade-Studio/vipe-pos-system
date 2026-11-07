import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const DEVICE = { name: 'Caja principal', platform: 'windows', appVersion: '1.0.0' };

describe('desktop pairing and admin devices (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(
      `INSERT INTO business_config (key, value, restaurant_id) VALUES
         ('business_name', 'La Fonda Paisa', $1), ('business_address', 'Calle 10 # 4-21', $1)`,
      [fixtures.restaurantA],
    );
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  beforeEach(async () => {
    await db('DELETE FROM private.desktop_pairing_attempts');
  });

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const as = (user: { email: string }) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[user.email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const anon = () => request(app.getHttpServer());
  const newCode = async (user: { email: string } = fixtures.adminA) => {
    const res = await as(user).post('/api/desktop/pairing-codes');
    expect(res.status).toBe(201);
    return res.body as { code: string; expiresAt: string };
  };
  const claim = (code: string, device: object = DEVICE) => anon().post('/api/desktop/pairing/claim').send({ code, device });
  const deviceCount = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM desktop_devices'))[0].n;

  it('gives an admin a 6-digit code valid 10 minutes and refuses a waiter', async () => {
    const before = Date.now();
    const { code, expiresAt } = await newCode();
    expect(code).toMatch(/^\d{6}$/);
    const ttl = new Date(expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    const stored = await db<{ code_hash: string }>('SELECT code_hash FROM desktop_pairing_codes');
    expect(stored.map((row) => row.code_hash)).not.toContain(code);
    const res = await as(fixtures.waiterA).post('/api/desktop/pairing-codes');
    expect(res.status).toBe(403);
    expect(await db('SELECT 1 FROM desktop_pairing_codes')).toHaveLength(1);
  });

  it('previews the restaurant of a live code without a session', async () => {
    const { code } = await newCode();
    const res = await anon().post('/api/desktop/pairing/preview').send({ code });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      restaurant: { id: fixtures.restaurantA, name: 'La Fonda Paisa', branch: 'Restaurant A', address: 'Calle 10 # 4-21', initials: 'LF' },
    });
    const b = await newCode(fixtures.adminB);
    expect((await anon().post('/api/desktop/pairing/preview').send({ code: b.code })).body).toEqual({
      restaurant: { id: fixtures.restaurantB, name: 'Restaurant B', branch: '', address: '', initials: 'RB' },
    });
  });

  it('answers 404 pairing_code_invalid for an unknown code and 422 for a malformed one', async () => {
    const live = await newCode();
    const unknown = live.code === '000000' ? '000001' : '000000';
    const res = await anon().post('/api/desktop/pairing/preview').send({ code: unknown });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'pairing_code_invalid', message: expect.stringContaining('código') });
    expect((await anon().post('/api/desktop/pairing/preview').send({ code: '12345' })).status).toBe(422);
    expect((await claim(unknown)).status).toBe(404);
    expect(await deviceCount()).toBe(0);
  });

  it('claims a code once: 201 with the token, then 410 pairing_code_expired', async () => {
    const { code } = await newCode();
    const res = await claim(code);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      deviceId: expect.any(String),
      deviceToken: expect.stringMatching(/^vdt_[A-Za-z0-9_-]{43}$/),
      restaurant: { id: fixtures.restaurantA, name: 'La Fonda Paisa', branch: 'Restaurant A', address: 'Calle 10 # 4-21', initials: 'LF' },
      channel: 'stable',
    });
    const [row] = await db<{ token_hash: string; name: string; created_by: string }>(
      'SELECT token_hash, name, created_by FROM desktop_devices WHERE id = $1',
      [res.body.deviceId],
    );
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row).toMatchObject({ name: 'Caja principal', created_by: fixtures.adminA.profileId });
    const again = await claim(code, { ...DEVICE, name: 'Otra' });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('pairing_code_expired');
    expect((await anon().post('/api/desktop/pairing/preview').send({ code })).status).toBe(410);
    expect(await deviceCount()).toBe(1);
  });

  it('answers 410 for an expired code and the pilot channel of the restaurant', async () => {
    const { code } = await newCode();
    await db(`UPDATE desktop_pairing_codes SET expires_at = now() - interval '1 minute' WHERE claimed_at IS NULL`);
    expect((await anon().post('/api/desktop/pairing/preview').send({ code })).status).toBe(410);
    expect((await claim(code)).body.code).toBe('pairing_code_expired');
    await request(app.getHttpServer()).put('/api/config').set('Cookie', cookies[fixtures.adminA.email]).send({ desktopUpdateChannel: 'pilot' });
    const fresh = await newCode();
    expect((await claim(fresh.code)).body.channel).toBe('pilot');
    await db(`DELETE FROM business_config WHERE key = 'desktop_update_channel'`);
  });

  it('refuses with 429 pairing_attempts after 5 wrong codes from one IP, even a right code', async () => {
    const { code } = await newCode();
    const wrong = code === '999999' ? '999998' : '999999';
    for (let i = 0; i < 5; i++) {
      expect((await anon().post('/api/desktop/pairing/preview').send({ code: wrong })).status).toBe(404);
    }
    const blocked = await anon().post('/api/desktop/pairing/preview').send({ code });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'pairing_attempts', message: expect.stringContaining('intentos') });
    const before = await deviceCount();
    expect((await claim(code)).status).toBe(429);
    expect(await deviceCount()).toBe(before);
  });

  it('refuses every IP with 429 once 100 wrong codes were tried globally', async () => {
    const { code } = await newCode();
    await db(`INSERT INTO private.desktop_pairing_attempts (key, failures) VALUES ('global', 100)`);
    expect((await anon().post('/api/desktop/pairing/preview').send({ code })).status).toBe(429);
  });
});
