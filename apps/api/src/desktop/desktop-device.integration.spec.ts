import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Stations and catalog seeded as the superuser for this spec only (F5a). */
const s = {
  cocina: 'f5a00000-0000-0000-0000-0000000000a1',
  barra: 'f5a00000-0000-0000-0000-0000000000a2',
  caja: 'f5a00000-0000-0000-0000-0000000000a3',
  cocinaB: 'f5a00000-0000-0000-0000-0000000000b1',
  mains: 'f5a10000-0000-0000-0000-000000000001',
  drinks: 'f5a10000-0000-0000-0000-000000000002',
} as const;
const JOB_KEYS = ['createdAt', 'id', 'kind', 'payload', 'stationId'];
const printer = (id: string, stationIds: string[], extra: object = {}) => ({
  id, name: `Impresora ${id}`, model: 'TM-T20III', connection: 'usb', paperMm: 80, hasDrawer: true, stationIds, ...extra,
});

describe('desktop device API (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const tokens: Record<'d1' | 'd2' | 'b1', string> = { d1: '', d2: '', b1: '' };
  const ids: Record<'d1' | 'd2' | 'b1', string> = { d1: '', d2: '', b1: '' };

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(
      `INSERT INTO stations (id, name, kind, color, sort_order, restaurant_id) VALUES
         ($1, 'Cocina', 'prep', 'kitchen', 0, $5), ($2, 'Barra', 'prep', 'served', 1, $5),
         ($3, 'Caja', 'cashier', 'occupied', 2, $5), ($4, 'Cocina B', 'prep', 'kitchen', 0, $6)`,
      [s.cocina, s.barra, s.caja, s.cocinaB, fixtures.restaurantA, fixtures.restaurantB],
    );
    await db(
      `INSERT INTO categories (id, name, icon, sort_order, station_id, restaurant_id) VALUES
         ($1, 'Platos fuertes', 'beef', 0, NULL, $3), ($2, 'Bebidas', 'water', 1, $4, $3)`,
      [s.mains, s.drinks, fixtures.restaurantA, s.barra],
    );
    await db(
      `INSERT INTO dishes (name, price, category_id, restaurant_id) VALUES ('Bandeja', 30000, $1, $3), ('Lulo', 8000, $2, $3)`,
      [s.mains, s.drinks, fixtures.restaurantA],
    );
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const [key, admin, name] of [['d1', fixtures.adminA, 'Caja PC'], ['d2', fixtures.adminA, 'Cocina PC'], ['b1', fixtures.adminB, 'B PC']] as const) {
      const code = await request(app.getHttpServer()).post('/api/desktop/pairing-codes').set('Cookie', cookies[admin.email]);
      const res = await request(app.getHttpServer())
        .post('/api/desktop/pairing/claim')
        .send({ code: code.body.code, device: { name, platform: 'windows', appVersion: '1.0.0' } });
      tokens[key] = res.body.deviceToken;
      ids[key] = res.body.deviceId;
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const device = (token: string) => {
    const server = request(app.getHttpServer());
    const auth = `Bearer ${token}`;
    return {
      get: (url: string) => server.get(url).set('Authorization', auth),
      post: (url: string, body?: object) => server.post(url).set('Authorization', auth).send(body),
      put: (url: string, body?: unknown) => server.put(url).set('Authorization', auth).send(body as object),
    };
  };
  const staff = (user: { email: string }) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[user.email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const heartbeat = { appVersion: '1.0.0', printers: [{ id: 'p1', status: 'ready' }], queue: { pending: 2, failed: 1 } };
  const job = async (restaurant: string, stationId: string | null, n: number) =>
    (
      await db<{ id: string }>(
        `INSERT INTO print_jobs (kind, payload, station_id, restaurant_id) VALUES ('command', $1, $2, $3) RETURNING id`,
        [JSON.stringify({ invoiceNumber: `n${n}`, items: [], waiter: 'Ana' }), stationId, restaurant],
      )
    )[0].id;

  it('refuses a missing header, a staff cookie, a printer token and an unknown device token with 401 device_unauthorized', async () => {
    const printerRes = await staff(fixtures.adminA).post('/api/devices/printers', { name: 'Legacy' });
    for (const res of [
      await request(app.getHttpServer()).get('/api/desktop/stations'),
      await staff(fixtures.adminA).get('/api/desktop/stations'),
      await device(printerRes.body.token).get('/api/desktop/stations'),
      await device(`vdt_${'x'.repeat(43)}`).get('/api/desktop/stations'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'device_unauthorized', message: expect.stringContaining('vinculado') });
    }
  });

  it('keeps a device token off the staff routes and off the legacy printer routes', async () => {
    expect((await device(tokens.d1).get('/api/config')).status).toBe(401);
    expect((await device(tokens.d1).get('/api/desktop/devices')).status).toBe(401);
    expect((await device(tokens.d1).post('/api/desktop/pairing-codes')).status).toBe(401);
    expect((await device(tokens.d1).get('/api/print/jobs/pending')).status).toBe(401);
    const jobId = await job(fixtures.restaurantA, null, 0);
    expect((await device(tokens.d1).post(`/api/print/jobs/${jobId}/ack`)).status).toBe(401);
    await db('DELETE FROM print_jobs');
  });

  it('answers the heartbeat with the server time, channel and printing setting, and stores the status', async () => {
    const res = await device(tokens.d1).post('/api/desktop/heartbeat', heartbeat);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ serverTime: expect.any(String), channel: 'stable', printingEnabled: true });
    expect(Math.abs(new Date(res.body.serverTime).getTime() - Date.now())).toBeLessThan(60_000);
    const [row] = await db('SELECT app_version, queue_pending, queue_failed, printer_status FROM desktop_devices WHERE id = $1', [ids.d1]);
    expect(row).toEqual({ app_version: '1.0.0', queue_pending: 2, queue_failed: 1, printer_status: [{ id: 'p1', status: 'ready' }] });
    expect((await device(tokens.d1).post('/api/desktop/heartbeat', { ...heartbeat, queue: { pending: -1, failed: 0 } })).status).toBe(422);
    await db(`INSERT INTO business_config (key, value, restaurant_id) VALUES ('printing_enabled', 'false', $1)`, [fixtures.restaurantA]);
    expect((await device(tokens.d1).post('/api/desktop/heartbeat', heartbeat)).body.printingEnabled).toBe(false);
    expect((await device(tokens.b1).post('/api/desktop/heartbeat', heartbeat)).body.printingEnabled).toBe(true);
    await db(`DELETE FROM business_config WHERE key = 'printing_enabled'`);
  });

  it('lists the stations with the read-only "Qué imprime"', async () => {
    const res = await device(tokens.d1).get('/api/desktop/stations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: s.cocina, name: 'Cocina', kind: 'kitchen', fixed: false, prints: 'Platos fuertes', productCount: 1 },
      { id: s.barra, name: 'Barra', kind: 'bar', fixed: false, prints: 'Bebidas', productCount: 1 },
      { id: s.caja, name: 'Caja', kind: 'cashier', fixed: true, prints: 'Facturas y precuentas', productCount: 0 },
    ]);
    expect((await device(tokens.b1).get('/api/desktop/stations')).body.map((row: { id: string }) => row.id)).toEqual([s.cocinaB]);
  });

  it('stores the printer list and refuses stations of another restaurant, duplicates and more than 20', async () => {
    const res = await device(tokens.d1).put('/api/desktop/printers', [printer('p1', [s.cocina]), printer('p2', [], { connection: 'network', paperMm: 58, hasDrawer: false })]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([printer('p1', [s.cocina]), printer('p2', [], { connection: 'network', paperMm: 58, hasDrawer: false })]);
    const before = await db('SELECT device_id, id, name FROM desktop_printers ORDER BY id');
    const foreign = await device(tokens.d1).put('/api/desktop/printers', [printer('p1', [s.cocinaB])]);
    expect(foreign.status).toBe(422);
    expect(foreign.body).toMatchObject({ code: 'station_invalid', message: expect.stringContaining('estaciones') });
    expect((await device(tokens.d1).put('/api/desktop/printers', [printer('p1', []), printer('p1', [])])).status).toBe(422);
    const many = await device(tokens.d1).put('/api/desktop/printers', Array.from({ length: 21 }, (_, i) => printer(`p${i}`, [])));
    expect(many.status).toBe(422);
    expect(many.body.code).toBe('too_many_printers');
    expect(await db('SELECT device_id, id, name FROM desktop_printers ORDER BY id')).toEqual(before);
    expect((await device(tokens.d2).put('/api/desktop/printers', [printer('k1', [s.barra])])).status).toBe(200);
  });

  it('routes pending jobs per device: no station to everyone, a station to the devices serving it', async () => {
    const free = await job(fixtures.restaurantA, null, 1);
    const cocina = await job(fixtures.restaurantA, s.cocina, 2);
    const barra = await job(fixtures.restaurantA, s.barra, 3);
    const other = await job(fixtures.restaurantB, null, 4);
    const d1 = await device(tokens.d1).get('/api/desktop/jobs/pending');
    expect(d1.status).toBe(200);
    expect(d1.body.map((row: { id: string }) => row.id)).toEqual([free, cocina]);
    expect(Object.keys(d1.body[1]).sort()).toEqual(JOB_KEYS);
    expect(d1.body[1]).toMatchObject({ kind: 'command', stationId: s.cocina, payload: { invoiceNumber: 'n2', waiter: 'Ana' } });
    expect(d1.body[0].stationId).toBeNull();
    expect((await device(tokens.d2).get('/api/desktop/jobs/pending')).body.map((row: { id: string }) => row.id)).toEqual([free, barra]);
    expect((await device(tokens.b1).get('/api/desktop/jobs/pending')).body.map((row: { id: string }) => row.id)).toEqual([other]);
    expect((await device(tokens.d1).get(`/api/desktop/jobs/pending?after=${free}`)).body.map((row: { id: string }) => row.id)).toEqual([cocina]);
    expect((await device(tokens.d1).get('/api/desktop/jobs/pending?limit=1')).body).toHaveLength(1);
    expect((await device(tokens.d1).get('/api/desktop/jobs/pending?after=nope')).status).toBe(422);
    expect((await device(tokens.d1).get('/api/desktop/jobs/pending?limit=501')).status).toBe(422);
  });

  it('acks idempotently per device: printed stays the first status and sets printed_at', async () => {
    const [free] = (await device(tokens.d1).get('/api/desktop/jobs/pending')).body as { id: string }[];
    expect((await device(tokens.d1).post(`/api/desktop/jobs/${free.id}/ack`, { status: 'printed' })).status).toBe(204);
    expect((await device(tokens.d1).post(`/api/desktop/jobs/${free.id}/ack`, { status: 'skipped', reason: 'repetido' })).status).toBe(204);
    expect(await db('SELECT status, reason FROM desktop_job_acks WHERE job_id = $1', [free.id])).toEqual([{ status: 'printed', reason: null }]);
    expect((await db<{ printed: boolean }>('SELECT printed_at IS NOT NULL AS printed FROM print_jobs WHERE id = $1', [free.id]))[0].printed).toBe(true);
    expect((await device(tokens.d1).get('/api/desktop/jobs/pending')).body.map((row: { id: string }) => row.id)).not.toContain(free.id);
    expect((await device(tokens.d2).get('/api/desktop/jobs/pending')).body.map((row: { id: string }) => row.id)).toContain(free.id);
    const [foreign] = (await device(tokens.b1).get('/api/desktop/jobs/pending')).body as { id: string }[];
    const res = await device(tokens.d1).post(`/api/desktop/jobs/${foreign.id}/ack`, { status: 'printed' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('job_not_found');
    expect((await device(tokens.d1).post(`/api/desktop/jobs/${free.id}/ack`, { status: 'done' })).status).toBe(422);
    expect(await db('SELECT 1 FROM desktop_job_acks WHERE job_id = $1', [foreign.id])).toHaveLength(0);
  });

  it('records a drawer opening, keeping only a profile of the restaurant', async () => {
    const openedAt = new Date().toISOString();
    for (const profileId of [fixtures.adminB.profileId, fixtures.waiterA.profileId]) {
      expect((await device(tokens.d1).post('/api/desktop/drawer-events', { printerId: 'p1', openedAt, reason: 'manual', profileId })).status).toBe(204);
    }
    expect((await device(tokens.d1).post('/api/desktop/drawer-events', { printerId: 'p1', openedAt, reason: 'otro' })).status).toBe(422);
    expect(await db('SELECT printer_id, reason, profile_id FROM desktop_drawer_events ORDER BY created_at, profile_id NULLS FIRST')).toEqual([
      { printer_id: 'p1', reason: 'manual', profile_id: null },
      { printer_id: 'p1', reason: 'manual', profile_id: fixtures.waiterA.profileId },
    ]);
  });

  it('lists the devices of the admin restaurant with printers, stations, status and queue', async () => {
    const res = await staff(fixtures.adminA).get('/api/desktop/devices');
    expect(res.status).toBe(200);
    expect(res.body.map((row: { name: string }) => row.name)).toEqual(['Cocina PC', 'Caja PC']);
    const caja = res.body.find((row: { id: string }) => row.id === ids.d1);
    expect(caja).toEqual({
      id: ids.d1, name: 'Caja PC', platform: 'windows', appVersion: '1.0.0', createdAt: expect.any(String), lastSeenAt: expect.any(String),
      online: true, revokedAt: null, queue: { pending: 2, failed: 1 },
      printers: [
        { id: 'p1', name: 'Impresora p1', model: 'TM-T20III', connection: 'usb', paperMm: 80, hasDrawer: true, stationIds: [s.cocina], status: 'ready' },
        { id: 'p2', name: 'Impresora p2', model: 'TM-T20III', connection: 'network', paperMm: 58, hasDrawer: false, stationIds: [], status: null },
      ],
    });
    await db(`UPDATE desktop_devices SET last_seen_at = now() - interval '91 seconds' WHERE id = $1`, [ids.d2]);
    const stale = (await staff(fixtures.adminA).get('/api/desktop/devices')).body.find((row: { id: string }) => row.id === ids.d2);
    expect(stale.online).toBe(false);
    expect((await staff(fixtures.adminB).get('/api/desktop/devices')).body.map((row: { id: string }) => row.id)).toEqual([ids.b1]);
    expect((await staff(fixtures.waiterA).get('/api/desktop/devices')).status).toBe(403);
  });

  it('renames a device of the restaurant only', async () => {
    const res = await staff(fixtures.adminA).patch(`/api/desktop/devices/${ids.d1}`, { name: '  Caja 1  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids.d1, name: 'Caja 1' });
    expect((await staff(fixtures.adminA).patch(`/api/desktop/devices/${ids.d1}`, { name: '' })).status).toBe(422);
    expect((await staff(fixtures.adminA).patch(`/api/desktop/devices/${ids.d1}`, { name: 'x'.repeat(61) })).status).toBe(422);
    const foreign = await staff(fixtures.adminB).patch(`/api/desktop/devices/${ids.d1}`, { name: 'Hack' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('device_not_found');
    expect((await staff(fixtures.waiterA).patch(`/api/desktop/devices/${ids.d1}`, { name: 'Hack' })).status).toBe(403);
    expect((await db<{ name: string }>('SELECT name FROM desktop_devices WHERE id = $1', [ids.d1]))[0].name).toBe('Caja 1');
  });

  it('keeps the legacy vpt_ printer listing and acking while desktop devices exist (S2)', async () => {
    const created = await staff(fixtures.adminA).post('/api/devices/printers', { name: 'Listener pos/' });
    const legacy = device(created.body.token);
    const jobId = await job(fixtures.restaurantA, s.cocina, 9);
    const pending = await legacy.get('/api/print/jobs/pending');
    expect(pending.status).toBe(200);
    expect(pending.body.map((row: { id: string }) => row.id)).toContain(jobId);
    expect(Object.keys(pending.body[0]).sort()).toEqual(['createdAt', 'id', 'kind', 'payload']);
    expect((await legacy.post(`/api/print/jobs/${jobId}/ack`)).status).toBe(204);
    expect((await legacy.get('/api/print/jobs/pending')).body.map((row: { id: string }) => row.id)).not.toContain(jobId);
    expect((await device(tokens.d1).get('/api/desktop/jobs/pending')).body.map((row: { id: string }) => row.id)).toContain(jobId);
  });

  it('revokes a device at once and idempotently: its token answers 401 device_revoked', async () => {
    expect((await staff(fixtures.adminB).delete(`/api/desktop/devices/${ids.d2}`)).status).toBe(404);
    expect((await device(tokens.d2).get('/api/desktop/jobs/pending')).status).toBe(200);
    expect((await staff(fixtures.adminA).delete(`/api/desktop/devices/${ids.d2}`)).status).toBe(204);
    const [{ revoked_at: first }] = await db<{ revoked_at: Date }>('SELECT revoked_at FROM desktop_devices WHERE id = $1', [ids.d2]);
    expect((await staff(fixtures.adminA).delete(`/api/desktop/devices/${ids.d2}`)).status).toBe(204);
    expect((await db<{ revoked_at: Date }>('SELECT revoked_at FROM desktop_devices WHERE id = $1', [ids.d2]))[0].revoked_at).toEqual(first);
    for (const res of [
      await device(tokens.d2).get('/api/desktop/jobs/pending'),
      await device(tokens.d2).post('/api/desktop/heartbeat', heartbeat),
      await device(tokens.d2).get('/api/desktop/updates/windows-x86_64/1.0.0'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'device_revoked', message: expect.stringContaining('desvinculado') });
    }
    const listed = (await staff(fixtures.adminA).get('/api/desktop/devices')).body.find((row: { id: string }) => row.id === ids.d2);
    expect(listed).toMatchObject({ revokedAt: expect.any(String), online: false });
  });
});
