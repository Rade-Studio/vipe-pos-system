import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

// F5a independent verifier probes (L34, L36), kept as a regression suite. No DESKTOP_RELEASES_BASE_URL in this app.
const st = { cocina: 'f5af0000-0000-0000-0000-0000000000a1', barra: 'f5af0000-0000-0000-0000-0000000000a2', cocinaB: 'f5af0000-0000-0000-0000-0000000000b1' };
const printer = (id: string, stationIds: string[], extra: object = {}) => ({
  id, name: `P ${id}`, model: '', connection: 'usb', paperMm: 80, hasDrawer: false, stationIds, ...extra,
});

describe('F5a verifier probes (HTTP)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let tokA = '';
  let idA = '';
  let tokB = '';
  let vpt = '';
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const http = () => request(app.getHttpServer());
  const dev = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body?: unknown) => http().put(url).set('Authorization', `Bearer ${token}`).send(body as object),
  });
  const beat = { appVersion: '1.0.0', printers: [], queue: { pending: 0, failed: 0 } };
  const code = async (email: string) => (await http().post('/api/desktop/pairing-codes').set('Cookie', cookies[email])).body.code as string;
  const claim = (c: string, name = 'PC', ip?: string) => {
    const r = http().post('/api/desktop/pairing/claim');
    if (ip) r.set('X-Forwarded-For', ip);
    return r.send({ code: c, device: { name, platform: 'windows', appVersion: '1.0.0' } });
  };
  const job = async (restaurant: string, stationId: string | null) =>
    (await db<{ id: string }>(`INSERT INTO print_jobs (restaurant_id, kind, payload, station_id) VALUES ($1, 'command', '{}', $2) RETURNING id`, [restaurant, stationId]))[0].id;

  beforeAll(async () => {
    delete process.env.DESKTOP_RELEASES_BASE_URL;
    database = await startTestDatabase();
    await db(`INSERT INTO stations (id, name, kind, color, sort_order, restaurant_id) VALUES ($1, 'Cocina', 'prep', 'kitchen', 0, $4), ($2, 'Barra', 'prep', 'served', 1, $4), ($3, 'Cocina B', 'prep', 'kitchen', 0, $5)`,
      [st.cocina, st.barra, st.cocinaB, fixtures.restaurantA, fixtures.restaurantB]);
    await db(`INSERT INTO desktop_releases (channel, target, version, file, signature, required) VALUES ('stable', 'linux-x86_64', '9.0.0', 'l', 's', true)`);
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
    const a = await claim(await code(fixtures.adminA.email), 'A');
    tokA = a.body.deviceToken; idA = a.body.deviceId;
    tokB = (await claim(await code(fixtures.adminB.email), 'B')).body.deviceToken;
    vpt = (await http().post('/api/devices/printers').set('Cookie', cookies[fixtures.adminA.email]).send({ name: 'Legacy' })).body.token;
  });
  afterAll(async () => { await app?.close(); await database?.stop(); });

  it('V1 a device token reaches no staff and no legacy print route', async () => {
    for (const [m, url] of [['get', '/api/config'], ['get', '/api/orders'], ['get', '/api/desktop/devices'], ['post', '/api/desktop/pairing-codes'], ['get', '/api/print/jobs/pending']] as const) {
      const res = await (m === 'get' ? dev(tokA).get(url) : dev(tokA).post(url, {}));
      expect([url, res.status]).toEqual([url, 401]);
    }
    const j = await job(fixtures.restaurantA, null);
    expect((await dev(tokA).post(`/api/print/jobs/${j}/ack`, {})).status).toBe(401);
  });

  it('V2 vpt_, staff cookie and malformed bearer values answer 401 device_unauthorized, never 500', async () => {
    const bad = [`Bearer ${vpt}`, 'Bearer vdt_', 'Bearer vdt_' + 'x'.repeat(300), `bearer ${tokA}`, `Bearer  ${tokA}`, `Bearer ${tokA} x`, 'Basic abc', `Bearer ${tokA.slice(0, -1)}`, `Bearer vdt_${'ñ'.repeat(10)}`];
    for (const value of bad) {
      const res = await http().post('/api/desktop/heartbeat').set('Authorization', value).send(beat);
      expect([value.slice(0, 20), res.status, res.body.code]).toEqual([value.slice(0, 20), 401, 'device_unauthorized']);
    }
    const cookie = await http().post('/api/desktop/heartbeat').set('Cookie', cookies[fixtures.adminA.email]).send(beat);
    expect([cookie.status, cookie.body.code]).toEqual([401, 'device_unauthorized']);
    expect((await http().get('/api/print/jobs/pending').set('Authorization', `Bearer ${vpt}`)).status).toBe(200);
  });

  it('V3 pairing input validation (422) and claimed code 410', async () => {
    for (const body of [{ code: '12345' }, { code: '1234567' }, { code: ' 123456' }, { code: 123456 }, { code: '123456', x: 1 }, {}]) {
      expect((await http().post('/api/desktop/pairing/preview').send(body)).status).toBe(422);
    }
    const c = await code(fixtures.adminA.email);
    for (const device of [{ name: 'x'.repeat(61), platform: 'windows', appVersion: '1' }, { name: '   ', platform: 'windows', appVersion: '1' },
      { name: 'x', platform: 'macos', appVersion: '1' }, { name: 'x', platform: 'windows', appVersion: 'x'.repeat(33) }]) {
      expect((await http().post('/api/desktop/pairing/claim').send({ code: c, device })).status).toBe(422);
    }
    expect((await claim(c)).status).toBe(201);
    const again = await claim(c);
    expect([again.status, again.body.code]).toEqual([410, 'pairing_code_expired']);
  });

  it('V4 printers registry bounds and cross-tenant stations', async () => {
    const put = (body: unknown) => dev(tokA).put('/api/desktop/printers', body);
    const cross = await put([printer('p1', [st.cocinaB])]);
    expect([cross.status, cross.body.code]).toEqual([422, 'station_invalid']);
    const many = await put(Array.from({ length: 21 }, (_, i) => printer(`p${i}`, [])));
    expect([many.status, many.body.code]).toEqual([422, 'too_many_printers']);
    expect((await put([printer('p1', []), printer('p1', [])])).status).toBe(422);
    expect((await put([printer('p1', [], { paperMm: 70 })])).status).toBe(422);
    expect((await put({})).status).toBe(422);
    const upper = await put([printer('p1', [st.cocina.toUpperCase()])]);
    expect([upper.status, upper.body[0]?.stationIds]).toEqual([200, [st.cocina]]);
  });

  it('V5 pending query bounds, foreign after, ack errors', async () => {
    for (const q of ['limit=0', 'limit=501', 'limit=abc', 'after=nope', 'x=1']) {
      expect([q, (await dev(tokA).get(`/api/desktop/jobs/pending?${q}`)).status]).toEqual([q, 422]);
    }
    const jb = await job(fixtures.restaurantB, null);
    const foreign = await dev(tokA).get(`/api/desktop/jobs/pending?after=${jb}`);
    expect([foreign.status, foreign.body]).toEqual([200, []]);
    const nf = await dev(tokA).post(`/api/desktop/jobs/${jb}/ack`, { status: 'printed' });
    expect([nf.status, nf.body.code]).toEqual([404, 'job_not_found']);
    const ja = await job(fixtures.restaurantA, null);
    expect((await dev(tokA).post(`/api/desktop/jobs/${ja}/ack`, { status: 'done' })).status).toBe(422);
    expect((await dev(tokA).post(`/api/desktop/jobs/${ja}/ack`, { status: 'printed', reason: 'x'.repeat(201) })).status).toBe(422);
    expect((await dev(tokA).post('/api/desktop/jobs/not-a-uuid/ack', { status: 'printed' })).status).toBe(422);
    expect((await db(`SELECT printed_at FROM print_jobs WHERE id = $1`, [jb]))[0].printed_at).toBeNull();
  });

  it('V6 printed ack hides the job from the legacy listener; skipped does not', async () => {
    const printed = await job(fixtures.restaurantA, null);
    const skipped = await job(fixtures.restaurantA, null);
    expect((await dev(tokA).post(`/api/desktop/jobs/${printed}/ack`, { status: 'printed' })).status).toBe(204);
    expect((await dev(tokA).post(`/api/desktop/jobs/${skipped}/ack`, { status: 'skipped', reason: 'viejo' })).status).toBe(204);
    const legacy = await http().get('/api/print/jobs/pending').set('Authorization', `Bearer ${vpt}`);
    const ids = (legacy.body as { id: string }[]).map((j) => j.id);
    expect(ids).not.toContain(printed);
    expect(ids).toContain(skipped);
  });

  it('V7 heartbeat bounds; no updateRequired without a base URL or for another target', async () => {
    const long = await dev(tokA).post('/api/desktop/heartbeat', { ...beat, printers: [{ id: 'p', status: 'error', error: 'x'.repeat(201) }] });
    expect(long.status).toBe(200);
    const [stored] = await db<{ printer_status: { error: string }[] }>('SELECT printer_status FROM desktop_devices WHERE id = $1', [idA]);
    expect(stored.printer_status[0].error).toHaveLength(200);
    expect((await dev(tokA).post('/api/desktop/heartbeat', { ...beat, queue: { pending: -1, failed: 0 } })).status).toBe(422);
    const hb = await dev(tokA).post('/api/desktop/heartbeat', beat);
    expect(hb.status).toBe(200);
    // A required release of another target (linux-x86_64) never flags a Windows device, and without a base URL nothing does.
    expect(hb.body).not.toHaveProperty('updateRequired');
    expect((await dev(tokA).get('/api/desktop/updates/windows/1.0.0')).status).toBe(204);
    for (const v of ['1.0.0-beta', '01.0.0', '1.0', 'v1.0.0', '1.0.0.0']) {
      const res = await dev(tokA).get(`/api/desktop/updates/windows/${v}`);
      expect([v, res.status, res.body.code]).toEqual([v, 422, 'version_invalid']);
    }
    expect((await dev(tokA).get('/api/desktop/updates/WINDOWS/1.0.0')).status).toBe(422);
  });

  it('V8 pairing limit: 5 wrong per IP, then even a valid code is refused; X-Forwarded-For does not move the bucket', async () => {
    await db(`DELETE FROM private.desktop_pairing_attempts`);
    for (let i = 0; i < 5; i += 1) {
      expect((await http().post('/api/desktop/pairing/preview').send({ code: `00000${i}` })).status).toBe(404);
    }
    const valid = await code(fixtures.adminA.email);
    const blocked = await claim(valid, 'PC', '203.0.113.9');
    expect([blocked.status, blocked.body.code]).toEqual([429, 'pairing_attempts']);
    expect((await db(`SELECT count(*)::int AS n FROM private.desktop_pairing_attempts`))[0].n).toBe(2);
    await db(`DELETE FROM private.desktop_pairing_attempts`);
    expect((await claim(valid)).status).toBe(201);
  });

  it('V10 two concurrent claims of one code: exactly one 201, the other 410, one device', async () => {
    const c = await code(fixtures.adminA.email);
    const results = await Promise.all([claim(c, 'Concurrente 1'), claim(c, 'Concurrente 2')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(results.find((r) => r.status === 410)?.body.code).toBe('pairing_code_expired');
    const rows = await db<{ n: number }>(`SELECT count(*)::int AS n FROM desktop_devices WHERE name LIKE 'Concurrente %'`);
    expect(rows[0].n).toBe(1);
  });

  it('V9 admin isolation and immediate revoke during paging', async () => {
    const b = { cookie: cookies[fixtures.adminB.email] };
    expect((await http().patch(`/api/desktop/devices/${idA}`).set('Cookie', b.cookie).send({ name: 'pwn' })).body.code).toBe('device_not_found');
    expect((await http().delete(`/api/desktop/devices/${idA}`).set('Cookie', b.cookie)).status).toBe(404);
    expect((await http().delete(`/api/desktop/devices/${idA}`).set('Cookie', cookies[fixtures.waiterA.email])).status).toBe(403);
    const listB = await http().get('/api/desktop/devices').set('Cookie', b.cookie);
    expect((listB.body as { id: string }[]).map((d) => d.id)).not.toContain(idA);
    expect(JSON.stringify(listB.body)).not.toMatch(/token|hash/i);
    for (let i = 0; i < 3; i += 1) await job(fixtures.restaurantA, null);
    const page1 = await dev(tokA).get('/api/desktop/jobs/pending?limit=1');
    expect(page1.status).toBe(200);
    expect((await http().delete(`/api/desktop/devices/${idA}`).set('Cookie', cookies[fixtures.adminA.email])).status).toBe(204);
    const page2 = await dev(tokA).get(`/api/desktop/jobs/pending?limit=1&after=${page1.body[0].id}`);
    expect([page2.status, page2.body.code]).toEqual([401, 'device_revoked']);
    expect((await http().delete(`/api/desktop/devices/${idA}`).set('Cookie', cookies[fixtures.adminA.email])).status).toBe(204);
    expect((await dev(tokB).post('/api/desktop/heartbeat', beat)).status).toBe(200);
  });
});
