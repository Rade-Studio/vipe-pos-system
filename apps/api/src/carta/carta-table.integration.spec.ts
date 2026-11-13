import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const c = {
  mains: 'd1000000-0000-0000-0000-000000000001',
  ajiaco: 'd3000000-0000-0000-0000-000000000001',
  steak: 'd3000000-0000-0000-0000-000000000002',
  off: 'd3000000-0000-0000-0000-000000000003',
  dishB: 'd3000000-0000-0000-0000-0000000000b1',
  promo: 'd4000000-0000-0000-0000-000000000001',
  doneness: 'd5000000-0000-0000-0000-000000000001',
  wellDone: 'd6000000-0000-0000-0000-000000000001',
  zone: 'd9000000-0000-0000-0000-000000000001',
  table12: 'da000000-0000-0000-0000-000000000012',
  table13: 'da000000-0000-0000-0000-000000000013',
  table14: 'da000000-0000-0000-0000-000000000014',
  tableB: 'da000000-0000-0000-0000-0000000000b1',
  order12: 'db000000-0000-0000-0000-000000000012',
  order14: 'db000000-0000-0000-0000-000000000014',
  oldOrder14: 'db000000-0000-0000-0000-0000000000e4',
  orderB: 'db000000-0000-0000-0000-0000000000b1',
  oldProposal: 'dc000000-0000-0000-0000-0000000000e4',
  proposalB: 'dc000000-0000-0000-0000-0000000000b1',
  oldRequest: 'dd000000-0000-0000-0000-0000000000e4',
  kitchen: { userId: 'de000000-0000-0000-0000-000000000001', profileId: 'df000000-0000-0000-0000-000000000001', email: 'kitchen@a.test' },
} as const;

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'No encontramos esta carta.' };
const KEY = 'guest-key-0123456789';
const OTHER_KEY = 'guest-key-abcdefghij';
const MESSAGES = {
  closed: 'Para pedir desde aquí, la mesa debe estar abierta',
  soldOut: 'Uno de los platos se acabó por hoy.',
  disabled: 'Este restaurante toma los pedidos en la mesa.',
  tooManyPending: 'Ya enviaste varios pedidos; espera a que el mesero los revise.',
  rateLimit: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
};
/** Tuesday 2026-11-10 12:00 in Bogotá. */
const BASE = Date.UTC(2026, 10, 10, 17, 0);

describe('carta table QR orders (Testcontainers, guest + staff)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let waiterCookie = '';
  let kitchenCookie = '';
  let minute = 0;
  const tokens: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const http = () => request(app.getHttpServer());
  const table = (tableId: string, slug = 'rest-a') => `/api/carta/${slug}/m/${tokens[tableId]}`;
  /** Each step is a new minute, so every rate-limit window starts empty. */
  const nextMinute = () => {
    minute++;
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(BASE + minute * 61_000));
  };
  const propose = (tableId: string, items: unknown[], extra: Record<string, unknown> = {}) =>
    http().post(`${table(tableId)}/proposals`).send({ guestKey: KEY, items, ...extra });
  const login = async (email: string) =>
    cookiePair(setCookies(await http().post('/api/auth/login').send({ email, password: PASSWORD })).vipe_access);
  const inbox = () => http().get('/api/carta-inbox').set('Cookie', waiterCookie);

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed();
    app = await createTestApp(database.apiUrl);
    waiterCookie = await login(fixtures.waiterA.email);
    kitchenCookie = await login(c.kitchen.email);
    for (const row of await db<{ table_id: string; token: string }>('SELECT table_id, token FROM table_qr_tokens')) {
      tokens[row.table_id] = row.token;
    }
  });

  beforeEach(() => nextMinute());

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('GET status (S12)', () => {
    it('shows the open table, the waiter first name and only this guest key', async () => {
      const res = await http().get(`${table(c.table12)}/status?guestKey=${OTHER_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        isOpen: true,
        waiterFirstName: 'Waiter',
        tableOrderingEnabled: true,
        showTableBill: true,
        proposals: [],
        requests: [],
      });
    });

    it('422 on an invalid guest key', async () => {
      const res = await http().get(`${table(c.table12)}/status?guestKey=short`);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('El identificador del comensal no es válido.');
    });

    it.each([
      ['an unknown token', '/api/carta/rest-a/m/AAAAAAAAAAAAAAAAAAAAAAAA/status'],
      ['an invalid token', '/api/carta/rest-a/m/short/status'],
      ['an unknown slug', '/api/carta/nope/m/AAAAAAAAAAAAAAAAAAAAAAAA/status'],
    ])('404 on %s', async (_name, url) => {
      const res = await http().get(`${url}?guestKey=${KEY}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it("404 with the identical body for another restaurant's token", async () => {
      const res = await http().get(`/api/carta/rest-a/m/${tokens[c.tableB]}/status?guestKey=${KEY}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('POST proposals (S12)', () => {
    it('201, extra keys stripped, and the guest sees it pending', async () => {
      const res = await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1, price: 1, extra: true }], {
        note: ' para ya ',
        restaurantId: fixtures.restaurantB,
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ proposalId: expect.any(String), status: 'pending', createdAt: expect.any(String) });
      const [row] = await db<{ items: Record<string, unknown>[]; note: string; restaurant_id: string }>(
        'SELECT items, note, restaurant_id FROM carta_table_proposals WHERE id = $1',
        [res.body.proposalId],
      );
      expect(row).toEqual({
        items: [{ dishId: c.ajiaco, quantity: 1, optionIds: [], note: null }],
        note: 'para ya',
        restaurant_id: fixtures.restaurantA,
      });
      const status = await http().get(`${table(c.table12)}/status?guestKey=${KEY}`);
      expect(status.body.proposals).toEqual([
        expect.objectContaining({ id: res.body.proposalId, status: 'pending', stage: 'pending', lines: [{ name: 'Ajiaco', quantity: 1 }] }),
      ]);
      await db("UPDATE carta_table_proposals SET status = 'rejected', decided_at = now() WHERE id = $1", [res.body.proposalId]);
    });

    it.each([
      ['a closed table', c.table13, [{ dishId: 'd3000000-0000-0000-0000-000000000001', quantity: 1 }], 409, MESSAGES.closed],
      ['an inactive dish', 'da000000-0000-0000-0000-000000000012', [{ dishId: 'd3000000-0000-0000-0000-000000000003', quantity: 1 }], 409, MESSAGES.soldOut],
      [
        'a missing required option',
        'da000000-0000-0000-0000-000000000012',
        [{ dishId: 'd3000000-0000-0000-0000-000000000002', quantity: 1 }],
        422,
        'Revisa las opciones elegidas para el plato.',
      ],
      [
        'quantity 0',
        'da000000-0000-0000-0000-000000000012',
        [{ dishId: 'd3000000-0000-0000-0000-000000000001', quantity: 0 }],
        422,
        'Revisa los platos del pedido: entre 1 y 20 líneas de 1 a 20 unidades.',
      ],
      ['no lines', 'da000000-0000-0000-0000-000000000012', [], 422, 'Revisa los platos del pedido: entre 1 y 20 líneas de 1 a 20 unidades.'],
    ])('%s', async (_name, tableId, items, status, message) => {
      const before = await db('SELECT id FROM carta_table_proposals');
      const res = await propose(tableId, items);
      expect(res.status).toBe(status);
      expect(res.body.message).toBe(message);
      expect(await db('SELECT id FROM carta_table_proposals')).toHaveLength(before.length);
    });

    it('422 on an invalid guest key and on a long note', async () => {
      const key = await http().post(`${table(c.table12)}/proposals`).send({ guestKey: 'bad key', items: [{ dishId: c.ajiaco, quantity: 1 }] });
      expect([key.status, key.body.message]).toEqual([422, 'El identificador del comensal no es válido.']);
      const note = await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }], { note: 'x'.repeat(201) });
      expect([note.status, note.body.message]).toEqual([422, 'La nota del pedido admite hasta 200 caracteres.']);
    });

    it("404 with the identical body for another restaurant's token", async () => {
      const res = await http().post(`/api/carta/rest-a/m/${tokens[c.tableB]}/proposals`).send({ guestKey: KEY, items: [{ dishId: c.ajiaco, quantity: 1 }] });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it('409 when table ordering is off', async () => {
      await db('UPDATE carta_settings SET table_ordering_enabled = false WHERE restaurant_id = $1', [fixtures.restaurantA]);
      try {
        const res = await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }]);
        expect([res.status, res.body.message]).toEqual([409, MESSAGES.disabled]);
      } finally {
        await db('UPDATE carta_settings SET table_ordering_enabled = true WHERE restaurant_id = $1', [fixtures.restaurantA]);
      }
    });

    it('429 after three pending proposals for the open order, never the raw DB message', async () => {
      for (let i = 0; i < 3; i++) {
        expect((await propose(c.table14, [{ dishId: c.ajiaco, quantity: 1 }])).status).toBe(201);
      }
      const res = await propose(c.table14, [{ dishId: c.ajiaco, quantity: 1 }]);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ statusCode: 429, error: 'Too Many Requests', message: MESSAGES.tooManyPending });
      await db("UPDATE carta_table_proposals SET status = 'rejected', decided_at = now() WHERE order_id = $1 AND status = 'pending'", [c.order14]);
    });

    it('10 a minute per IP, then the limiter 429', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        codes.push((await http().post(`${table(c.table12)}/proposals`).send({})).status);
      }
      expect(codes).toEqual([...Array(10).fill(422), 429]);
    });
  });

  describe('GET bill (S13)', () => {
    it('the open order read-only', async () => {
      const res = await http().get(`${table(c.table14)}/bill`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ lines: [{ name: 'Ajiaco', quantity: 2, unitPrice: 20000, lineTotal: 40000 }], tipPercentage: 10 });
    });

    it.each([
      ['a closed table', 'da000000-0000-0000-0000-000000000013'],
      ["another restaurant's token", 'da000000-0000-0000-0000-0000000000b1'],
    ])('404 on %s', async (_name, tableId) => {
      const res = await http().get(`/api/carta/rest-a/m/${tokens[tableId]}/bill`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('POST requests (S14)', () => {
    it('201, then already pending', async () => {
      const first = await http().post(`${table(c.table12)}/requests`).send({ kind: 'bill', extra: 1 });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ kind: 'bill', createdAt: expect.any(String), alreadyPending: false });
      const again = await http().post(`${table(c.table12)}/requests`).send({ kind: 'bill' });
      expect(again.body).toEqual({ kind: 'bill', createdAt: first.body.createdAt, alreadyPending: true });
    });

    it('422 on an unknown kind, 409 on a closed table, 404 on an unknown token', async () => {
      const kind = await http().post(`${table(c.table12)}/requests`).send({ kind: 'dessert' });
      expect([kind.status, kind.body.message]).toEqual([422, 'Solo puedes pedir la cuenta o llamar al mesero.']);
      const closed = await http().post(`${table(c.table13)}/requests`).send({ kind: 'waiter' });
      expect([closed.status, closed.body.message]).toEqual([409, MESSAGES.closed]);
      const unknown = await http().post('/api/carta/rest-a/m/AAAAAAAAAAAAAAAAAAAAAAAA/requests').send({ kind: 'waiter' });
      expect([unknown.status, unknown.body]).toEqual([404, NOT_FOUND]);
    });

    it('6 a minute per IP, then the limiter 429', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        codes.push((await http().post(`${table(c.table12)}/requests`).send({})).status);
      }
      expect(codes).toEqual([...Array(6).fill(422), 429]);
    });
  });

  describe('POST feedback (S14)', () => {
    it('204 with and without a table token', async () => {
      const withTable = await http().post('/api/carta/rest-a/feedback').send({ token: tokens[c.table13], rating: 5, comment: ' rico ', extra: 1 });
      expect(withTable.status).toBe(204);
      const plain = await http().post('/api/carta/rest-a/feedback').send({ rating: 1 });
      expect(plain.status).toBe(204);
      expect(await db('SELECT table_id, rating, comment FROM carta_feedback ORDER BY created_at')).toEqual([
        { table_id: c.table13, rating: 5, comment: 'rico' },
        { table_id: null, rating: 1, comment: null },
      ]);
    });

    it('422 on rating and comment, 404 on a foreign token', async () => {
      const rating = await http().post('/api/carta/rest-a/feedback').send({ rating: 6 });
      expect([rating.status, rating.body.message]).toEqual([422, 'La calificación va de 1 a 5 estrellas.']);
      const comment = await http().post('/api/carta/rest-a/feedback').send({ rating: 4, comment: 'x'.repeat(501) });
      expect([comment.status, comment.body.message]).toEqual([422, 'El comentario admite hasta 500 caracteres.']);
      nextMinute();
      const foreign = await http().post('/api/carta/rest-a/feedback').send({ token: tokens[c.tableB], rating: 4 });
      expect([foreign.status, foreign.body]).toEqual([404, NOT_FOUND]);
    });

    it('3 a minute per IP, then the limiter 429', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await http().post('/api/carta/rest-a/feedback').send({})).status);
      }
      expect(codes).toEqual([422, 422, 422, 429]);
    });

    it('the sixth feedback of a table within an hour is the limiter 429', async () => {
      const token = tokens[c.table12];
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        if (i % 3 === 0) nextMinute();
        codes.push((await http().post('/api/carta/rest-a/feedback').send({ token, rating: 3 })).status);
      }
      expect(codes).toEqual([204, 204, 204, 204, 204, 429]);
      expect(await db('SELECT id FROM carta_feedback WHERE table_id = $1', [c.table12])).toHaveLength(5);
    });
  });

  describe('staff inbox (S12, S14)', () => {
    it('401 without a cookie, 403 for kitchen', async () => {
      expect((await http().get('/api/carta-inbox')).status).toBe(401);
      expect((await http().get('/api/carta-inbox').set('Cookie', kitchenCookie)).status).toBe(403);
      expect((await http().post(`/api/carta-inbox/proposals/${c.oldProposal}/confirm`).set('Cookie', kitchenCookie)).status).toBe(403);
    });

    it('pending proposals and open requests of open orders only, newest first, never another restaurant', async () => {
      const first = await propose(c.table12, [{ dishId: c.ajiaco, quantity: 2, note: 'sin cebolla' }]);
      nextMinute();
      const second = await propose(c.table12, [{ dishId: c.steak, quantity: 1, optionIds: [c.wellDone] }], { note: 'rápido' });
      const res = await inbox();
      expect(res.status).toBe(200);
      expect(res.body.proposals.map((p: { id: string }) => p.id)).toEqual([second.body.proposalId, first.body.proposalId]);
      expect(res.body.proposals[0]).toEqual({
        id: second.body.proposalId,
        orderId: c.order12,
        tableNumber: 12,
        zoneName: 'Terraza',
        waiterName: 'Waiter A',
        note: 'rápido',
        createdAt: expect.any(String),
        lines: [{ dishId: c.steak, name: 'Churrasco', quantity: 1, note: null, options: [{ id: c.wellDone, name: 'Bien asado' }] }],
      });
      expect(res.body.requests).toEqual([
        { id: expect.any(String), kind: 'bill', orderId: c.order12, tableNumber: 12, zoneName: 'Terraza', waiterName: 'Waiter A', createdAt: expect.any(String) },
      ]);
      const ids = JSON.stringify(res.body);
      expect(ids).not.toContain(c.oldProposal);
      expect(ids).not.toContain(c.oldRequest);
      expect(ids).not.toContain(c.proposalB);
    });

    it('confirm adds the items through the waiter path, links them, and the guest sees kitchen then served', async () => {
      const proposalId = (await inbox()).body.proposals.find((p: { note: string | null }) => p.note === null).id as string;
      const res = await http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ proposalId, orderId: c.order12, status: 'confirmed', stage: 'kitchen', orderItemIds: [expect.any(String)] });
      const items = await db<{ id: string; dish_id: string; quantity: number; comments: string; status: string; promotion_id: string }>(
        'SELECT id, dish_id, quantity, comments, status, promotion_id FROM order_items WHERE order_id = $1',
        [c.order12],
      );
      expect(items).toEqual([
        { id: res.body.orderItemIds[0], dish_id: c.ajiaco, quantity: 2, comments: 'sin cebolla', status: 'kitchen', promotion_id: c.promo },
      ]);
      const [proposal] = await db('SELECT status, order_item_ids, decided_by FROM carta_table_proposals WHERE id = $1', [proposalId]);
      expect(proposal).toEqual({ status: 'confirmed', order_item_ids: res.body.orderItemIds, decided_by: fixtures.waiterA.profileId });
      expect((await db('SELECT status FROM orders WHERE id = $1', [c.order12]))[0]).toEqual({ status: 'kitchen' });
      expect(await db('SELECT id FROM order_discounts WHERE order_id = $1', [c.order12])).toHaveLength(1);
      const stage = async () =>
        (await http().get(`${table(c.table12)}/status?guestKey=${KEY}`)).body.proposals.find((p: { id: string }) => p.id === proposalId).stage;
      expect(await stage()).toBe('kitchen');
      await db("UPDATE order_items SET status = 'served' WHERE id = $1", [res.body.orderItemIds[0]]);
      expect(await stage()).toBe('served');

      const again = await http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie);
      expect([again.status, again.body.message]).toEqual([409, 'Este pedido ya fue confirmado o rechazado.']);
    });

    it('options become the line modifiers', async () => {
      const proposalId = (await inbox()).body.proposals[0].id as string;
      const res = await http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie);
      expect(res.status).toBe(200);
      expect(await db('SELECT option_id, price FROM order_item_modifiers WHERE order_item_id = $1', [res.body.orderItemIds[0]])).toEqual([
        { option_id: c.wellDone, price: '2000.00' },
      ]);
      expect((await db('SELECT price FROM order_items WHERE id = $1', [res.body.orderItemIds[0]]))[0]).toEqual({ price: '32000.00' });
    });

    it('a double confirm answers one 200 and one 409 and adds the items once', async () => {
      const { proposalId } = (await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }])).body;
      const before = await db('SELECT id FROM order_items WHERE order_id = $1', [c.order12]);
      const confirm = () => http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie);
      const statuses = (await Promise.all([confirm(), confirm()])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect(await db('SELECT id FROM order_items WHERE order_id = $1', [c.order12])).toHaveLength(before.length + 1);
    });

    it('404 for another restaurant, 422 for an invalid id, 409 when the order closed', async () => {
      const foreign = await http().post(`/api/carta-inbox/proposals/${c.proposalB}/confirm`).set('Cookie', waiterCookie);
      expect([foreign.status, foreign.body.message]).toEqual([404, 'No encontramos este pedido.']);
      expect((await http().post('/api/carta-inbox/proposals/nope/confirm').set('Cookie', waiterCookie)).status).toBe(422);
      const [late] = await db<{ id: string }>(
        `INSERT INTO carta_table_proposals (restaurant_id, table_id, order_id, guest_key, items) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [fixtures.restaurantA, c.table14, c.oldOrder14, KEY, JSON.stringify([{ dishId: c.ajiaco, quantity: 1, optionIds: [], note: null }])],
      );
      const closed = await http().post(`/api/carta-inbox/proposals/${late.id}/confirm`).set('Cookie', waiterCookie);
      expect([closed.status, closed.body.message]).toEqual([409, 'La mesa ya no tiene una cuenta abierta.']);
      expect((await db('SELECT status FROM carta_table_proposals WHERE id = $1', [late.id]))[0]).toEqual({ status: 'pending' });
    });

    it('reject with a reason the guest sees, once', async () => {
      const { proposalId } = (await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }])).body;
      const long = await http().post(`/api/carta-inbox/proposals/${proposalId}/reject`).set('Cookie', waiterCookie).send({ reason: 'x'.repeat(141) });
      expect([long.status, long.body.message]).toEqual([422, 'El motivo admite hasta 140 caracteres.']);
      const res = await http()
        .post(`/api/carta-inbox/proposals/${proposalId}/reject`)
        .set('Cookie', waiterCookie)
        .send({ reason: 'Se acabó', restaurantId: fixtures.restaurantB });
      expect(res.status).toBe(204);
      const status = await http().get(`${table(c.table12)}/status?guestKey=${KEY}`);
      expect(status.body.proposals.find((p: { id: string }) => p.id === proposalId)).toMatchObject({ stage: 'rejected', rejectReason: 'Se acabó' });
      const again = await http().post(`/api/carta-inbox/proposals/${proposalId}/reject`).set('Cookie', waiterCookie).send({});
      expect([again.status, again.body.message]).toEqual([409, 'Este pedido ya fue confirmado o rechazado.']);
    });

    it('resolve a request; it leaves the inbox and the guest status', async () => {
      const requestId = (await inbox()).body.requests[0].id as string;
      const res = await http().post(`/api/carta-inbox/requests/${requestId}/resolve`).set('Cookie', waiterCookie);
      expect(res.status).toBe(204);
      expect((await inbox()).body.requests).toEqual([]);
      expect((await http().get(`${table(c.table12)}/status?guestKey=${KEY}`)).body.requests).toEqual([]);
      const unknown = await http().post(`/api/carta-inbox/requests/${c.proposalB}/resolve`).set('Cookie', waiterCookie);
      expect([unknown.status, unknown.body.message]).toEqual([404, 'No encontramos esta solicitud.']);
    });
  });

  async function seed() {
    const A = fixtures.restaurantA;
    const B = fixtures.restaurantB;
    const [{ password_hash: hash }] = await db<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [fixtures.waiterA.email]);
    await db(`INSERT INTO users (id, email, password_hash, password_algo, is_active) VALUES ($1, $2, $3, 'argon2id', true)`, [c.kitchen.userId, c.kitchen.email, hash]);
    await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cocina A', $3, 'kitchen', $4)`, [
      c.kitchen.profileId,
      c.kitchen.userId,
      c.kitchen.email,
      A,
    ]);
    await db(`INSERT INTO carta_settings (restaurant_id, published, table_ordering_enabled) VALUES ($1, true, true), ($2, true, true)`, [A, B]);
    await db(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Platos', 'utensils', $2)`, [c.mains, A]);
    await db(
      `INSERT INTO dishes (id, name, price, category_id, active, restaurant_id) VALUES
         ($1, 'Ajiaco', 20000, $5, true, $6), ($2, 'Churrasco', 30000, $5, true, $6), ($3, 'Apagado', 1000, $5, false, $6),
         ($4, 'Plato B', 9000, NULL, true, $7)`,
      [c.ajiaco, c.steak, c.off, c.dishB, c.mains, A, B],
    );
    await db(
      `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, active, restaurant_id) VALUES
         ($1, 'Mediodía', 'percentage', 10, '2026-01-01T00:00:00-05', true, $2)`,
      [c.promo, A],
    );
    await db('INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1, $2, $3)', [c.promo, c.ajiaco, A]);
    await db(`INSERT INTO modifier_groups (id, name, required, min_select, max_select, restaurant_id) VALUES ($1, 'Término', true, 1, 1, $2)`, [c.doneness, A]);
    await db(`INSERT INTO modifier_options (id, group_id, name, price, restaurant_id) VALUES ($1, $2, 'Bien asado', 2000, $3)`, [c.wellDone, c.doneness, A]);
    await db('INSERT INTO dish_modifier_groups (dish_id, group_id, restaurant_id) VALUES ($1, $2, $3)', [c.steak, c.doneness, A]);
    await db(`INSERT INTO zones (id, restaurant_id, name) VALUES ($1, $2, 'Terraza')`, [c.zone, A]);
    await db(`INSERT INTO tables (id, number, restaurant_id, zone_id) VALUES ($1, 12, $4, $5), ($2, 13, $4, $5), ($3, 14, $4, NULL)`, [
      c.table12,
      c.table13,
      c.table14,
      A,
      c.zone,
    ]);
    await db('INSERT INTO tables (id, number, restaurant_id) VALUES ($1, 5, $2)', [c.tableB, B]);
    await db(
      `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, table_id, waiter_id, created_at) VALUES
         ($1, 'active', 0, 0, 0, 0, $5, $6, $9, now()), ($2, 'active', 40000, 0, 0, 40000, $5, $7, NULL, now()),
         ($3, 'paid', 0, 0, 0, 0, $5, $7, NULL, now() - interval '1 day'), ($4, 'active', 0, 0, 0, 0, $10, $8, NULL, now())`,
      [c.order12, c.order14, c.oldOrder14, c.orderB, A, c.table12, c.table14, c.tableB, fixtures.waiterA.profileId, B],
    );
    await db(`INSERT INTO order_items (order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES ($1, $2, 'Ajiaco', 20000, 2, 'kitchen', $3)`, [
      c.order14,
      c.ajiaco,
      A,
    ]);
    const line = (dishId: string) => JSON.stringify([{ dishId, quantity: 1, optionIds: [], note: null }]);
    await db(
      `INSERT INTO carta_table_proposals (id, restaurant_id, table_id, order_id, guest_key, items) VALUES
         ($1, $3, $4, $5, $9, $10), ($2, $6, $7, $8, $9, $11)`,
      [c.oldProposal, c.proposalB, A, c.table14, c.oldOrder14, B, c.tableB, c.orderB, KEY, line(c.ajiaco), line(c.dishB)],
    );
    await db(`INSERT INTO carta_table_requests (id, restaurant_id, table_id, order_id, kind) VALUES ($1, $2, $3, $4, 'bill')`, [
      c.oldRequest,
      A,
      c.table14,
      c.oldOrder14,
    ]);
  }

  describe('regressions from the independent verification', () => {
    it('a staff cookie of another restaurant changes nothing on guest writes (S2)', async () => {
      const cookieB = await login(fixtures.adminB.email);
      const res = await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }]).set('Cookie', cookieB);
      expect(res.status).toBe(201);
      expect((await db('SELECT restaurant_id, table_id FROM carta_table_proposals WHERE id = $1', [res.body.proposalId]))[0]).toEqual({
        restaurant_id: fixtures.restaurantA,
        table_id: c.table12,
      });
      await db("UPDATE carta_table_proposals SET status = 'rejected', decided_at = now() WHERE id = $1", [res.body.proposalId]);
    });

    it('X-Forwarded-For does not bypass the proposals limit (S2)', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        codes.push((await http().post(`${table(c.table12)}/proposals`).set('X-Forwarded-For', `203.0.113.${i}`).send({})).status);
      }
      expect(codes).toEqual([...Array(10).fill(422), 429]);
    });

    it('a refused waiter send rolls the confirm back; the proposal stays pending (S12)', async () => {
      const { proposalId } = (await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1 }])).body;
      const before = await db('SELECT id FROM order_items WHERE order_id = $1', [c.order12]);
      await db('UPDATE dishes SET active = false WHERE id = $1', [c.ajiaco]);
      try {
        expect((await http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie)).status).toBe(422);
      } finally {
        await db('UPDATE dishes SET active = true WHERE id = $1', [c.ajiaco]);
      }
      expect(await db('SELECT id FROM order_items WHERE order_id = $1', [c.order12])).toHaveLength(before.length);
      expect((await db('SELECT status, order_item_ids FROM carta_table_proposals WHERE id = $1', [proposalId]))[0]).toEqual({
        status: 'pending',
        order_item_ids: null,
      });
      await db("UPDATE carta_table_proposals SET status = 'rejected', decided_at = now() WHERE id = $1", [proposalId]);
    });

    it('a concurrent waiter send is never linked to the proposal (S12)', async () => {
      for (let round = 0; round < 4; round++) {
        nextMinute();
        const { proposalId } = (await propose(c.table12, [{ dishId: c.ajiaco, quantity: 1, note: `guest-${round}` }])).body;
        const [cr, wr] = await Promise.all([
          http().post(`/api/carta-inbox/proposals/${proposalId}/confirm`).set('Cookie', waiterCookie),
          http()
            .post(`/api/orders/${c.order12}/items`)
            .set('Cookie', waiterCookie)
            .send({ items: [{ dishId: c.ajiaco, quantity: 1, comments: `waiter-${round}` }] }),
        ]);
        expect([cr.status, wr.status]).toEqual([200, 201]);
        expect(await db('SELECT comments FROM order_items WHERE id = ANY($1::uuid[])', [cr.body.orderItemIds])).toEqual([{ comments: `guest-${round}` }]);
      }
    });
  });
});
