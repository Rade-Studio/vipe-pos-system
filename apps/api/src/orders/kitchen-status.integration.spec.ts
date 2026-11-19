/**
 * H-057 (odd/tasks/qa-noviembre-2026.md T14, S4): the kitchen marks each line
 * "en preparación" or "listo" and the waiter sees it on the table through the
 * existing realtime, with no notice. POST /orders/:id/items/kitchen-status sets
 * order_items.kitchen_status; the lifecycle status (kitchen -> served) and
 * POST /orders/:id/items/served keep their meaning.
 */
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const k = {
  cookUser: '10000000-0000-0000-0000-0000000005c1',
  cookProfile: '20000000-0000-0000-0000-0000000005c1',
  cookEmail: 'cook57@a.test',
  sopa: 'd5700000-0000-0000-0000-000000000001',
  jugo: 'd5700000-0000-0000-0000-000000000002',
  t1: 'f5700000-0000-0000-0000-000000000001',
  t2: 'f5700000-0000-0000-0000-000000000002',
  t3: 'f5700000-0000-0000-0000-000000000003',
  legacyOrder: '85700000-0000-0000-0000-000000000001',
  legacyItem: '85700000-0000-0000-0000-000000000011',
  paidOrder: '85700000-0000-0000-0000-000000000002',
  paidItem: '85700000-0000-0000-0000-000000000012',
} as const;

interface ChangeEvent {
  table: string;
  eventType: string;
  new: Record<string, unknown>;
}

type Line = { id: string; name: string; status: string; kitchenStatus: string };

describe('kitchen status of order lines (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let url: string;
  const cookies: Record<string, string> = {};
  const sockets: Socket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    const q = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);
    const A = fixtures.restaurantA;
    await q(`INSERT INTO users (id, email, password_hash) SELECT $1, $2, password_hash FROM users WHERE id = $3`, [
      k.cookUser,
      k.cookEmail,
      fixtures.adminA.userId,
    ]);
    await q(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cocina 57', $3, 'kitchen', $4)`, [
      k.cookProfile,
      k.cookUser,
      k.cookEmail,
      A,
    ]);
    await q(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Sopa', 8000, true, $3), ($2, 'Jugo', 3000, true, $3)`, [
      k.sopa,
      k.jugo,
      A,
    ]);
    await q(
      `INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, 571, 'available', $4), ($2, 572, 'available', $4), ($3, 573, 'kitchen', $4)`,
      [k.t1, k.t2, k.t3, A],
    );
    // Written the old way: no kitchen_status, as every line before 0045.
    await q(
      `INSERT INTO orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
         ($1, $3, $4, 'kitchen', 8000, 0, 0, 8000, $5), ($2, NULL, $4, 'paid', 3000, 0, 0, 3000, $5)`,
      [k.legacyOrder, k.paidOrder, k.t3, fixtures.waiterA.profileId, A],
    );
    await q(
      `INSERT INTO order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES
         ($1, $2, $5, 'Sopa', 8000, 1, 'kitchen', $7), ($3, $4, $6, 'Jugo', 3000, 1, 'kitchen', $7)`,
      [k.legacyItem, k.legacyOrder, k.paidItem, k.paidOrder, k.sopa, k.jugo, A],
    );
    app = await createTestApp(database.apiUrl);
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/realtime`.replace('[::1]', '127.0.0.1');
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, k.cookEmail]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app?.close();
    await database?.stop();
  });

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    return {
      get: (path: string) => server.get(path).set('Cookie', cookies[email]),
      post: (path: string, body?: object) => server.post(path).set('Cookie', cookies[email]).send(body),
    };
  };
  const cook = () => as(k.cookEmail);
  const waiter = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const lines = (orderId: string) =>
    db<{ id: string; name: string; status: string; kitchen_status: string }>(
      'SELECT id, name, status, kitchen_status FROM order_items WHERE order_id = $1 ORDER BY name',
      [orderId],
    );
  const orderRow = async (id: string) =>
    (await db<{ status: string; updated_at: Date }>('SELECT status, updated_at FROM orders WHERE id = $1', [id]))[0];
  const tableStatus = async (id: string) => (await db<{ status: string }>('SELECT status FROM tables WHERE id = $1', [id]))[0].status;

  const newOrder = async (tableId: string) => {
    const res = await waiter().post('/api/orders', {
      tableId,
      items: [
        { dishId: k.sopa, quantity: 1, unitPrice: 8000 },
        { dishId: k.jugo, quantity: 1, unitPrice: 3000 },
      ],
    });
    expect(res.status).toBe(201);
    const items = res.body.items as Line[];
    return { id: String(res.body.id), sopa: items.find((i) => i.name === 'Sopa')!.id, jugo: items.find((i) => i.name === 'Jugo')!.id };
  };
  const mark = (orderId: string, body: object) => cook().post(`/api/orders/${orderId}/items/kitchen-status`, body);

  it('a new line starts pending; an existing line without the column reads pending too', async () => {
    const order = await newOrder(k.t1);
    const read = await waiter().get(`/api/orders/${order.id}`);
    expect(read.status).toBe(200);
    expect((read.body.items as Line[]).map(({ name, status, kitchenStatus }) => ({ name, status, kitchenStatus }))).toEqual([
      { name: 'Sopa', status: 'kitchen', kitchenStatus: 'pending' },
      { name: 'Jugo', status: 'kitchen', kitchenStatus: 'pending' },
    ]);
    const legacy = await waiter().get(`/api/orders/${k.legacyOrder}`);
    expect(legacy.body.items).toEqual([expect.objectContaining({ id: k.legacyItem, status: 'kitchen', kitchenStatus: 'pending' })]);
  });

  it('the kitchen marks lines preparing then ready; the order, the table and the lifecycle status stay in kitchen', async () => {
    const [{ id }] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [k.t1]);
    const [, sopa] = await lines(id);
    const preparing = await mark(id, { itemIds: [sopa.id], kitchenStatus: 'preparing' });
    expect(preparing.status).toBe(200);
    expect(preparing.body.status).toBe('kitchen');
    expect((preparing.body.items as Line[]).map(({ name, status, kitchenStatus }) => `${name}:${status}:${kitchenStatus}`)).toEqual([
      'Sopa:kitchen:preparing',
      'Jugo:kitchen:pending',
    ]);
    const ready = await mark(id, { itemIds: [sopa.id], kitchenStatus: 'ready' });
    expect(ready.status).toBe(200);
    expect((await lines(id)).map((l) => `${l.name}:${l.status}:${l.kitchen_status}`)).toEqual(['Jugo:kitchen:pending', 'Sopa:kitchen:ready']);
    expect((await orderRow(id)).status).toBe('kitchen');
    expect(await tableStatus(k.t1)).toBe('kitchen');
    // The kitchen may step back (a wrong tap).
    expect((await mark(id, { itemIds: [sopa.id], kitchenStatus: 'preparing' })).status).toBe(200);
    expect((await mark(id, { itemIds: [sopa.id], kitchenStatus: 'ready' })).status).toBe(200);
  });

  it('serving keeps the old transition, from a ready line and from a pending one', async () => {
    const [{ id }] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [k.t1]);
    const [jugo, sopa] = await lines(id);
    const first = await cook().post(`/api/orders/${id}/items/served`, { itemIds: [sopa.id] });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('kitchen');
    const last = await cook().post(`/api/orders/${id}/items/served`, { itemIds: [jugo.id] });
    expect(last.status).toBe(200);
    expect(last.body.status).toBe('delivered');
    expect((last.body.items as Line[]).map((l) => l.status)).toEqual(['served', 'served']);
    expect(await tableStatus(k.t1)).toBe('served');
  });

  it('refuses a served line (409), an unknown step (422), an unknown line (422) and a closed order (409), changing nothing', async () => {
    const [{ id }] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [k.t1]);
    const before = await lines(id);
    const served = await mark(id, { itemIds: [before[0].id], kitchenStatus: 'preparing' });
    expect(served.status).toBe(409);
    expect(served.body.message).toBe('Item is not in kitchen');
    const fresh = await newOrder(k.t2);
    const freshBefore = await lines(fresh.id);
    for (const kitchenStatus of ['served', 'kitchen', '', undefined]) {
      expect((await mark(fresh.id, { itemIds: [fresh.sopa], kitchenStatus })).status).toBe(422);
    }
    expect((await mark(fresh.id, { itemIds: [], kitchenStatus: 'ready' })).status).toBe(422);
    const unknown = await mark(fresh.id, { itemIds: [k.legacyItem], kitchenStatus: 'ready' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.message).toBe('Unknown item');
    const closed = await mark(k.paidOrder, { itemIds: [k.paidItem], kitchenStatus: 'ready' });
    expect(closed.status).toBe(409);
    expect(closed.body.message).toBe('Order is closed');
    expect(await lines(id)).toEqual(before);
    expect(await lines(fresh.id)).toEqual(freshBefore);
    expect((await db('SELECT kitchen_status FROM order_items WHERE id = $1', [k.paidItem]))[0]).toEqual({ kitchen_status: 'pending' });
  });

  it('only admin and kitchen mark lines; another restaurant gets 404', async () => {
    const [{ id }] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [k.t2]);
    const [, sopa] = await lines(id);
    expect((await waiter().post(`/api/orders/${id}/items/kitchen-status`, { itemIds: [sopa.id], kitchenStatus: 'ready' })).status).toBe(403);
    expect(
      (await as(fixtures.adminB.email).post(`/api/orders/${id}/items/kitchen-status`, { itemIds: [sopa.id], kitchenStatus: 'ready' })).status,
    ).toBe(404);
    expect((await lines(id)).map((l) => l.kitchen_status)).toEqual(['pending', 'pending']);
    const admin = await as(fixtures.adminA.email).post(`/api/orders/${id}/items/kitchen-status`, { itemIds: [sopa.id], kitchenStatus: 'preparing' });
    expect(admin.status).toBe(200);
  });

  it('the waiter gets the new step as an orders UPDATE with its lines (the existing realtime, no other event)', async () => {
    const [{ id }] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [k.t2]);
    const [jugo] = await lines(id);
    const socket = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: cookies[fixtures.waiterA.email] } });
    sockets.push(socket);
    const changes: ChangeEvent[] = [];
    socket.on('pos_changes', (event: ChangeEvent) => changes.push(event));
    await new Promise((resolve, reject) => {
      socket.once('ready', resolve);
      socket.once('connect_error', reject);
    });
    expect((await mark(id, { itemIds: [jugo.id], kitchenStatus: 'ready' })).status).toBe(200);
    const deadline = Date.now() + 5_000;
    const orderUpdate = () => changes.find((c) => c.table === 'orders' && c.eventType === 'UPDATE' && c.new.id === id);
    while (!orderUpdate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const update = orderUpdate();
    expect(update).toBeDefined();
    expect(update!.new.status).toBe('kitchen');
    expect((update!.new.order_items as { id: string; kitchen_status: string }[]).find((l) => l.id === jugo.id)?.kitchen_status).toBe('ready');
    expect(new Set(changes.map((c) => c.table))).toEqual(new Set(['orders', 'order_items']));
    socket.close();
  });
});
