import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** F6: lines stored with their station, one comanda per station, kitchen filter, printing on/off. */
const r = {
  mains: 'f6300000-0000-0000-0000-000000000001',
  drinks: 'f6300000-0000-0000-0000-000000000002',
  specials: 'f6300000-0000-0000-0000-000000000003',
  bandeja: 'f6400000-0000-0000-0000-000000000001',
  lulo: 'f6400000-0000-0000-0000-000000000002',
  limonada: 'f6400000-0000-0000-0000-000000000003',
  lechona: 'f6400000-0000-0000-0000-000000000004',
  dishB: 'f6400000-0000-0000-0000-0000000000b1',
  t1: 'f6500000-0000-0000-0000-000000000001',
  t2: 'f6500000-0000-0000-0000-000000000002',
} as const;

/** Today's command body; cart ids start with the dish id (lib/menu/cart-dish-id). */
const command = (items: { id: string; name: string; quantity: number }[]) => ({ items, waiter: 'Waiter A', table: 8 });
const cartId = (dishId: string) => `${dishId}-1700000000000`;

describe('station routing of orders, comandas and the kitchen (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let ids: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    const q = (text: string, values: unknown[]) => superuserQuery(database.superuserUrl, text, values);
    const A = fixtures.restaurantA;
    await q(
      `INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Platos fuertes', 'beef', $4), ($2, 'Bebidas', 'water', $4), ($3, 'Especiales', 'star', $4)`,
      [r.mains, r.drinks, r.specials, A],
    );
    await q(
      `INSERT INTO dishes (id, name, price, category_id, restaurant_id) VALUES
         ($1, 'Bandeja paisa', 30000, $5, $8), ($2, 'Jugo de lulo', 8000, $6, $8), ($3, 'Limonada de coco', 9000, $6, $8),
         ($4, 'Lechona', 25000, $7, $8), ($9, 'Gaseosa', 5000, NULL, $10)`,
      [r.bandeja, r.lulo, r.limonada, r.lechona, r.mains, r.drinks, r.specials, A, r.dishB, fixtures.restaurantB],
    );
    await q(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, 8, 'available', $3), ($2, 9, 'available', $3)`, [r.t1, r.t2, A]);
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

  const as = (user: { email: string }) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[user.email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA);
  const waiterA = () => as(fixtures.waiterA);
  const adminB = () => as(fixtures.adminB);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const jobs = (restaurantId: string) =>
    db<{ id: string; kind: string; payload: Record<string, unknown>; station_id: string | null }>(
      'SELECT id, kind, payload, station_id FROM print_jobs WHERE restaurant_id = $1 ORDER BY created_at, id',
      [restaurantId],
    );

  it('without stations a comanda is exactly the single legacy job', async () => {
    const body = command([{ id: cartId(r.bandeja), name: 'Bandeja paisa', quantity: 2 }]);
    const res = await waiterA().post('/api/print/commands', body);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id', 'kind']);
    const stored = await jobs(fixtures.restaurantA);
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).toEqual({ invoiceNumber: res.body.id, ...body });
    expect(stored[0].station_id).toBeNull();
    expect((await adminA().get('/api/config')).body.printingEnabled).toBe(true);
  });

  it('routes each new line: dish exception, then category, then the default station', async () => {
    ids = Object.fromEntries((await adminA().post('/api/stations/starter')).body.map((st: { name: string; id: string }) => [st.name, st.id]));
    await adminA().put(`/api/stations/routes/categories/${r.mains}`, { stationId: ids.Cocina });
    await adminA().put(`/api/stations/routes/categories/${r.drinks}`, { stationId: ids.Barra });
    await adminA().put(`/api/stations/routes/dishes/${r.limonada}`, { stationId: ids.Cocina });
    const res = await waiterA().post('/api/orders', {
      tableId: r.t1,
      orderType: 'dine_in',
      items: [r.bandeja, r.lulo, r.limonada, r.lechona].map((dishId) => ({ dishId, quantity: 1 })),
    });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i: { name: string; stationId: string; stationSource: string }) => [i.name, i.stationId, i.stationSource])).toEqual([
      ['Bandeja paisa', ids.Cocina, 'category'],
      ['Jugo de lulo', ids.Barra, 'category'],
      ['Limonada de coco', ids.Cocina, 'dish'],
      ['Lechona', ids.Cocina, 'fallback'],
    ]);
    const added = await waiterA().post(`/api/orders/${res.body.id}/items`, { items: [{ dishId: r.lulo, quantity: 2 }] });
    expect(added.body.items.at(-1)).toMatchObject({ name: 'Jugo de lulo', stationId: ids.Barra, stationSource: 'category' });
  });

  it('filters the kitchen orders by station', async () => {
    const res = await waiterA().get(`/api/orders?status=kitchen&stationId=${ids.Barra}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].items.map((i: { name: string }) => i.name)).toEqual(['Jugo de lulo', 'Jugo de lulo']);
    expect((await waiterA().get(`/api/orders?status=kitchen&stationId=${ids.Caja}`)).body).toEqual([]);
    expect((await adminB().get(`/api/orders?stationId=${ids.Barra}`)).body).toEqual([]);
    expect((await waiterA().get('/api/orders?stationId=nope')).status).toBe(422);
  });

  it('splits a comanda into one job per station with only its lines', async () => {
    await db('DELETE FROM print_jobs');
    const items = [
      { id: cartId(r.bandeja), name: 'Bandeja paisa', quantity: 2 },
      { id: cartId(r.lulo), name: 'Jugo de lulo', quantity: 2 },
      { id: cartId(r.limonada), name: 'Limonada de coco', quantity: 1 },
    ];
    const res = await waiterA().post('/api/print/commands', command(items));
    expect(res.status).toBe(201);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.id).toBe(res.body.jobs[0].id);
    const stored = await jobs(fixtures.restaurantA);
    expect(stored.map((j) => [j.station_id, (j.payload.station as { name: string }).name, (j.payload.items as { name: string }[]).map((i) => i.name)])).toEqual([
      [ids.Cocina, 'Cocina', ['Bandeja paisa', 'Limonada de coco']],
      [ids.Barra, 'Barra', ['Jugo de lulo']],
    ]);
    for (const job of stored) {
      expect(job.payload).toMatchObject({ invoiceNumber: job.id, waiter: 'Waiter A', table: 8, station: { id: job.station_id } });
    }
  });

  it('sends a line without a dish to the default station and tags facturas to Caja', async () => {
    await db('DELETE FROM print_jobs');
    await waiterA().post('/api/print/commands', command([{ id: 'custom-1', name: 'Fuera de carta', quantity: 1 }]));
    const invoice = { invoice: { invoiceNumber: 'F-1' }, displayItems: [] };
    expect((await waiterA().post('/api/print/invoices', invoice)).status).toBe(201);
    const stored = await jobs(fixtures.restaurantA);
    expect(stored.map((j) => [j.kind, j.station_id])).toEqual([['command', ids.Cocina], ['invoice', ids.Caja]]);
    expect(stored[1].payload).toEqual({ invoiceNumber: 'F-1', ...invoice, station: { id: ids.Caja, name: 'Caja' } });
  });

  it('keeps the legacy invoice payload for a restaurant without stations', async () => {
    const invoice = { invoice: { invoiceNumber: 'B-1' }, displayItems: [] };
    expect((await adminB().post('/api/print/invoices', invoice)).status).toBe(201);
    const stored = await jobs(fixtures.restaurantB);
    expect(stored.map((j) => [j.payload, j.station_id])).toEqual([[{ invoiceNumber: 'B-1', ...invoice }, null]]);
  });

  it('queues nothing when the restaurant turns printing off', async () => {
    await db('DELETE FROM print_jobs');
    const off = await adminA().put('/api/config', { printingEnabled: false });
    expect(off.body.printingEnabled).toBe(false);
    const res = await waiterA().post('/api/print/commands', command([{ id: cartId(r.lulo), name: 'Jugo de lulo', quantity: 1 }]));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'printing_disabled', message: 'Este restaurante no usa impresoras' });
    expect((await waiterA().post('/api/print/invoices', { invoice: { invoiceNumber: 'F-2' }, displayItems: [] })).status).toBe(409);
    expect(await jobs(fixtures.restaurantA)).toEqual([]);
    expect((await waiterA().put('/api/config', { printingEnabled: true })).status).toBe(403);
  });
});
