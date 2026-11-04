import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokensService } from '../auth/tokens.service';
import { DbClient } from '../db/db-client';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';
import type { ChangeEvent } from './change-event';
import { type ChangeSink, PgListenerService } from './pg-listener.service';

/** Regression probes from the T6 independent verification. */

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

describe('realtime regression probes (Testcontainers, vipe_api)', () => {
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

  const su = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);

  const loginCookie = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
    return cookiePair(setCookies(res).vipe_access);
  };

  const open = (cookie: string | undefined, query: Record<string, string> = {}): Socket => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      query,
      extraHeaders: cookie ? { Cookie: cookie } : {},
    });
    sockets.push(socket);
    return socket;
  };

  const connect = async (cookie: string, query: Record<string, string> = {}) => {
    const socket = open(cookie, query);
    const changes: ChangeEvent[] = [];
    socket.on('pos_changes', (event: ChangeEvent) => changes.push(event));
    await new Promise((resolve, reject) => {
      socket.once('ready', resolve);
      socket.once('connect_error', reject);
    });
    return { socket, changes };
  };

  const refused = async (cookie: string) => {
    const socket = open(cookie);
    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
  };

  const liveSession = async (userId: string) => {
    const [row] = await su<{ id: string }>(
      "INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id",
      [userId, randomUUID()],
    );
    return row.id;
  };

  it('delivers a truncated old (id, restaurant_id, order_type) for a 7481-byte items_json', async () => {
    const a = await connect(await loginCookie(fixtures.adminA.email));
    const id = randomUUID();
    await su(
      `INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, items_json)
       VALUES ($1, 'active', 10, 0, 0, 10, $2, to_jsonb(repeat('x', 7481)))`,
      [id, fixtures.restaurantA],
    );
    await su("UPDATE public.orders SET status = 'kitchen' WHERE id = $1", [id]);
    await eventually(() => a.changes.some((e) => e.eventType === 'UPDATE'));
    const update = a.changes.find((e) => e.eventType === 'UPDATE');
    expect(update?.old).toEqual({ id, restaurant_id: fixtures.restaurantA, order_type: 'dine_in' });
    expect(update?.new).toMatchObject({ id, status: 'kitchen', items_json: 'x'.repeat(7481) });
    a.socket.close();
  });

  it('refuses an inactive profile, a session without profile, a foreign key and another user\'s sid', async () => {
    const tokens = app.get(TokensService);

    const inactiveUser = randomUUID();
    await su("INSERT INTO public.users (id, email, password_hash) VALUES ($1, 'off@a.test', 'h')", [inactiveUser]);
    await su(
      "INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id, active) VALUES ($1, $2, 'Off', 'off@a.test', 'waiter', $3, false)",
      [randomUUID(), inactiveUser, fixtures.restaurantA],
    );
    await refused(`vipe_access=${await tokens.signAccess(inactiveUser, await liveSession(inactiveUser))}`);

    const noProfile = fixtures.noProfile.userId;
    await refused(`vipe_access=${await tokens.signAccess(noProfile, await liveSession(noProfile))}`);

    const forged = await new SignJWT({ sid: await liveSession(fixtures.adminA.userId) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(fixtures.adminA.userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-that-is-at-least-32-characters'));
    await refused(`vipe_access=${forged}`);

    const sidOfB = await liveSession(fixtures.adminB.userId);
    await refused(`vipe_access=${await tokens.signAccess(fixtures.adminA.userId, sidOfB)}`);
  });

  it('keeps delivering after private.realtime_row fails on a malformed notice', async () => {
    const a = await connect(await loginCookie(fixtures.adminA.email));
    await su("SELECT pg_notify('pos_changes', $1)", [
      JSON.stringify({ table: 'tables', op: 'INSERT', id: 'not-a-uuid', restaurant_id: fixtures.restaurantA }),
    ]);
    const id = randomUUID();
    await su("INSERT INTO public.tables (id, number, status, restaurant_id) VALUES ($1, 71, 'available', $2)", [
      id,
      fixtures.restaurantA,
    ]);
    await eventually(() => a.changes.some((e) => e.new.id === id));
    expect(a.changes).toHaveLength(1);
    a.socket.close();
  });

  it('ignores ?room= and join/subscribe requests for another restaurant', async () => {
    const roomB = `restaurant:${fixtures.restaurantB}`;
    const a = await connect(await loginCookie(fixtures.adminA.email), { room: roomB });
    a.socket.emit('join', roomB);
    a.socket.emit('subscribe', { room: roomB, restaurantId: fixtures.restaurantB });
    await settle(200);
    await su("INSERT INTO public.tables (number, status, restaurant_id) VALUES (72, 'available', $1)", [
      fixtures.restaurantB,
    ]);
    await settle();
    expect(a.changes).toHaveLength(0);
    expect(a.socket.connected).toBe(true);
    a.socket.close();
  });

  it('leaves no listener connection when closed while a reconnect is pending', async () => {
    const applicationName = `probe-${randomUUID().slice(0, 8)}`;
    const gateway = { broadcast: vi.fn<ChangeSink['broadcast']>(), resyncAll: vi.fn<ChangeSink['resyncAll']>() };
    const listener = new PgListenerService(database.apiUrl, app.get(DbClient), gateway, { applicationName });
    await listener.onModuleInit();
    const count = async () =>
      (await su<{ n: number }>('SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1', [applicationName]))[0].n;
    expect(await count()).toBe(1);

    await su('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [applicationName]);
    await settle(200);
    await listener.onModuleDestroy();
    await settle(1_500);
    expect(await count()).toBe(0);
    expect(gateway.resyncAll).not.toHaveBeenCalled();
  });
});
