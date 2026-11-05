import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const DEFAULTS = {
  taxPercentage: 10,
  tipPercentage: 10,
  priceSuggestion: 300,
  businessName: 'Mi Restaurante',
  businessAddress: 'Dirección del Restaurante',
  businessPhone: '123-456-7890',
  businessNit: '123456789',
  inventoryControlEnabled: false,
  deliveryDefaultFee: 0,
};

describe('business config endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    // Restaurant B starts with stored values; restaurant A has no row at all.
    await superuserQuery(
      database.superuserUrl,
      `INSERT INTO business_config (key, value, restaurant_id) VALUES
         ('tax_percentage', '8.5', $1), ('inventory_control_enabled', 'true', $1),
         ('business_name', 'Casa B', $1), ('delivery_default_fee', '4000', $1), ('legacy_unknown', 'x', $1)`,
      [fixtures.restaurantB],
    );
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

  const get = (user: { email: string }) => request(app.getHttpServer()).get('/api/config').set('Cookie', cookies[user.email]);
  const put = (user: { email: string }, body: object) =>
    request(app.getHttpServer()).put('/api/config').set('Cookie', cookies[user.email]).send(body);
  const rows = (restaurantId: string) =>
    superuserQuery<{ key: string; value: string }>(
      database.superuserUrl,
      'SELECT key, value FROM business_config WHERE restaurant_id = $1 ORDER BY key',
      [restaurantId],
    );

  it('returns every known key with the server defaults and inserts nothing', async () => {
    const res = await get(fixtures.waiterA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULTS);
    expect(await rows(fixtures.restaurantA)).toEqual([]);
  });

  it('types stored values and fills the missing keys, per restaurant', async () => {
    const res = await get(fixtures.adminB);
    expect(res.body).toEqual({
      ...DEFAULTS,
      taxPercentage: 8.5,
      inventoryControlEnabled: true,
      businessName: 'Casa B',
      deliveryDefaultFee: 4000,
    });
  });

  it('upserts the given keys in one write and returns the full config', async () => {
    const body = { taxPercentage: 19, businessName: 'Casa A', inventoryControlEnabled: true, deliveryDefaultFee: 3500 };
    const first = await put(fixtures.adminA, body);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ...DEFAULTS, ...body });

    const second = await put(fixtures.adminA, body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await rows(fixtures.restaurantA)).toEqual([
      { key: 'business_name', value: 'Casa A' },
      { key: 'delivery_default_fee', value: '3500' },
      { key: 'inventory_control_enabled', value: 'true' },
      { key: 'tax_percentage', value: '19' },
    ]);

    const update = await put(fixtures.adminA, { taxPercentage: 5 });
    expect(update.body.taxPercentage).toBe(5);
    expect(update.body.businessName).toBe('Casa A');
  });

  it('never touches restaurant B when A writes', async () => {
    const before = await rows(fixtures.restaurantB);
    await put(fixtures.adminA, { businessName: 'Only A' });
    expect(await rows(fixtures.restaurantB)).toEqual(before);
    expect((await get(fixtures.adminB)).body.businessName).toBe('Casa B');
  });

  it('rejects a waiter with 403 and stores nothing', async () => {
    const before = await rows(fixtures.restaurantA);
    const res = await put(fixtures.waiterA, { taxPercentage: 50 });
    expect(res.status).toBe(403);
    expect(await rows(fixtures.restaurantA)).toEqual(before);
  });

  it.each([
    ['an unknown key', { tax_percentage: 5 }],
    ['a wrong type', { taxPercentage: '5' }],
    ['a negative fee', { deliveryDefaultFee: -1 }],
    ['a fractional fee', { deliveryDefaultFee: 10.5 }],
  ])('answers 422 for %s and stores nothing', async (_case, body) => {
    const before = await rows(fixtures.restaurantA);
    const res = await put(fixtures.adminA, body);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, error: 'Unprocessable Entity' });
    expect(await rows(fixtures.restaurantA)).toEqual(before);
  });
});
