import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createDb } from '@vipe/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const v = {
  mains: 'f6a30000-0000-0000-0000-000000000001',
  drinks: 'f6a30000-0000-0000-0000-000000000002',
  catB: 'f6a30000-0000-0000-0000-0000000000b1',
  bandeja: 'f6a40000-0000-0000-0000-000000000001',
  lulo: 'f6a40000-0000-0000-0000-000000000002',
  old: 'f6a40000-0000-0000-0000-000000000003',
  noCat: 'f6a40000-0000-0000-0000-000000000004',
  dishB: 'f6a40000-0000-0000-0000-0000000000b1',
  t1: 'f6a50000-0000-0000-0000-000000000001',
  t2: 'f6a50000-0000-0000-0000-000000000002',
};
const extra = [
  { role: 'cashier', userId: '10000000-0000-0000-0000-0000000000f1', profileId: '20000000-0000-0000-0000-0000000000f1', email: 'cash@a.test' },
  { role: 'kitchen', userId: '10000000-0000-0000-0000-0000000000f2', profileId: '20000000-0000-0000-0000-0000000000f2', email: 'cook@a.test' },
  { role: 'delivery_operator', userId: '10000000-0000-0000-0000-0000000000f3', profileId: '20000000-0000-0000-0000-0000000000f3', email: 'del@a.test' },
];

describe('F6 verifier probes', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);

  beforeAll(async () => {
    database = await startTestDatabase();
    const A = fixtures.restaurantA;
    await db(`INSERT INTO categories (id, name, icon, sort_order, restaurant_id) VALUES ($1,'Fuertes','beef',0,$3), ($2,'Bebidas','water',1,$3), ($4,'B cat','x',0,$5)`, [v.mains, v.drinks, A, v.catB, fixtures.restaurantB]);
    await db(`INSERT INTO dishes (id, name, price, category_id, restaurant_id, active) VALUES
      ($1,'Bandeja',30000,$5,$7,true), ($2,'Lulo',8000,$6,$7,true), ($3,'Viejo',1000,$5,$7,false), ($4,'Sin categoria',1000,NULL,$7,true), ($8,'Gaseosa B',5000,$9,$10,true)`,
      [v.bandeja, v.lulo, v.old, v.noCat, v.mains, v.drinks, A, v.dishB, v.catB, fixtures.restaurantB]);
    await db(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, 31, 'available', $3), ($2, 32, 'available', $3)`, [v.t1, v.t2, A]);
    for (const u of extra) {
      await db(`INSERT INTO users (id, email, password_hash) SELECT $1, $2, password_hash FROM users WHERE id = $3`, [u.userId, u.email, fixtures.adminA.userId]);
      await db(`INSERT INTO profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES ($1,$2,$3,$4,$5,true,$6)`, [u.profileId, u.userId, u.role, u.email, u.role, A]);
    }
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB, ...extra]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });
  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });
  const as = (email: string) => {
    const s = request(app.getHttpServer());
    const c = cookies[email];
    return {
      get: (u: string) => s.get(u).set('Cookie', c),
      post: (u: string, b?: object) => s.post(u).set('Cookie', c).send(b),
      patch: (u: string, b?: object) => s.patch(u).set('Cookie', c).send(b),
      put: (u: string, b?: object) => s.put(u).set('Cookie', c).send(b),
      delete: (u: string, b?: object) => s.delete(u).set('Cookie', c).send(b),
    };
  };
  const admin = () => as(fixtures.adminA.email);
  const adminB = () => as(fixtures.adminB.email);
  const state = async () => JSON.stringify(await db(`SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM stations s) AS s,
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id, station_id) ORDER BY id), '[]') FROM categories) AS c,
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id, station_id) ORDER BY id), '[]') FROM dishes) AS d,
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id, station_id, station_source) ORDER BY id), '[]') FROM order_items) AS oi`));

  it('V1 role matrix: every staff role reads GET /stations; only the admin writes or reads routes', async () => {
    ids.st = (await admin().post('/api/stations/starter')).body.map((s: { name: string; id: string }) => [s.name, s.id]);
    Object.assign(ids, Object.fromEntries(ids.st as unknown as [string, string][]));
    const before = await state();
    for (const email of [fixtures.waiterA.email, ...extra.map((e) => e.email)]) {
      const u = as(email);
      expect((await u.get('/api/stations')).status, email).toBe(200);
      expect((await u.get('/api/stations/routes')).status, email).toBe(403);
      expect((await u.post('/api/stations', { name: 'X' })).status, email).toBe(403);
      expect((await u.post('/api/stations/starter')).status, email).toBe(403);
      expect((await u.patch(`/api/stations/${ids.Barra}`, { name: 'Y' })).status, email).toBe(403);
      expect((await u.delete(`/api/stations/${ids.Barra}`, { moveTo: ids.Cocina })).status, email).toBe(403);
      expect((await u.put(`/api/stations/routes/categories/${v.mains}`, { stationId: ids.Barra })).status, email).toBe(403);
      expect((await u.put(`/api/stations/routes/dishes/${v.lulo}`, { stationId: ids.Barra })).status, email).toBe(403);
    }
    expect(await state()).toBe(before);
  });

  it('V2 cross-tenant: admin B cannot touch A stations or route to them; nothing changes', async () => {
    const before = await state();
    const r1 = await adminB().put(`/api/stations/routes/categories/${v.mains}`, { stationId: null });
    expect([r1.status, r1.body.code]).toEqual([404, 'category_not_found']);
    const r2 = await adminB().put(`/api/stations/routes/categories/${v.catB}`, { stationId: ids.Cocina });
    expect([r2.status, r2.body.code]).toEqual([422, 'station_invalid']);
    const r3 = await adminB().put(`/api/stations/routes/dishes/${v.dishB}`, { stationId: ids.Barra });
    expect([r3.status, r3.body.code]).toEqual([422, 'station_invalid']);
    const r4 = await adminB().delete(`/api/stations/${ids.Barra}`, { moveTo: null });
    expect([r4.status, r4.body.code]).toEqual([404, 'station_not_found']);
    const r5 = await adminB().patch(`/api/stations/${ids.Barra}`, { name: 'Hack' });
    expect([r5.status, r5.body.code]).toEqual([404, 'station_not_found']);
    expect((await adminB().get('/api/stations')).body).toEqual([]);
    const own = await adminB().post('/api/stations', { name: 'Cocina B' });
    const r6 = await adminB().delete(`/api/stations/${own.body.id}`, { moveTo: ids.Cocina });
    expect([r6.status, r6.body.code]).toEqual([422, 'target_invalid']);
    await db('DELETE FROM stations WHERE id = $1', [own.body.id]);
    expect(await state()).toBe(before);
  });

  it('V3 validation and refusals with exact codes; rejected writes change nothing', async () => {
    const before = await state();
    const cases: [() => Promise<request.Response>, number, string | undefined][] = [
      [() => admin().post('/api/stations', { name: 'cocina ' }), 409, 'station_name_taken'],
      [() => admin().post('/api/stations', { name: 'Caja 2', kind: 'cashier' }), 409, 'cashier_exists'],
      [() => admin().post('/api/stations', { name: 'x'.repeat(41) }), 422, undefined],
      [() => admin().post('/api/stations', { name: '   ' }), 422, undefined],
      [() => admin().post('/api/stations', { name: 'Horno', color: 'pink' }), 422, undefined],
      [() => admin().post('/api/stations', { name: 'Horno', isDefault: true }), 422, undefined],
      [() => admin().post('/api/stations/starter'), 409, 'stations_exist'],
      [() => admin().patch(`/api/stations/${ids.Barra}`, {}), 422, undefined],
      [() => admin().patch(`/api/stations/${ids.Barra}`, { name: 'COCINA' }), 409, 'station_name_taken'],
      [() => admin().patch(`/api/stations/${ids.Barra}`, { kind: 'cashier' }), 422, undefined],
      [() => admin().patch('/api/stations/f6a00000-0000-0000-0000-00000000dead', { name: 'Z' }), 404, 'station_not_found'],
      [() => admin().put(`/api/stations/routes/categories/${v.mains}`, { stationId: ids.Caja }), 422, 'cashier_route'],
      [() => admin().put(`/api/stations/routes/dishes/${v.lulo}`, { stationId: ids.Caja }), 422, 'cashier_route'],
      [() => admin().put(`/api/stations/routes/dishes/${v.lulo}`, { stationId: 'f6a00000-0000-0000-0000-00000000dead' }), 422, 'station_invalid'],
      [() => admin().put('/api/stations/routes/dishes/f6a00000-0000-0000-0000-00000000dead', { stationId: null }), 404, 'dish_not_found'],
      [() => admin().put(`/api/stations/routes/dishes/${v.lulo}`, {}), 422, undefined],
      [() => admin().delete(`/api/stations/${ids.Caja}`, { moveTo: ids.Cocina }), 409, 'cashier_station'],
      [() => admin().delete(`/api/stations/${ids.Barra}`), 422, 'move_required'],
      [() => admin().delete(`/api/stations/${ids.Barra}`, { moveTo: ids.Barra }), 422, 'target_invalid'],
      [() => admin().delete('/api/stations/f6a00000-0000-0000-0000-00000000dead', { moveTo: ids.Cocina }), 404, 'station_not_found'],
    ];
    for (const [pending, status, code] of cases) {
      const res = await pending();
      expect([res.status, res.body.code, typeof res.body.message], JSON.stringify(res.body)).toEqual([status, code, 'string']);
    }
    expect(await state()).toBe(before);
  });

  it('V4 too many stations: the 21st is 409 too_many_stations', async () => {
    for (let i = 0; i < 17; i += 1) expect((await admin().post('/api/stations', { name: `S${i}` })).status).toBe(201);
    const res = await admin().post('/api/stations', { name: 'S-extra' });
    expect([res.status, res.body.code]).toEqual([409, 'too_many_stations']);
    for (let i = 0; i < 17; i += 1) {
      const id = (await db<{ id: string }>('SELECT id FROM stations WHERE name = $1', [`S${i}`]))[0].id;
      expect((await admin().delete(`/api/stations/${id}`, { moveTo: ids.Cocina })).status).toBe(204);
    }
  });

  it('V5 unrouted dishes: active fallback dishes only, by category route and dish exception', async () => {
    await admin().put(`/api/stations/routes/categories/${v.drinks}`, { stationId: ids.Barra });
    const res = await admin().get('/api/stations/routes');
    expect(res.status).toBe(200);
    expect(res.body.unroutedDishes.map((d: { name: string }) => d.name).sort()).toEqual(['Bandeja', 'Sin categoria']);
    await admin().put(`/api/stations/routes/dishes/${v.bandeja}`, { stationId: ids.Cocina });
    const after = await admin().get('/api/stations/routes');
    expect(after.body.unroutedDishes.map((d: { name: string }) => d.name)).toEqual(['Sin categoria']);
    const bandeja = after.body.dishes.find((d: { id: string }) => d.id === v.bandeja);
    expect(bandeja).toMatchObject({ stationId: ids.Cocina, routedStationId: ids.Cocina, source: 'dish' });
    expect(after.body.categories.find((c: { id: string }) => c.id === v.mains)).toMatchObject({ stationId: null, dishCount: 2 });
  });

  it('V6 order lines and comandas: per-station split, kitchen filter for kitchen/cashier, tenant-safe', async () => {
    const order = await as(fixtures.waiterA.email).post('/api/orders', {
      tableId: v.t1, orderType: 'dine_in', items: [v.bandeja, v.lulo, v.noCat].map((dishId) => ({ dishId, quantity: 1 })),
    });
    expect(order.status).toBe(201);
    expect(order.body.items.map((i: { stationId: string; stationSource: string }) => [i.stationId, i.stationSource])).toEqual([
      [ids.Cocina, 'dish'], [ids.Barra, 'category'], [ids.Cocina, 'fallback'],
    ]);
    for (const email of ['cook@a.test', 'cash@a.test']) {
      const res = await as(email).get(`/api/orders?status=kitchen&stationId=${ids.Barra}`);
      expect(res.status, email).toBe(200);
      expect(res.body.map((o: { items: { name: string }[] }) => o.items.map((i) => i.name))).toEqual([['Lulo']]);
    }
    expect((await adminB().get(`/api/orders?stationId=${ids.Cocina}`)).body).toEqual([]);
    expect((await as('cook@a.test').get(`/api/orders?status=kitchen&stationId=${ids.Caja}`)).body).toEqual([]);
    await db('DELETE FROM print_jobs');
    const [{ id: orderId }] = await db<{ id: string }>('SELECT id FROM orders WHERE restaurant_id = $1 LIMIT 1', [fixtures.restaurantA]);
    const cmd = await as(fixtures.waiterA.email).post('/api/print/commands', {
      orderId,
      items: [{ id: `${v.lulo}-1`, name: 'Lulo', quantity: 1 }, { id: `${v.bandeja}-2`, name: 'Bandeja', quantity: 1 }, { dishId: v.dishB, id: 'z', name: 'Foreign', quantity: 1 }],
      waiter: 'W', table: 31,
    });
    expect(cmd.status).toBe(201);
    expect(Object.keys(cmd.body).sort()).toEqual(['createdAt', 'id', 'jobs', 'kind']);
    const jobs = await db<{ id: string; station_id: string; payload: { items: { name: string }[]; station: { id: string; name: string }; invoiceNumber: string } }>(
      'SELECT id, station_id, payload FROM print_jobs ORDER BY created_at, id');
    expect(jobs.map((j) => [j.payload.station.name, j.payload.items.map((i) => i.name), j.payload.invoiceNumber === j.id, j.station_id === j.payload.station.id])).toEqual([
      ['Cocina', ['Bandeja', 'Foreign'], true, true],
      ['Barra', ['Lulo'], true, true],
    ]);
    expect(cmd.body.jobs.map((j: { id: string }) => j.id)).toEqual(jobs.map((j) => j.id));
  });

  it('V7 delete a station moves its stored lines so its kitchen filter follows; Caja and printing-off', async () => {
    const del = await admin().delete(`/api/stations/${ids.Barra}`, { moveTo: ids.Cocina });
    expect(del.status).toBe(204);
    const res = await as('cook@a.test').get(`/api/orders?status=kitchen&stationId=${ids.Cocina}`);
    expect(res.body[0].items.map((i: { name: string }) => i.name)).toEqual(['Bandeja', 'Lulo', 'Sin categoria']);
    await admin().put('/api/config', { printingEnabled: false });
    const before = (await db<{ n: number }>('SELECT count(*)::int AS n FROM print_jobs'))[0].n;
    const off = await as('cash@a.test').post('/api/print/invoices', { invoice: { invoiceNumber: 'F-9' }, displayItems: [] });
    expect([off.status, off.body.code]).toEqual([409, 'printing_disabled']);
    const bad = await as('cash@a.test').post('/api/print/invoices', { displayItems: [] });
    expect(bad.status).toBe(422);
    expect((await db<{ n: number }>('SELECT count(*)::int AS n FROM print_jobs'))[0].n).toBe(before);
    expect((await as('cook@a.test').get('/api/config')).body.printingEnabled).toBe(false);
    await admin().put('/api/config', { printingEnabled: true });
  });

  it('V8 a line and a comanda sent while their station is being deleted wait and land on the target', async () => {
    const postres = (await admin().post('/api/stations', { name: 'Postres' })).body.id as string;
    await admin().put(`/api/stations/routes/dishes/${v.lulo}`, { stationId: postres });
    await db('DELETE FROM print_jobs');
    const [{ id: orderId }] = await db<{ id: string }>('SELECT id FROM orders WHERE restaurant_id = $1 LIMIT 1', [fixtures.restaurantA]);
    const { pool } = createDb(database.apiUrl, { max: 1 });
    const deleting = await pool.connect();
    try {
      await deleting.query('BEGIN');
      await deleting.query(`SELECT set_config('app.user_id', $1, true)`, [fixtures.adminA.userId]);
      await deleting.query('SELECT public.delete_station($1, $2)', [postres, ids.Cocina]);
      const order = as(fixtures.waiterA.email).post('/api/orders', { tableId: v.t2, orderType: 'dine_in', items: [{ dishId: v.lulo, quantity: 1 }] }).then((res) => res);
      const cmd = as(fixtures.waiterA.email).post('/api/print/commands', { orderId, items: [{ id: `${v.lulo}-9`, name: 'Lulo', quantity: 1 }], waiter: 'W', table: 31 }).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await deleting.query('COMMIT');
      const [o, c] = await Promise.all([order, cmd]);
      expect([o.status, o.body.code], JSON.stringify(o.body)).toEqual([201, undefined]);
      expect(o.body.items.map((i: { stationId: string }) => i.stationId)).toEqual([ids.Cocina]);
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const stored = await db<{ station_id: string; name: string }>(`SELECT station_id, payload->'station'->>'name' AS name FROM print_jobs`);
      expect(stored).toEqual([{ station_id: ids.Cocina, name: 'Cocina' }]);
    } finally {
      deleting.release();
      await pool.end();
    }
  });
});
