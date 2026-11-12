import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * Counts with an assigned counter and an approving admin (odd/tasks/inventario-rediseno.md
 * T5, S5): draft -> counting -> review -> applied (or cancelled), blind counting through
 * /inventory/my-counts (never the expected stock nor the differences), recount per line,
 * a reason on large valued differences, apply by an admin who did not count, and stock
 * in transit never counted.
 */

const s = {
  harina: '79000000-0000-0000-0000-000000000001',
  queso: '79000000-0000-0000-0000-000000000002',
  barra: '79000000-0000-0000-0000-0000000000a2',
  admin2User: '79000000-0000-0000-0000-0000000000c1',
  admin2: '79000000-0000-0000-0000-0000000000c2',
  waiter2User: '79000000-0000-0000-0000-0000000000d1',
  waiter2: '79000000-0000-0000-0000-0000000000d2',
} as const;
const ADMIN2 = 'admin2@a.test';
const WAITER2 = 'waiter2@a.test';

const MY_COUNT_KEYS = [
  'countedLines', 'createdAt', 'id', 'linesCount', 'locationId', 'locationName', 'notes', 'number', 'recountLines', 'stage',
  'submittedAt',
];
const MY_LINE_KEYS = ['countedQuantity', 'id', 'itemId', 'itemName', 'recount', 'sku', 'unit'];
const FORBIDDEN = /expected|difference|cost|value/i;

type Line = { id: string; itemId: string; itemName: string };

describe('inventory counts with counter and approver (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let origin = '';
  let transferId = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
    const A = fixtures.restaurantA;
    await db(
      `INSERT INTO users (id, email, password_hash, password_algo, is_active)
       SELECT x.id, x.email, u.password_hash, u.password_algo, true FROM users u,
              (VALUES ($1::uuid, $2::text), ($3::uuid, $4::text)) x(id, email) WHERE u.id = $5`,
      [s.admin2User, ADMIN2, s.waiter2User, WAITER2, fixtures.adminA.userId],
    );
    await db(
      `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
         ($1, $2, 'Admin Dos', $3, 'admin', $7), ($4, $5, 'Mesero Dos', $6, 'waiter', $7)`,
      [s.admin2, s.admin2User, ADMIN2, s.waiter2, s.waiter2User, WAITER2, A],
    );
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, ADMIN2, WAITER2]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    await db(`INSERT INTO inventory_locations (id, restaurant_id, name, code) VALUES ($1, $2, 'Barra', 'BARRA')`, [s.barra, A]);
    await db(
      `INSERT INTO ingredients (id, name, unit, cost, restaurant_id) VALUES ($1, 'Harina', 'kg', 2000, $3), ($2, 'Queso', 'kg', 30000, $3)`,
      [s.harina, s.queso, A],
    );
    [{ id: origin }] = await db<{ id: string }>('SELECT id FROM inventory_locations WHERE is_default AND restaurant_id = $1', [A]);
    for (const body of [
      { itemId: s.harina, quantity: 10, unitCost: 2000 },
      { itemId: s.queso, quantity: 5, unitCost: 30000 },
    ]) {
      expect((await adminA().post('/api/inventory/movements/adjust', { locationId: origin, movementType: 'opening', ...body })).status).toBe(200);
    }
    // 3 kg of Harina leave the origin and stay in transit to the Barra.
    const transfer = await adminA().post('/api/inventory/transfers', {
      fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.harina, quantity: 3 }],
    });
    expect(transfer.status).toBe(201);
    transferId = transfer.body.id;
    expect((await adminA().post(`/api/inventory/transfers/${transferId}/send`)).status).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const admin2 = () => as(ADMIN2);
  const counter = () => as(fixtures.waiterA.email);
  const waiter2 = () => as(WAITER2);
  const adminB = () => as(fixtures.adminB.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const keys = (value: object) => Object.keys(value).sort();
  const lineOf = (lines: Line[], itemId: string) => lines.find((line) => line.itemId === itemId)!.id;
  const prepare = async (counterId: string, approverId: string, locationId = origin) => {
    const res = await adminA().post('/api/inventory/counts', { locationId, itemIds: [s.harina, s.queso], counterId, approverId });
    expect(res.status).toBe(201);
    return res.body.countId as string;
  };

  describe('preparing', () => {
    it('requires an active admin approver different from the counter (422 in Spanish)', async () => {
      const base = { locationId: origin, itemIds: [s.harina] };
      const same = await adminA().post('/api/inventory/counts', { ...base, counterId: fixtures.adminA.profileId, approverId: fixtures.adminA.profileId });
      expect(same.status).toBe(422);
      expect(same.body).toMatchObject({ code: 'P0001', message: 'Quien aprueba debe ser una persona distinta de quien cuenta' });
      const waiterApprover = await adminA().post('/api/inventory/counts', { ...base, counterId: s.waiter2, approverId: fixtures.waiterA.profileId });
      expect(waiterApprover.status).toBe(422);
      expect(waiterApprover.body.message).toBe('Quien aprueba debe ser un administrador activo del restaurante');
      const foreign = await adminA().post('/api/inventory/counts', { ...base, counterId: fixtures.adminB.profileId, approverId: fixtures.adminA.profileId });
      expect(foreign.status).toBe(422);
      expect(foreign.body.message).toBe('Quien cuenta debe ser una persona activa del restaurante');
      const half = await adminA().post('/api/inventory/counts', { ...base, counterId: fixtures.waiterA.profileId });
      expect(half.status).toBe(422);
      const [{ n }] = await db<{ n: number }>('SELECT count(*)::int AS n FROM inventory_counts');
      expect(n).toBe(0);
    });

    it('creates a draft with both people, then starts it; only admins prepare', async () => {
      const countId = await prepare(fixtures.waiterA.profileId, fixtures.adminA.profileId);
      const draft = await adminA().get(`/api/inventory/counts/${countId}`);
      expect(draft.body).toMatchObject({
        stage: 'draft', status: 'open', counterId: fixtures.waiterA.profileId, counterName: 'Waiter A',
        approverId: fixtures.adminA.profileId, approverName: 'Admin A', submittedAt: null,
      });
      expect((await counter().get('/api/inventory/my-counts')).body).toEqual([]);
      expect((await counter().post('/api/inventory/counts', { itemIds: [s.harina] })).status).toBe(403);
      expect((await counter().post(`/api/inventory/counts/${countId}/start`)).status).toBe(403);
      const started = await adminA().post(`/api/inventory/counts/${countId}/start`);
      expect(started.status).toBe(200);
      expect(started.body).toMatchObject({ id: countId, stage: 'counting', status: 'open' });
      const again = await adminA().post(`/api/inventory/counts/${countId}/start`);
      expect(again.status).toBe(422);
      await adminA().post(`/api/inventory/counts/${countId}/cancel`);
    });
  });

  describe('the full flow', () => {
    let countId = '';
    let lines: Line[] = [];

    it('expects the stock left at the origin, never the stock in transit', async () => {
      countId = await prepare(fixtures.waiterA.profileId, fixtures.adminA.profileId);
      await adminA().post(`/api/inventory/counts/${countId}/start`);
      const detail = await adminA().get(`/api/inventory/counts/${countId}`);
      const byItem = Object.fromEntries(detail.body.lines.map((l: Line & { expectedQuantity: number }) => [l.itemId, l.expectedQuantity]));
      expect(byItem).toEqual({ [s.harina]: 7, [s.queso]: 5 });
      const barra = await prepare(fixtures.waiterA.profileId, fixtures.adminA.profileId, s.barra);
      const barraDetail = await adminA().get(`/api/inventory/counts/${barra}`);
      expect(barraDetail.body.lines.map((l: { expectedQuantity: number }) => l.expectedQuantity)).toEqual([0, 0]);
      await adminA().post(`/api/inventory/counts/${barra}/cancel`);
    });

    it('lets the assigned non-admin counter count blind, in every endpoint', async () => {
      const list = await counter().get('/api/inventory/my-counts');
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(keys(list.body[0])).toEqual(MY_COUNT_KEYS);
      expect(list.body[0]).toMatchObject({ id: countId, stage: 'counting', linesCount: 2, countedLines: 0, recountLines: 0 });
      const detail = await counter().get(`/api/inventory/my-counts/${countId}`);
      expect(detail.status).toBe(200);
      expect(keys(detail.body)).toEqual([...MY_COUNT_KEYS, 'lines'].sort());
      expect(keys(detail.body.lines[0])).toEqual(MY_LINE_KEYS);
      expect(detail.body.lines.map((l: Line) => l.itemName)).toEqual(['Harina', 'Queso']);
      lines = detail.body.lines;
      const line = await counter().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.queso)}`, { countedQuantity: 3 });
      expect(line.status).toBe(200);
      expect(keys(line.body)).toEqual(MY_LINE_KEYS);
      expect(line.body).toMatchObject({ itemId: s.queso, countedQuantity: 3, recount: false });
      for (const body of [list.body, detail.body, line.body]) {
        expect(JSON.stringify(Object.keys(body)) + JSON.stringify(body.lines?.map(Object.keys) ?? [])).not.toMatch(FORBIDDEN);
      }
      // The admin endpoints stay admin: RLS hides the rows, writes are refused.
      expect((await counter().get('/api/inventory/counts')).body).toEqual([]);
      expect((await counter().get(`/api/inventory/counts/${countId}`)).status).toBe(404);
      expect((await counter().patch(`/api/inventory/counts/${countId}/lines/${lineOf(lines, s.queso)}`, { countedQuantity: 1 })).status).toBe(403);
      expect((await counter().post(`/api/inventory/counts/${countId}/apply`)).status).toBe(403);
    });

    it('hides the count from a non-assigned employee (404)', async () => {
      expect((await waiter2().get('/api/inventory/my-counts')).body).toEqual([]);
      expect((await waiter2().get(`/api/inventory/my-counts/${countId}`)).status).toBe(404);
      expect((await waiter2().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.harina)}`, { countedQuantity: 1 })).status).toBe(404);
      expect((await waiter2().post(`/api/inventory/my-counts/${countId}/submit`)).status).toBe(404);
      const [{ counted }] = await db<{ counted: string | null }>('SELECT counted_quantity AS counted FROM inventory_count_lines WHERE id = $1', [lineOf(lines, s.harina)]);
      expect(counted).toBeNull();
    });

    it('submits for review only when every line is counted; review is read only for the counter', async () => {
      const early = await counter().post(`/api/inventory/my-counts/${countId}/submit`);
      expect(early.status).toBe(422);
      expect(early.body.message).toBe('Falta contar 1 artículo(s)');
      await counter().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.harina)}`, { countedQuantity: 6 });
      const submitted = await counter().post(`/api/inventory/my-counts/${countId}/submit`);
      expect(submitted.status).toBe(200);
      expect(keys(submitted.body)).toEqual(MY_COUNT_KEYS);
      expect(submitted.body).toMatchObject({ stage: 'review', countedLines: 2 });
      expect(submitted.body.submittedAt).toEqual(expect.any(String));
      const late = await counter().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.harina)}`, { countedQuantity: 7 });
      expect(late.status).toBe(422);
    });

    it('shows the admin the differences valued in COP, largest first', async () => {
      const detail = await adminA().get(`/api/inventory/counts/${countId}`);
      expect(detail.body).toMatchObject({ stage: 'review', reasonThreshold: 50000, differenceValue: -62000 });
      expect(detail.body.lines.map((l: Record<string, unknown>) => [l.itemName, l.expectedQuantity, l.countedQuantity, l.difference, l.differenceValue, l.reasonRequired])).toEqual([
        ['Queso', 5, 3, -2, -60000, true],
        ['Harina', 7, 6, -1, -2000, false],
      ]);
    });

    it('sends only the marked lines back for recount', async () => {
      const bad = await adminA().post(`/api/inventory/counts/${countId}/recount`, { lineIds: [] });
      expect(bad.status).toBe(422);
      const res = await adminA().post(`/api/inventory/counts/${countId}/recount`, { lineIds: [lineOf(lines, s.harina)] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ stage: 'counting', submittedAt: null });
      const mine = await counter().get(`/api/inventory/my-counts/${countId}`);
      expect(mine.body).toMatchObject({ stage: 'counting', recountLines: 1 });
      expect(mine.body.lines.map((l: Line & { recount: boolean }) => [l.itemName, l.recount])).toEqual([['Harina', true], ['Queso', false]]);
      const other = await counter().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.queso)}`, { countedQuantity: 5 });
      expect(other.status).toBe(422);
      expect(other.body.message).toBe('Solo se recuentan los artículos marcados');
      expect((await counter().patch(`/api/inventory/my-counts/${countId}/lines/${lineOf(lines, s.harina)}`, { countedQuantity: 7 })).status).toBe(200);
      const again = await counter().post(`/api/inventory/my-counts/${countId}/submit`);
      expect(again.body).toMatchObject({ stage: 'review', recountLines: 0 });
    });

    it('requires a reason on lines valued at 50.000 COP or more before applying', async () => {
      const refused = await adminA().post(`/api/inventory/counts/${countId}/apply`);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toBe('Indica el motivo de las diferencias de $ 50.000 o más: Queso');
      const reason = await adminA().patch(`/api/inventory/counts/${countId}/lines/${lineOf(lines, s.queso)}`, { reason: ' Merma por vencimiento ' });
      expect(reason.status).toBe(200);
      expect(reason.body).toMatchObject({ notes: 'Merma por vencimiento', countedQuantity: 3, reasonRequired: true });
      const countedInReview = await adminA().patch(`/api/inventory/counts/${countId}/lines/${lineOf(lines, s.queso)}`, { countedQuantity: 4 });
      expect(countedInReview.status).toBe(422);
    });

    it('applies through count_adjustment movements, without touching the stock in transit', async () => {
      const applied = await adminA().post(`/api/inventory/counts/${countId}/apply`);
      expect(applied.status).toBe(200);
      expect(applied.body).toMatchObject({ countId, status: 'applied', adjustedLines: 1, valueDelta: -60000 });
      const moves = await db<{ movement_type: string; ingredient_id: string; quantity: string }>(
        `SELECT movement_type, ingredient_id, quantity FROM inventory_movements WHERE reference_type = 'inventory_count' AND reference_id = $1`,
        [countId],
      );
      expect(moves).toEqual([{ movement_type: 'count_adjustment', ingredient_id: s.queso, quantity: '-2.000' }]);
      const [transit] = await db<{ qty: string; status: string }>(
        `SELECT (SELECT sum(quantity) FROM inventory_transit_lots WHERE transfer_id = t.id)::text AS qty, t.status FROM inventory_transfers t WHERE t.id = $1`,
        [transferId],
      );
      expect(transit).toEqual({ qty: '3.000', status: 'in_transit' });
      const detail = await adminA().get(`/api/inventory/counts/${countId}`);
      expect(detail.body).toMatchObject({ stage: 'applied', status: 'applied' });
      expect((await adminA().post(`/api/inventory/counts/${countId}/cancel`)).status).toBe(422);
      expect((await counter().get('/api/inventory/my-counts')).body[0]).toMatchObject({ id: countId, stage: 'applied' });
    });

    it('isolates restaurants', async () => {
      expect((await adminB().get(`/api/inventory/counts/${countId}`)).status).toBe(404);
      expect((await adminB().post(`/api/inventory/counts/${countId}/recount`, { lineIds: [lineOf(lines, s.harina)] })).status).toBe(404);
      expect((await adminB().get('/api/inventory/my-counts')).body).toEqual([]);
      expect((await adminB().get(`/api/inventory/my-counts/${countId}`)).status).toBe(404);
    });
  });

  describe('an admin counter', () => {
    it('cannot approve their own count; another admin applies it', async () => {
      const countId = await prepare(s.admin2, fixtures.adminA.profileId);
      expect((await admin2().post(`/api/inventory/counts/${countId}/submit`)).status).toBe(422);
      await adminA().post(`/api/inventory/counts/${countId}/start`);
      const counting = await adminA().post(`/api/inventory/counts/${countId}/apply`);
      expect(counting.status).toBe(422);
      expect(counting.body.message).toBe('Envía el conteo a revisión antes de aplicarlo');
      const mine = await admin2().get(`/api/inventory/my-counts/${countId}`);
      for (const line of mine.body.lines as Line[]) {
        expect((await admin2().patch(`/api/inventory/my-counts/${countId}/lines/${line.id}`, { countedQuantity: 1 })).status).toBe(200);
      }
      expect((await admin2().post(`/api/inventory/counts/${countId}/submit`)).body).toMatchObject({ stage: 'review' });
      const own = await admin2().post(`/api/inventory/counts/${countId}/apply`);
      expect(own.status).toBe(422);
      expect(own.body.message).toBe('Quien contó no puede aprobar su propio conteo');
      // Harina 7 -> 1 (-12.000) and Queso 3 -> 1 (-60.000) after the flow above.
      await adminA().patch(`/api/inventory/counts/${countId}/lines/${(mine.body.lines as Line[]).find((l) => l.itemId === s.queso)!.id}`, { reason: 'Robo' });
      const applied = await adminA().post(`/api/inventory/counts/${countId}/apply`);
      expect(applied.status).toBe(200);
      expect(applied.body.adjustedLines).toBe(2);
    });
  });

  describe('the admin flow without a counter', () => {
    it('stays open (counting) and applies at once, as before', async () => {
      const opened = await adminA().post('/api/inventory/counts', { itemIds: [s.harina] });
      expect(opened.body).toMatchObject({ status: 'open', stage: 'counting' });
      const detail = await adminA().get(`/api/inventory/counts/${opened.body.countId}`);
      expect(detail.body).toMatchObject({ counterId: null, approverId: null, stage: 'counting' });
      await adminA().patch(`/api/inventory/counts/${opened.body.countId}/lines/${detail.body.lines[0].id}`, { countedQuantity: 1 });
      expect((await adminA().post(`/api/inventory/counts/${opened.body.countId}/apply`)).status).toBe(200);
    });
  });
});
