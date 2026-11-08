import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Catalog rows seeded as the superuser for this spec only. */
const c = {
  drinks: 'c0000000-0000-0000-0000-000000000001',
  empty: 'c0000000-0000-0000-0000-000000000002',
  hidden: 'c0000000-0000-0000-0000-000000000003',
  otherTenant: 'c0000000-0000-0000-0000-0000000000b1',
  arepa: 'd0000000-0000-0000-0000-000000000001',
  bandeja: 'd0000000-0000-0000-0000-000000000002',
  jugo: 'd0000000-0000-0000-0000-000000000003',
  otherDish: 'd0000000-0000-0000-0000-0000000000b1',
  lunch: 'e0000000-0000-0000-0000-000000000001',
  combo: 'e0000000-0000-0000-0000-000000000002',
  expired: 'e0000000-0000-0000-0000-000000000003',
  disabled: 'e0000000-0000-0000-0000-000000000004',
  otherPromo: 'e0000000-0000-0000-0000-0000000000b1',
} as const;

const DISH_KEYS = [
  'active', 'allowComments', 'categoryId', 'createdAt', 'description', 'id', 'imageUrl', 'modifierGroups', 'name', 'price', 'sortOrder', 'subcategoryId', 'updatedAt',
];

describe('catalog endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedCatalog(database.superuserUrl);
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
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA);
  const waiterA = () => as(fixtures.waiterA);
  const adminB = () => as(fixtures.adminB);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);

  it('answers 401 without the access cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/catalog/categories');
    expect(res.status).toBe(401);
  });

  describe('categories', () => {
    it("lists every category of the caller's restaurant by name, for any role", async () => {
      const res = await waiterA().get('/api/catalog/categories');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.drinks, c.hidden, c.empty]);
      expect(res.body[0]).toEqual({
        id: c.drinks,
        name: 'Bebidas',
        description: 'Frías',
        icon: 'cup',
        active: true,
        sortOrder: 0,
        color: 'neutral',
        hasSubcategories: false,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
    });

    it('filters active categories with active=true', async () => {
      const res = await waiterA().get('/api/catalog/categories?active=true');
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.drinks, c.empty]);
    });

    it("never shows restaurant A's categories to restaurant B", async () => {
      const res = await adminB().get('/api/catalog/categories');
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.otherTenant]);
    });

    it('creates a category for the admin in the admin restaurant', async () => {
      const res = await adminA().post('/api/catalog/categories', { name: 'Postres', icon: 'cake' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Postres', icon: 'cake', description: null, active: true });
      const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM categories WHERE id = $1', [res.body.id]);
      expect(row.restaurant_id).toBe(fixtures.restaurantA);
    });

    it('rejects writes from a waiter with 403 and stores nothing', async () => {
      const res = await waiterA().post('/api/catalog/categories', { name: 'Waiter cat', icon: 'x' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Insufficient role' });
      expect(await db("SELECT 1 FROM categories WHERE name = 'Waiter cat'")).toHaveLength(0);
      expect((await waiterA().patch(`/api/catalog/categories/${c.empty}`, { name: 'x' })).status).toBe(403);
      expect((await waiterA().delete(`/api/catalog/categories/${c.empty}`)).status).toBe(403);
    });

    it('answers 422 for unknown fields and for a missing icon', async () => {
      const unknown = await adminA().post('/api/catalog/categories', { name: 'X', icon: 'x', restaurantId: fixtures.restaurantB });
      expect(unknown.status).toBe(422);
      expect(unknown.body).toMatchObject({ statusCode: 422, error: 'Unprocessable Entity' });
      expect(unknown.body.message).toContain('restaurantId');
      const missing = await adminA().post('/api/catalog/categories', { name: 'X' });
      expect(missing.status).toBe(422);
      expect(missing.body.message).toContain('icon');
      expect(await db("SELECT 1 FROM categories WHERE name = 'X'")).toHaveLength(0);
    });

    it('updates a category', async () => {
      const created = await adminA().post('/api/catalog/categories', { name: 'Sopas', icon: 'bowl' });
      const res = await adminA().patch(`/api/catalog/categories/${created.body.id}`, { name: 'Sopas del día', active: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: created.body.id, name: 'Sopas del día', icon: 'bowl', active: false });
    });

    it("answers 404 when restaurant B patches or deletes A's category and leaves it intact", async () => {
      expect((await adminB().patch(`/api/catalog/categories/${c.empty}`, { name: 'hacked' })).status).toBe(404);
      expect((await adminB().delete(`/api/catalog/categories/${c.empty}`)).status).toBe(404);
      const [row] = await db<{ name: string }>('SELECT name FROM categories WHERE id = $1', [c.empty]);
      expect(row.name).toBe('Vacía');
    });

    it('answers 409 Category has dishes and keeps the category', async () => {
      const res = await adminA().delete(`/api/catalog/categories/${c.drinks}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Category has dishes' });
      expect(await db('SELECT 1 FROM categories WHERE id = $1', [c.drinks])).toHaveLength(1);
    });

    it('deletes a category without dishes', async () => {
      const created = await adminA().post('/api/catalog/categories', { name: 'Temporal', icon: 't' });
      const res = await adminA().delete(`/api/catalog/categories/${created.body.id}`);
      expect(res.status).toBe(204);
      expect(await db('SELECT 1 FROM categories WHERE id = $1', [created.body.id])).toHaveLength(0);
    });
  });

  describe('dishes', () => {
    it("lists every dish of the caller's restaurant by name with camelCase fields and numeric prices", async () => {
      const res = await waiterA().get('/api/catalog/dishes');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.arepa, c.bandeja, c.jugo]);
      expect(Object.keys(res.body[0]).sort()).toEqual(DISH_KEYS);
      expect(res.body[0]).toMatchObject({
        id: c.arepa,
        name: 'Arepa',
        price: 10000,
        categoryId: c.drinks,
        imageUrl: 'dishes/arepa.png',
        allowComments: true,
        active: true,
      });
    });

    it('filters by category and active', async () => {
      const res = await waiterA().get(`/api/catalog/dishes?categoryId=${c.drinks}&active=true`);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.arepa, c.bandeja]);
    });

    it("never shows restaurant A's dishes to restaurant B", async () => {
      const res = await adminB().get('/api/catalog/dishes');
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.otherDish]);
    });

    it('applies the best active promotion with pricing=promotions and leaves other dishes untouched', async () => {
      const res = await waiterA().get('/api/catalog/dishes?pricing=promotions');
      expect(res.status).toBe(200);
      const [arepa, bandeja, jugo] = res.body;
      // Lunch 20% of 10000 = 2000 loses to Combo fixed 3000.
      expect(arepa).toMatchObject({
        price: 7000,
        originalPrice: 10000,
        discountAmount: 3000,
        discountPercentage: null,
        promotionId: c.combo,
        promotionName: 'Combo',
      });
      // Expired and disabled 90% promotions are ignored; Lunch 20% applies.
      expect(bandeja).toMatchObject({
        price: 16000,
        originalPrice: 20000,
        discountAmount: 4000,
        discountPercentage: 20,
        promotionId: c.lunch,
        promotionName: 'Almuerzo',
      });
      expect(Object.keys(jugo).sort()).toEqual(DISH_KEYS);
      expect(jugo.price).toBe(5000);
    });

    it('creates a dish', async () => {
      const res = await adminA().post('/api/catalog/dishes', {
        name: 'Limonada',
        price: 4500.5,
        categoryId: c.drinks,
        description: null,
        imageUrl: null,
        allowComments: false,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Limonada', price: 4500.5, categoryId: c.drinks, active: true, allowComments: false });
    });

    it("answers 422 for another restaurant's category, unknown fields or a negative price", async () => {
      const foreign = await adminA().post('/api/catalog/dishes', { name: 'Foreign', price: 1, categoryId: c.otherTenant });
      expect(foreign.status).toBe(422);
      expect(foreign.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Unknown category' });
      expect((await adminA().post('/api/catalog/dishes', { name: 'Foreign', price: 1, category_id: c.drinks })).status).toBe(422);
      expect((await adminA().post('/api/catalog/dishes', { name: 'Foreign', price: -1 })).status).toBe(422);
      expect(await db("SELECT 1 FROM dishes WHERE name = 'Foreign'")).toHaveLength(0);
    });

    it('rejects dish writes from a waiter with 403', async () => {
      expect((await waiterA().post('/api/catalog/dishes', { name: 'W', price: 1 })).status).toBe(403);
      expect((await waiterA().patch(`/api/catalog/dishes/${c.jugo}`, { price: 1 })).status).toBe(403);
      expect((await waiterA().delete(`/api/catalog/dishes/${c.jugo}`)).status).toBe(403);
    });

    it("updates a dish and answers 404 when restaurant B patches or deletes A's dish", async () => {
      const res = await adminA().patch(`/api/catalog/dishes/${c.jugo}`, { description: 'Natural' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: c.jugo, description: 'Natural', price: 5000 });
      expect((await adminB().patch(`/api/catalog/dishes/${c.jugo}`, { price: 1 })).status).toBe(404);
      expect((await adminB().delete(`/api/catalog/dishes/${c.jugo}`)).status).toBe(404);
      const [row] = await db<{ price: string }>('SELECT price FROM dishes WHERE id = $1', [c.jugo]);
      expect(row.price).toBe('5000.00');
    });

    it('deletes a dish', async () => {
      const created = await adminA().post('/api/catalog/dishes', { name: 'Borrar', price: 1 });
      expect((await adminA().delete(`/api/catalog/dishes/${created.body.id}`)).status).toBe(204);
      expect(await db('SELECT 1 FROM dishes WHERE id = $1', [created.body.id])).toHaveLength(0);
    });
  });

  describe('promotions', () => {
    it('lists the restaurant promotions newest first', async () => {
      const res = await waiterA().get('/api/catalog/promotions');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.disabled, c.expired, c.combo, c.lunch]);
      expect(res.body[3]).toEqual({
        id: c.lunch,
        name: 'Almuerzo',
        description: null,
        discountType: 'percentage',
        discountValue: 20,
        startDate: expect.stringMatching(/Z$/),
        endDate: expect.stringMatching(/Z$/),
        active: true,
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
      const other = await adminB().get('/api/catalog/promotions');
      expect(other.body.map((row: { id: string }) => row.id)).toEqual([c.otherPromo]);
    });

    it('lists only the promotions active now', async () => {
      const res = await waiterA().get('/api/catalog/promotions/active');
      expect(res.body.map((row: { id: string }) => row.id).sort()).toEqual([c.lunch, c.combo].sort());
    });

    it('creates and updates a promotion', async () => {
      const created = await adminA().post('/api/catalog/promotions', {
        name: 'Happy hour',
        description: 'Tarde',
        discountType: 'fixed_amount',
        discountValue: 1500,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.000Z',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        name: 'Happy hour',
        discountType: 'fixed_amount',
        discountValue: 1500,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.000Z',
        active: true,
      });
      const updated = await adminA().patch(`/api/catalog/promotions/${created.body.id}`, { discountValue: 2000, active: false });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ id: created.body.id, discountValue: 2000, active: false });
    });

    it('answers 422 for an invalid discount type or date and 403 for a waiter', async () => {
      const base = { name: 'Bad', discountValue: 1, startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z' };
      expect((await adminA().post('/api/catalog/promotions', { ...base, discountType: 'bogo' })).status).toBe(422);
      expect((await adminA().post('/api/catalog/promotions', { ...base, discountType: 'percentage', startDate: 'soon' })).status).toBe(422);
      expect((await waiterA().post('/api/catalog/promotions', { ...base, discountType: 'percentage' })).status).toBe(403);
      expect(await db("SELECT 1 FROM promotions WHERE name = 'Bad'")).toHaveLength(0);
    });

    it('returns the full dishes of a promotion', async () => {
      const res = await waiterA().get(`/api/catalog/promotions/${c.combo}/dishes`);
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.arepa]);
      expect(Object.keys(res.body[0]).sort()).toEqual(DISH_KEYS);
    });

    it('replaces the dish set of a promotion', async () => {
      const promo = await createPromotion('Replace');
      expect((await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [c.arepa, c.bandeja] })).status).toBe(200);
      const res = await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [c.bandeja, c.jugo, c.jugo] });
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([c.bandeja, c.jugo]);
      expect(await promotionDishIds(promo)).toEqual([c.bandeja, c.jugo].sort());
      expect((await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [] })).body).toEqual([]);
      expect(await promotionDishIds(promo)).toEqual([]);
    });

    it('keeps the previous dish set when an insert fails', async () => {
      const promo = await createPromotion('Atomic');
      await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [c.arepa] });
      const res = await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [c.bandeja, c.otherDish] });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Unknown dish' });
      expect(await promotionDishIds(promo)).toEqual([c.arepa]);
    });

    it("answers 404 when restaurant B reads, assigns or deletes A's promotion, and 403 for a waiter", async () => {
      expect((await adminB().get(`/api/catalog/promotions/${c.combo}/dishes`)).status).toBe(404);
      expect((await adminB().put(`/api/catalog/promotions/${c.combo}/dishes`, { dishIds: [c.otherDish] })).status).toBe(404);
      expect((await adminB().patch(`/api/catalog/promotions/${c.combo}`, { name: 'x' })).status).toBe(404);
      expect((await adminB().delete(`/api/catalog/promotions/${c.combo}`)).status).toBe(404);
      expect((await waiterA().put(`/api/catalog/promotions/${c.combo}/dishes`, { dishIds: [] })).status).toBe(403);
      expect((await waiterA().delete(`/api/catalog/promotions/${c.combo}`)).status).toBe(403);
      expect(await promotionDishIds(c.combo)).toEqual([c.arepa]);
    });

    it('answers 422 for unknown fields in the dish assignment', async () => {
      const res = await adminA().put(`/api/catalog/promotions/${c.combo}/dishes`, { dishIds: [], dish_ids: [] });
      expect(res.status).toBe(422);
    });

    it('deletes a promotion together with its dish rows', async () => {
      const promo = await createPromotion('Delete me');
      await adminA().put(`/api/catalog/promotions/${promo}/dishes`, { dishIds: [c.arepa, c.bandeja] });
      expect((await adminA().delete(`/api/catalog/promotions/${promo}`)).status).toBe(204);
      expect(await db('SELECT 1 FROM promotions WHERE id = $1', [promo])).toHaveLength(0);
      expect(await promotionDishIds(promo)).toEqual([]);
    });

    async function createPromotion(name: string): Promise<string> {
      const res = await adminA().post('/api/catalog/promotions', {
        name,
        discountType: 'percentage',
        discountValue: 5,
        startDate: '2020-01-01T00:00:00Z',
        endDate: '2020-01-02T00:00:00Z',
      });
      expect(res.status).toBe(201);
      return res.body.id;
    }

    async function promotionDishIds(promotionId: string): Promise<string[]> {
      const rows = await db<{ dish_id: string }>(
        'SELECT dish_id FROM promotion_dishes WHERE promotion_id = $1 ORDER BY dish_id',
        [promotionId],
      );
      return rows.map((row) => row.dish_id);
    }
  });
});

async function seedCatalog(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  await superuserQuery(
    superuserUrl,
    `INSERT INTO categories (id, name, description, icon, active, restaurant_id) VALUES
       ($1, 'Bebidas', 'Frías', 'cup', true, $5),
       ($2, 'Vacía', NULL, 'box', true, $5),
       ($3, 'Oculta', NULL, 'eye', false, $5),
       ($4, 'Otra', NULL, 'x', true, $6)`,
    [c.drinks, c.empty, c.hidden, c.otherTenant, A, B],
  );
  await superuserQuery(
    superuserUrl,
    `INSERT INTO dishes (id, name, price, category_id, image_url, allow_comments, active, restaurant_id) VALUES
       ($1, 'Arepa', 10000, $5, 'dishes/arepa.png', true, true, $7),
       ($2, 'Bandeja', 20000, $5, NULL, false, true, $7),
       ($3, 'Jugo', 5000, $5, NULL, false, false, $7),
       ($4, 'Otro plato', 9000, $6, NULL, false, true, $8)`,
    [c.arepa, c.bandeja, c.jugo, c.otherDish, c.drinks, c.otherTenant, A, B],
  );
  await superuserQuery(
    superuserUrl,
    `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, end_date, active, created_at, restaurant_id) VALUES
       ($1, 'Almuerzo', 'percentage', 20, now() - interval '1 day', now() + interval '1 day', true, now() - interval '4 hours', $6),
       ($2, 'Combo', 'fixed_amount', 3000, now() - interval '1 day', now() + interval '1 day', true, now() - interval '3 hours', $6),
       ($3, 'Vencida', 'percentage', 90, now() - interval '3 days', now() - interval '2 days', true, now() - interval '2 hours', $6),
       ($4, 'Apagada', 'percentage', 90, now() - interval '1 day', now() + interval '1 day', false, now() - interval '1 hour', $6),
       ($5, 'Otra', 'percentage', 90, now() - interval '1 day', now() + interval '1 day', true, now(), $7)`,
    [c.lunch, c.combo, c.expired, c.disabled, c.otherPromo, A, B],
  );
  await superuserQuery(
    superuserUrl,
    `INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES
       ($1, $5, $9), ($2, $5, $9), ($1, $6, $9), ($3, $6, $9), ($4, $6, $9), ($8, $7, $10)`,
    [c.lunch, c.combo, c.expired, c.disabled, c.arepa, c.bandeja, c.otherDish, c.otherPromo, A, B],
  );
}
