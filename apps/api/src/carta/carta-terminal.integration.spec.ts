import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { ACTING_HEADER } from '../auth/terminal-access';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * carta-digital T5b (L29): on a shared terminal the waiter carta inbox works
 * like the waiter's other screens. Reading it is a terminal read; confirm,
 * reject and resolve are acting writes, so the PIN-identified waiter is the
 * one who decides (decided_by / resolved_by), never the terminal opener.
 */
const A = fixtures.restaurantA;
const c = {
  dish: 'e3000000-0000-0000-0000-000000000001',
  table: 'ea000000-0000-0000-0000-000000000021',
  order: 'eb000000-0000-0000-0000-000000000021',
  kitchen: { userId: 'ee000000-0000-0000-0000-000000000001', profileId: 'ef000000-0000-0000-0000-000000000001', email: 'kitchen-t@a.test' },
} as const;
const opener = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId };
const PINS: Record<string, string> = {
  [fixtures.adminA.profileId]: '9157',
  [fixtures.waiterA.profileId]: '4829',
  [c.kitchen.profileId]: '6031',
};

describe('carta inbox on a shared terminal (Testcontainers, T5b)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let adminCookie = '';
  let terminal = '';

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const server = () => request(app.getHttpServer());
  /** The terminal session; with `acting` the request carries the identified staff member's claim. */
  const onTerminal = (acting?: string) => {
    const withClaim = <T extends request.Test>(req: T) => (acting ? req.set(ACTING_HEADER, acting) : req);
    return {
      get: (url: string) => server().get(url).set('Cookie', terminal),
      post: (url: string, body?: object) => withClaim(server().post(url).set('Cookie', terminal)).send(body),
    };
  };
  const identify = async (profileId: string) => {
    const res = await onTerminal().post('/api/auth/identify', { profileId, pin: PINS[profileId] });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  const line = JSON.stringify([{ dishId: c.dish, quantity: 1, optionIds: [], note: null }]);
  const newProposal = async () =>
    (
      await db<{ id: string }>(
        `INSERT INTO carta_table_proposals (restaurant_id, table_id, order_id, guest_key, items) VALUES ($1, $2, $3, 'guest-key-0123456789', $4) RETURNING id`,
        [A, c.table, c.order, line],
      )
    )[0].id;
  /** One open request per order and kind (carta_table_requests_open_key). */
  const newRequest = async (kind: 'bill' | 'waiter') =>
    (
      await db<{ id: string }>(`INSERT INTO carta_table_requests (restaurant_id, table_id, order_id, kind) VALUES ($1, $2, $3, $4) RETURNING id`, [
        A,
        c.table,
        c.order,
        kind,
      ])
    )[0].id;
  const proposalRow = async (id: string) =>
    (await db<{ status: string; decided_by: string | null; reject_reason: string | null }>(
      'SELECT status, decided_by, reject_reason FROM carta_table_proposals WHERE id = $1',
      [id],
    ))[0];

  beforeAll(async () => {
    database = await startTestDatabase();
    const [{ password_hash: hash }] = await db<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [fixtures.waiterA.email]);
    await db(`INSERT INTO users (id, email, password_hash, password_algo, is_active) VALUES ($1, $2, $3, 'argon2id', true)`, [c.kitchen.userId, c.kitchen.email, hash]);
    await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cocina T', $3, 'kitchen', $4)`, [
      c.kitchen.profileId,
      c.kitchen.userId,
      c.kitchen.email,
      A,
    ]);
    await db(`INSERT INTO carta_settings (restaurant_id, published, table_ordering_enabled) VALUES ($1, true, true)`, [A]);
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [c.dish, A]);
    await db(`INSERT INTO tables (id, number, status, waiter_id, restaurant_id) VALUES ($1, 21, 'occupied', $2, $3)`, [c.table, fixtures.waiterA.profileId, A]);
    await db(
      `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, table_id, waiter_id) VALUES ($1, 'active', 0, 0, 0, 0, $2, $3, $4)`,
      [c.order, A, c.table, fixtures.waiterA.profileId],
    );
    app = await createTestApp(database.apiUrl);
    adminCookie = cookiePair(setCookies(await server().post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD })).vipe_access);
    for (const [profileId, pin] of Object.entries(PINS)) {
      expect((await server().put(`/api/staff/${profileId}/pin`).set('Cookie', adminCookie).send({ pin })).status).toBe(204);
    }
    expect((await server().put('/api/config').set('Cookie', adminCookie).send({ waiterAccessMode: 'shared_terminal' })).status).toBe(200);
    const opened = await server().post('/api/auth/terminal/login').send({ email: opener.email, password: PASSWORD });
    expect(opened.status).toBe(200);
    terminal = cookiePair(setCookies(opened).vipe_access);
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('reads the inbox without a PIN', async () => {
    const proposalId = await newProposal();
    const res = await onTerminal().get('/api/carta-inbox');
    expect(res.status).toBe(200);
    expect(res.body.proposals.map((p: { id: string }) => p.id)).toContain(proposalId);
  });

  it('refuses confirm, reject and resolve without the acting claim', async () => {
    const proposalId = await newProposal();
    const requestId = await newRequest('bill');
    for (const url of [`/api/carta-inbox/proposals/${proposalId}/confirm`, `/api/carta-inbox/proposals/${proposalId}/reject`, `/api/carta-inbox/requests/${requestId}/resolve`]) {
      const res = await onTerminal().post(url, {});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('acting_required');
    }
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'pending', decided_by: null });
    expect((await db('SELECT resolved_by FROM carta_table_requests WHERE id = $1', [requestId]))[0]).toEqual({ resolved_by: null });
  });

  it('confirms with the waiter PIN; the waiter is decided_by, not the terminal opener', async () => {
    const acting = await identify(fixtures.waiterA.profileId);
    const proposalId = await newProposal();
    const res = await onTerminal(acting).post(`/api/carta-inbox/proposals/${proposalId}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.orderItemIds).toHaveLength(1);
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'confirmed', decided_by: fixtures.waiterA.profileId });
    expect(fixtures.waiterA.profileId).not.toBe(opener.profileId);
  });

  it('rejects and resolves with the waiter PIN', async () => {
    const acting = await identify(fixtures.waiterA.profileId);
    const proposalId = await newProposal();
    const requestId = await newRequest('waiter');
    expect((await onTerminal(acting).post(`/api/carta-inbox/proposals/${proposalId}/reject`, { reason: 'Se acabó' })).status).toBe(204);
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'rejected', decided_by: fixtures.waiterA.profileId, reject_reason: 'Se acabó' });
    expect((await onTerminal(acting).post(`/api/carta-inbox/requests/${requestId}/resolve`)).status).toBe(204);
    expect((await db('SELECT resolved_by FROM carta_table_requests WHERE id = $1', [requestId]))[0]).toEqual({ resolved_by: fixtures.waiterA.profileId });
  });

  it('a kitchen PIN gets no acting claim, so it cannot confirm', async () => {
    const identified = await onTerminal().post('/api/auth/identify', { profileId: c.kitchen.profileId, pin: PINS[c.kitchen.profileId] });
    expect(identified.status).toBe(403);
    expect(identified.body.token).toBeUndefined();
    const proposalId = await newProposal();
    const res = await onTerminal().post(`/api/carta-inbox/proposals/${proposalId}/confirm`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('acting_required');
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'pending', decided_by: null });
  });

  it('keeps the delivery console off the terminal', async () => {
    const acting = await identify(fixtures.waiterA.profileId);
    const res = await onTerminal().get('/api/carta-delivery');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('terminal_route');
    const write = await onTerminal(acting).post(`/api/carta-delivery/${c.order}/confirm`);
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('terminal_route');
  });
  it('refuses a claim of another terminal and an expired or tampered claim, with no state change', async () => {
    const acting = await identify(fixtures.waiterA.profileId);
    const opened = await server().post('/api/auth/terminal/login').send({ email: opener.email, password: PASSWORD });
    const other = cookiePair(setCookies(opened).vipe_access);
    const proposalId = await newProposal();
    const foreign = await server().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', other).set(ACTING_HEADER, acting);
    expect([foreign.status, foreign.body.code]).toEqual([403, 'acting_required']);
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(Date.now() - 6 * 60_000));
    const stale = await identify(fixtures.waiterA.profileId);
    vi.restoreAllMocks();
    for (const claim of [stale, `${acting}x`]) {
      const res = await onTerminal(claim).post(`/api/carta-inbox/proposals/${proposalId}/confirm`);
      expect([res.status, res.body.code]).toEqual([403, 'acting_required']);
    }
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'pending', decided_by: null });
  });

  it('path variants keep the same classification', async () => {
    const proposalId = await newProposal();
    expect((await server().post(`/api/CARTA-INBOX/proposals/${proposalId}/confirm/`).set('Cookie', terminal)).body.code).toBe('acting_required');
    expect((await server().post(`/api/carta-inbox/proposals/${proposalId}%2Fconfirm`).set('Cookie', terminal)).status).toBe(404);
    expect((await server().get('/API/Carta-Delivery/').set('Cookie', terminal)).body.code).toBe('terminal_route');
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'pending', decided_by: null });
  });

  it('an admin PIN decides as the admin', async () => {
    const acting = await identify(fixtures.adminA.profileId);
    const proposalId = await newProposal();
    expect((await onTerminal(acting).post(`/api/carta-inbox/proposals/${proposalId}/reject`, {})).status).toBe(204);
    expect(await proposalRow(proposalId)).toMatchObject({ status: 'rejected', decided_by: fixtures.adminA.profileId });
  });
});
