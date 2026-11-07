import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const BASE = 'https://downloads.vipe.test/desktop';
const TARGET = 'windows-x86_64';

describe('desktop updates (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let token = '';

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(
      `INSERT INTO desktop_releases (channel, target, version, file, signature, notes, pub_date, required) VALUES
         ('stable', $1, '1.0.5', 'stable/1.0.5/vipe.msi.zip', 'sig-105', 'Arreglo de cajón', now() - interval '9 days', true),
         ('stable', $1, '1.1.0', 'stable/1.1.0/vipe.msi.zip', 'sig-110', 'Cola más rápida', now() - interval '2 days', false),
         ('stable', $1, '0.9.0', 'stable/0.9.0/vipe.msi.zip', 'sig-090', '', now() - interval '30 days', false),
         ('stable', 'linux-x86_64', '9.0.0', 'linux/vipe.tar.gz', 'sig-l', '', now(), false),
         ('pilot', $1, '1.2.0', 'pilot/1.2.0/vipe.msi.zip', 'sig-120', 'Nueva cola', now() - interval '1 day', false)`,
      [TARGET],
    );
    process.env.DESKTOP_RELEASES_BASE_URL = `${BASE}/`;
    app = await createTestApp(database.apiUrl);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD });
    const cookie = cookiePair(setCookies(login).vipe_access);
    const code = await request(app.getHttpServer()).post('/api/desktop/pairing-codes').set('Cookie', cookie);
    const claim = await request(app.getHttpServer())
      .post('/api/desktop/pairing/claim')
      .send({ code: code.body.code, device: { name: 'Caja', platform: 'windows', appVersion: '1.0.0' } });
    token = claim.body.deviceToken;
  });

  afterAll(async () => {
    delete process.env.DESKTOP_RELEASES_BASE_URL;
    await app?.close();
    await database?.stop();
  });

  const get = (url: string, server = app) => request(server.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`);
  const setChannel = (channel: string) =>
    db(
      `INSERT INTO business_config (key, value, restaurant_id) VALUES ('desktop_update_channel', $1, $2)
       ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
      [channel, fixtures.restaurantA],
    );

  it('offers the newest stable release above the current version as a Tauri manifest', async () => {
    const res = await get(`/api/desktop/updates/${TARGET}/1.0.0`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: '1.1.0',
      notes: 'Cola más rápida',
      pub_date: expect.any(String),
      url: `${BASE}/stable/1.1.0/vipe.msi.zip`,
      signature: 'sig-110',
    });
    expect(new Date(res.body.pub_date).toISOString()).toBe(res.body.pub_date);
  });

  it('answers 204 when up to date or for an unknown target', async () => {
    expect((await get(`/api/desktop/updates/${TARGET}/1.1.0`)).status).toBe(204);
    expect((await get(`/api/desktop/updates/${TARGET}/1.10.0`)).status).toBe(204);
    expect((await get('/api/desktop/updates/macos-aarch64/1.0.0')).status).toBe(204);
  });

  it('refuses a malformed version or target with 422 version_invalid', async () => {
    for (const url of [`/api/desktop/updates/${TARGET}/1.0`, `/api/desktop/updates/${TARGET}/01.0.0`, `/api/desktop/updates/${TARGET}/1.0.0-beta`, '/api/desktop/updates/WIN!/1.0.0']) {
      const res = await get(url);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('version_invalid');
    }
  });

  it('gives the pilot channel pilot and stable releases', async () => {
    await setChannel('pilot');
    const res = await get(`/api/desktop/updates/${TARGET}/1.1.0`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: '1.2.0', url: `${BASE}/pilot/1.2.0/vipe.msi.zip`, signature: 'sig-120' });
    await setChannel('stable');
  });

  it('flags updateRequired in the heartbeat below the newest required release only', async () => {
    const beat = (appVersion: string) =>
      request(app.getHttpServer())
        .post('/api/desktop/heartbeat')
        .set('Authorization', `Bearer ${token}`)
        .send({ appVersion, printers: [], queue: { pending: 0, failed: 0 } });
    expect((await beat('1.0.0')).body).toMatchObject({ updateRequired: true, channel: 'stable' });
    expect((await beat('1.0.5')).body).not.toHaveProperty('updateRequired');
    expect((await beat('1.1.0')).body).not.toHaveProperty('updateRequired');
  });

  it('answers 204 when DESKTOP_RELEASES_BASE_URL is not set', async () => {
    delete process.env.DESKTOP_RELEASES_BASE_URL;
    const bare = await createTestApp(database.apiUrl);
    try {
      expect((await get(`/api/desktop/updates/${TARGET}/1.0.0`, bare)).status).toBe(204);
    } finally {
      await bare.close();
    }
  });
});
