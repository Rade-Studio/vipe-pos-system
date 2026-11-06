import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

interface ChangeEvent {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

const ORDER_ID = '68000000-0000-0000-0000-000000000001';
const ITEM_1 = '68000000-0000-0000-0000-000000000011';
const ITEM_2 = '68000000-0000-0000-0000-000000000012';
const TABLE_ID = '68000000-0000-0000-0000-000000000002';

async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** T8a step 5: server-side enrichment replaces the clients' per-event reads. */
describe('realtime enrichment for orders, order_items and tables (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/realtime`.replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app?.close();
    await database?.stop();
  });

  const db = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);

  const connect = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookiePair(setCookies(res).vipe_access) },
    });
    sockets.push(socket);
    const changes: ChangeEvent[] = [];
    socket.on('pos_changes', (event: ChangeEvent) => changes.push(event));
    await new Promise((resolve, reject) => {
      socket.once('ready', resolve);
      socket.once('connect_error', reject);
    });
    return { socket, changes };
  };

  it('an order INSERT carries new.order_items, loaded once on the server', async () => {
    const a = await connect(fixtures.adminA.email);
    const b = await connect(fixtures.adminB.email);
    await db(
      `WITH o AS (
         INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, guests, notes, restaurant_id)
         VALUES ($1, 'kitchen', 0, 0, 0, 0, 4, 'sin picante', $4) RETURNING id)
       INSERT INTO public.order_items (id, order_id, name, price, quantity, restaurant_id, added_at)
       SELECT $2::uuid, id, 'Arepa', 5000, 2, $4, now() FROM o
       UNION ALL SELECT $3::uuid, id, 'Jugo', 3000, 1, $4, now() + interval '1 second' FROM o`,
      [ORDER_ID, ITEM_1, ITEM_2, fixtures.restaurantA],
    );
    await eventually(() => a.changes.length >= 3);
    const insert = a.changes.find((event) => event.table === 'orders');
    expect(insert?.eventType).toBe('INSERT');
    expect(insert?.new).toMatchObject({ id: ORDER_ID, status: 'kitchen', guests: 4, notes: 'sin picante', order_number: expect.any(Number) });
    const items = insert?.new.order_items as Array<Record<string, unknown>>;
    expect(items.map((item) => [item.id, item.name, item.status, item.order_id])).toEqual([
      [ITEM_1, 'Arepa', 'kitchen', ORDER_ID],
      [ITEM_2, 'Jugo', 'kitchen', ORDER_ID],
    ]);
    expect(a.changes.filter((event) => event.table === 'order_items').map((event) => [event.eventType, event.new.id]))
      .toEqual([['INSERT', ITEM_1], ['INSERT', ITEM_2]]);
    expect(b.changes).toHaveLength(0);
    a.socket.close();
    b.socket.close();
  });

  it('an order_items UPDATE carries the full old row, so old.status is the previous status', async () => {
    const a = await connect(fixtures.adminA.email);
    await db("UPDATE public.order_items SET status = 'served' WHERE id = $1", [ITEM_1]);
    await eventually(() => a.changes.length >= 1);
    const [update] = a.changes;
    expect(update).toMatchObject({ table: 'order_items', eventType: 'UPDATE' });
    expect(update.new).toMatchObject({ id: ITEM_1, status: 'served', order_id: ORDER_ID });
    expect(update.old).toMatchObject({ id: ITEM_1, status: 'kitchen', order_id: ORDER_ID, name: 'Arepa' });
    a.socket.close();
  });

  it('an order UPDATE carries the current items; a DELETE carries none', async () => {
    const a = await connect(fixtures.adminA.email);
    await db("UPDATE public.orders SET status = 'delivered', guests = 2, notes = NULL WHERE id = $1", [ORDER_ID]);
    await eventually(() => a.changes.length >= 1);
    const [update] = a.changes;
    expect(update).toMatchObject({ table: 'orders', eventType: 'UPDATE' });
    expect(update.new).toMatchObject({ guests: 2, notes: null, order_number: expect.any(Number) });
    expect(update.old).toMatchObject({ guests: 4, notes: 'sin picante' });
    expect((update.new.order_items as Array<{ status: string }>).map((item) => item.status)).toEqual(['served', 'kitchen']);
    expect(update.old).not.toHaveProperty('order_items');

    await db('DELETE FROM public.orders WHERE id = $1', [ORDER_ID]);
    await eventually(() => a.changes.some((event) => event.table === 'orders' && event.eventType === 'DELETE'));
    const remove = a.changes.find((event) => event.table === 'orders' && event.eventType === 'DELETE');
    expect(remove?.new).toEqual({});
    // The cascade deletes the items: their DELETE events carry the full old row.
    const itemDeletes = () => a.changes.filter((event) => event.table === 'order_items' && event.eventType === 'DELETE');
    await eventually(() => itemDeletes().length >= 2);
    expect(itemDeletes().map((event) => [event.old.id, event.old.status])).toEqual(
      expect.arrayContaining([[ITEM_1, 'served'], [ITEM_2, 'kitchen']]),
    );
    a.socket.close();
  });

  it('POST /orders through the API emits an orders INSERT carrying order_items', async () => {
    const dish = '68000000-0000-0000-0000-000000000031';
    const table = '68000000-0000-0000-0000-000000000032';
    await db("INSERT INTO public.dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa API', 4000, true, $2)", [
      dish,
      fixtures.restaurantA,
    ]);
    await db("INSERT INTO public.tables (id, number, status, restaurant_id) VALUES ($1, 69, 'available', $2)", [
      table,
      fixtures.restaurantA,
    ]);
    const a = await connect(fixtures.adminA.email);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: fixtures.waiterA.email, password: PASSWORD });
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', cookiePair(setCookies(login).vipe_access))
      .send({ tableId: table, items: [{ dishId: dish, quantity: 2 }] });
    expect(res.status).toBe(201);
    await eventually(() => a.changes.some((event) => event.table === 'orders' && event.eventType === 'INSERT'));
    const insert = a.changes.find((event) => event.table === 'orders' && event.eventType === 'INSERT');
    // NOTIFY is delivered at COMMIT, after the items, so the loaded order already has them.
    expect(insert?.new.id).toBe(res.body.id);
    expect((insert?.new.order_items as Array<Record<string, unknown>>).map((item) => [item.name, item.quantity, item.price]))
      .toEqual([['Arepa API', 2, 4000]]);
    a.socket.close();
  });

  it('a table UPDATE carries new.waiter_name; null without a waiter', async () => {
    const a = await connect(fixtures.adminA.email);
    await db("INSERT INTO public.tables (id, number, status, restaurant_id) VALUES ($1, 68, 'available', $2)", [
      TABLE_ID,
      fixtures.restaurantA,
    ]);
    await db("UPDATE public.tables SET status = 'occupied', waiter_id = $2 WHERE id = $1", [
      TABLE_ID,
      fixtures.waiterA.profileId,
    ]);
    await eventually(() => a.changes.length >= 2);
    const [insert, update] = a.changes;
    expect(insert).toMatchObject({ table: 'tables', eventType: 'INSERT' });
    expect(insert.new).toMatchObject({ id: TABLE_ID, waiter_id: null, waiter_name: null });
    expect(update).toMatchObject({ table: 'tables', eventType: 'UPDATE' });
    expect(update.new).toMatchObject({ id: TABLE_ID, status: 'occupied', waiter_id: fixtures.waiterA.profileId, waiter_name: 'Waiter A' });
    expect(update.old).toMatchObject({ status: 'available', waiter_id: null });
    a.socket.close();
  });
});
