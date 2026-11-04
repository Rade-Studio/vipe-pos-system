import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

interface ChangeEvent {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  errors: null;
}

interface Client {
  socket: Socket;
  changes: ChangeEvent[];
  resyncs: number;
}

const ORDER_ID = '60000000-0000-0000-0000-000000000001';
const TABLE_ID = '60000000-0000-0000-0000-000000000002';

/** Poll until `check` holds or fail after `timeoutMs`. */
async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

describe('realtime gateway and listener (Testcontainers, vipe_api)', () => {
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

  const loginCookie = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
    return cookiePair(setCookies(res).vipe_access);
  };

  const open = (cookie?: string, headers: Record<string, string> = {}): Socket => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: cookie ? { ...headers, Cookie: cookie } : headers,
    });
    sockets.push(socket);
    return socket;
  };

  /** Connect and wait for `ready`, i.e. the socket has joined its restaurant room. */
  const connect = async (email: string): Promise<Client & { ready: { restaurantId: string } }> => {
    const socket = open(await loginCookie(email));
    const client: Client = { socket, changes: [], resyncs: 0 };
    socket.on('pos_changes', (event: ChangeEvent) => client.changes.push(event));
    socket.on('resync', () => {
      client.resyncs += 1;
    });
    const ready = await new Promise<{ restaurantId: string }>((resolve, reject) => {
      socket.once('ready', resolve);
      socket.once('connect_error', reject);
    });
    return Object.assign(client, { ready });
  };

  it('fans INSERT, UPDATE and DELETE of an order out to its restaurant only, in the Supabase shape', async () => {
    const a = await connect(fixtures.adminA.email);
    const b = await connect(fixtures.adminB.email);
    expect(a.ready).toEqual({ restaurantId: fixtures.restaurantA });
    expect(b.ready).toEqual({ restaurantId: fixtures.restaurantB });

    await superuserQuery(
      database.superuserUrl,
      `INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id)
       VALUES ($1, 'active', 10, 0, 0, 10, $2)`,
      [ORDER_ID, fixtures.restaurantA],
    );
    await superuserQuery(database.superuserUrl, "UPDATE public.orders SET status = 'kitchen' WHERE id = $1", [ORDER_ID]);
    await superuserQuery(database.superuserUrl, 'DELETE FROM public.orders WHERE id = $1', [ORDER_ID]);

    await eventually(() => a.changes.length >= 3);
    await settle();
    expect(a.changes).toHaveLength(3);
    expect(b.changes).toHaveLength(0);

    const [insert, update, remove] = a.changes;
    for (const event of a.changes) {
      expect(Object.keys(event).sort()).toEqual(['commit_timestamp', 'errors', 'eventType', 'new', 'old', 'schema', 'table']);
      expect(event.schema).toBe('public');
      expect(event.table).toBe('orders');
      expect(event.errors).toBeNull();
      expect(new Date(event.commit_timestamp).toISOString()).toBe(event.commit_timestamp);
    }

    expect(insert.eventType).toBe('INSERT');
    expect(insert.new).toMatchObject({ id: ORDER_ID, restaurant_id: fixtures.restaurantA, status: 'active', order_type: 'dine_in' });
    expect(insert.old).toEqual({});

    expect(update.eventType).toBe('UPDATE');
    expect(update.new).toMatchObject({ id: ORDER_ID, status: 'kitchen' });
    // REPLICA IDENTITY FULL parity: the full previous row.
    expect(update.old).toMatchObject({ id: ORDER_ID, restaurant_id: fixtures.restaurantA, status: 'active', order_type: 'dine_in' });
    expect(Object.keys(update.old).sort()).toEqual(Object.keys(update.new).sort());

    expect(remove.eventType).toBe('DELETE');
    expect(remove.new).toEqual({});
    expect(remove.old).toMatchObject({ id: ORDER_ID, restaurant_id: fixtures.restaurantA, status: 'kitchen', order_type: 'dine_in' });

    a.socket.close();
    b.socket.close();
  });

  it('fans out tables changes with their natural columns', async () => {
    const a = await connect(fixtures.adminA.email);
    await superuserQuery(
      database.superuserUrl,
      "INSERT INTO public.tables (id, number, status, restaurant_id) VALUES ($1, 61, 'available', $2)",
      [TABLE_ID, fixtures.restaurantA],
    );
    await eventually(() => a.changes.length >= 1);
    expect(a.changes[0]).toMatchObject({
      schema: 'public',
      table: 'tables',
      eventType: 'INSERT',
      new: { id: TABLE_ID, number: 61, status: 'available', restaurant_id: fixtures.restaurantA },
      old: {},
      errors: null,
    });
    a.socket.close();
  });

  it('sends nothing for a rolled-back change', async () => {
    const a = await connect(fixtures.adminA.email);
    await superuserQuery(
      database.superuserUrl,
      `DO $$ BEGIN
         INSERT INTO public.tables (number, status, restaurant_id) VALUES (62, 'available', '${fixtures.restaurantA}');
         RAISE EXCEPTION 'rollback probe';
       END $$`,
    ).catch(() => undefined);
    await settle();
    expect(a.changes).toHaveLength(0);
    a.socket.close();
  });

  it('refuses a socket without a valid access cookie or with a revoked session', async () => {
    const revoked = await loginCookie(fixtures.waiterA.email);
    expect((await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', revoked)).status).toBe(204);
    for (const cookie of [undefined, 'vipe_access=not-a-jwt', revoked]) {
      const socket = open(cookie);
      const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      expect(error.message).toBe('unauthorized');
      expect(socket.connected).toBe(false);
    }
  });

  it('reconnects the listener after its backend is terminated and sends one resync', async () => {
    const a = await connect(fixtures.adminA.email);
    const killed = await superuserQuery<{ n: number }>(
      database.superuserUrl,
      "SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity WHERE application_name = 'vipe-realtime-listener'",
    );
    expect(killed[0].n).toBe(1);

    await eventually(() => a.resyncs >= 1, 10_000);
    await settle();
    expect(a.resyncs).toBe(1);
    const listeners = await superuserQuery<{ n: number }>(
      database.superuserUrl,
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename = 'vipe_api' AND (application_name = 'vipe-realtime-listener' OR query ILIKE 'LISTEN%')`,
    );
    expect(listeners[0].n).toBe(1);

    // The new listener connection delivers changes again.
    await superuserQuery(database.superuserUrl, "UPDATE public.tables SET status = 'occupied' WHERE id = $1", [TABLE_ID]);
    await eventually(() => a.changes.length >= 1);
    expect(a.changes[0]).toMatchObject({ table: 'tables', eventType: 'UPDATE', new: { id: TABLE_ID, status: 'occupied' } });
    expect(a.changes[0].old).toMatchObject({ id: TABLE_ID, status: 'available' });
    a.socket.close();
  });

  it('fans out the DELETE of an order_deliveries row when its order is deleted', async () => {
    const a = await connect(fixtures.adminA.email);
    const orderId = '60000000-0000-0000-0000-000000000003';
    await superuserQuery(
      database.superuserUrl,
      `WITH c AS (
         INSERT INTO public.customers (id, restaurant_id, phone, name)
         VALUES ('60000000-0000-0000-0000-000000000021', $2, '3001234567', 'Cliente') RETURNING id
       ), o AS (
         INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, order_type)
         VALUES ($1, 'active', 10, 0, 0, 10, $2, 'delivery') RETURNING id
       )
       INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line)
       SELECT o.id, $2, c.id, 'Cliente', '3001234567', 'Calle 1' FROM o, c`,
      [orderId, fixtures.restaurantA],
    );
    await superuserQuery(database.superuserUrl, 'DELETE FROM public.orders WHERE id = $1', [orderId]);
    await eventually(() => a.changes.some((e) => e.table === 'order_deliveries' && e.eventType === 'DELETE'));
    const remove = a.changes.find((e) => e.table === 'order_deliveries' && e.eventType === 'DELETE');
    expect(remove).toMatchObject({ schema: 'public', new: {}, errors: null });
    expect(remove?.old).toMatchObject({ order_id: orderId, restaurant_id: fixtures.restaurantA, customer_name: 'Cliente' });
    const rows = await superuserQuery(database.superuserUrl, 'SELECT 1 FROM public.order_deliveries WHERE order_id = $1', [orderId]);
    expect(rows).toHaveLength(0);
    a.socket.close();
  });

  it("drops forged notices that route a row to another restaurant's room", async () => {
    const b = await connect(fixtures.adminB.email);
    const [orderA] = await superuserQuery<{ id: string }>(
      database.superuserUrl,
      'SELECT id FROM public.orders WHERE restaurant_id = $1 LIMIT 1',
      [fixtures.restaurantA],
    );
    const forge = (notice: object) =>
      superuserQuery(database.superuserUrl, "SELECT pg_notify('pos_changes', $1)", [JSON.stringify(notice)]);
    await forge({ table: 'orders', op: 'UPDATE', id: orderA.id, restaurant_id: fixtures.restaurantB });
    await forge({
      table: 'orders',
      op: 'DELETE',
      id: orderA.id,
      restaurant_id: fixtures.restaurantB,
      old: { id: orderA.id, restaurant_id: fixtures.restaurantA, total: 10 },
    });
    await settle();
    expect(b.changes).toHaveLength(0);
    b.socket.close();
  });

  it('refuses a socket whose Origin is not the web origin and admits the web origin', async () => {
    const cookie = await loginCookie(fixtures.adminA.email);
    const foreign = open(cookie, { Origin: 'http://evil.test' });
    await new Promise((resolve) => foreign.once('connect_error', resolve));
    expect(foreign.connected).toBe(false);

    const web = open(cookie, { Origin: 'http://localhost:3000' });
    await new Promise((resolve, reject) => {
      web.once('ready', resolve);
      web.once('connect_error', reject);
    });
    web.close();
  });
});
