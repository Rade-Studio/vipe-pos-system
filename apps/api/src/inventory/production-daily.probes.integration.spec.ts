import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Edge cases of daily production found by the independent verification. */
describe('daily production probes (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cookie = '';
  const ids: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const admin = () => {
    const server = request(app.getHttpServer());
    return {
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
    };
  };
  /** Rows of every table a bulk production writes, to prove a rejection writes nothing. */
  const snapshot = async () => ({
    batches: await db('SELECT * FROM production_batches ORDER BY id'),
    lots: await db('SELECT * FROM inventory_lots ORDER BY id'),
    ingredients: await db('SELECT id, stock, cost, updated_at FROM ingredients ORDER BY id'),
    movements: await db('SELECT id FROM inventory_movements ORDER BY id'),
  });

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD });
    cookie = cookiePair(setCookies(res).vipe_access);

    const sal = await admin().post('/api/inventory/items', { name: 'Sal fina', unit: 'kg', openingStock: { quantity: 0.001, unitCost: 1000 } });
    const papa = await admin().post('/api/inventory/items', { name: 'Papa', unit: 'kg', openingStock: { quantity: 5, unitCost: 100 } });
    const t1 = await admin().post('/api/inventory/items/preparations', { name: 'Toque 1', unit: 'kg' });
    const t2 = await admin().post('/api/inventory/items/preparations', { name: 'Toque 2', unit: 'kg' });
    const pure = await admin().post('/api/inventory/items/preparations', { name: 'Pure', unit: 'kg' });
    expect([sal.status, papa.status, t1.status, t2.status, pure.status]).toEqual([201, 201, 201, 201, 201]);
    Object.assign(ids, { sal: sal.body.id, papa: papa.body.id, t1: t1.body.id, t2: t2.body.id, pure: pure.body.id });
    for (const targetId of [ids.t1, ids.t2]) {
      const formula = await admin().put('/api/inventory/formulas', {
        targetType: 'prep', targetId, yieldQuantity: 3, lines: [{ ingredientId: ids.sal, quantity: 0.001 }],
      });
      expect(formula.status).toBe(200);
    }
    await admin().put('/api/inventory/formulas', {
      targetType: 'prep', targetId: ids.pure, yieldQuantity: 1, lines: [{ ingredientId: ids.papa, quantity: 1 }],
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('nets the combined demand with the per-line rounding of produce_batch', async () => {
    const before = await snapshot();
    // Each line needs 0.001 x 2 / 3 = 0.000667, stored as 0.001; together 0.002 against 0.001 in stock.
    const res = await admin().post('/api/inventory/production/bulk', {
      lines: [{ itemId: ids.t1, quantity: 2 }, { itemId: ids.t2, quantity: 2 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('P0001');
    expect(res.body.message).toMatch(/^produce_preparations: insufficient stock: /);
    const sal = { ingredient_id: ids.sal, name: 'Sal fina', unit: 'kg', required: 0.002, available: 0.001, missing: 0.001 };
    expect(JSON.parse(res.body.details)).toEqual([
      { item_id: ids.t1, name: 'Toque 1', ingredients: [sal] },
      { item_id: ids.t2, name: 'Toque 2', ingredients: [sal] },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it('a bulk shortage leaves batches, lots and ingredients unchanged', async () => {
    const before = await snapshot();
    const res = await admin().post('/api/inventory/production/bulk', {
      lines: [{ itemId: ids.pure, quantity: 2 }, { itemId: ids.t1, quantity: 1000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('P0001');
    expect(await snapshot()).toEqual(before);
  });

  it('refuses template names that differ only in case or inner spaces', async () => {
    const lines = [{ itemId: ids.pure, quantity: 1 }];
    const created = await admin().post('/api/inventory/production-templates', { name: 'Lunes A', lines });
    expect(created.status).toBe(201);
    expect((await admin().post('/api/inventory/production-templates', { name: 'lunes   a', lines })).status).toBe(409);
    expect((await admin().post('/api/inventory/production-templates', { name: 'LUNES\tA', lines })).status).toBe(409);
    const other = await admin().post('/api/inventory/production-templates', { name: 'Martes', lines });
    expect(other.status).toBe(201);
    expect((await admin().patch(`/api/inventory/production-templates/${other.body.id}`, { name: ' lunes  A ' })).status).toBe(409);
    expect(await db('SELECT name FROM production_templates ORDER BY name')).toEqual([{ name: 'Lunes A' }, { name: 'Martes' }]);
  });
});
