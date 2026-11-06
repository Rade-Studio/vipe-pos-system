import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Menu tree rows (T8, S5/S3) seeded as the superuser for this spec only. */
const m = {
  drinks: 'ca000000-0000-0000-0000-000000000001',
  mains: 'ca000000-0000-0000-0000-000000000002',
  desserts: 'ca000000-0000-0000-0000-000000000003',
  hidden: 'ca000000-0000-0000-0000-000000000004',
  categoryB: 'ca000000-0000-0000-0000-0000000000b1',
  grill: 'cb000000-0000-0000-0000-000000000001',
  soups: 'cb000000-0000-0000-0000-000000000002',
  retired: 'cb000000-0000-0000-0000-000000000003',
  sodas: 'cb000000-0000-0000-0000-000000000004',
  subB: 'cb000000-0000-0000-0000-0000000000b1',
  steak: 'cd000000-0000-0000-0000-000000000001',
  ajiaco: 'cd000000-0000-0000-0000-000000000002',
  cola: 'cd000000-0000-0000-0000-000000000003',
  flan: 'cd000000-0000-0000-0000-000000000004',
  oldDish: 'cd000000-0000-0000-0000-000000000005',
  offDish: 'cd000000-0000-0000-0000-000000000006',
  dishB: 'cd000000-0000-0000-0000-0000000000b1',
  promo: 'ce000000-0000-0000-0000-000000000001',
  milk: 'cf000000-0000-0000-0000-000000000001',
  kitchen: { userId: '1a000000-0000-0000-0000-000000000001', profileId: '2a000000-0000-0000-0000-000000000001', email: 'kitchen@a.test' },
  delivery: { userId: '1a000000-0000-0000-0000-000000000002', profileId: '2a000000-0000-0000-0000-000000000002', email: 'delivery@a.test' },
} as const;

const DUPLICATE = 'Ya existe una subcategoría con ese nombre en la categoría';
const HAS_DISHES = 'La subcategoría tiene platos; muévelos primero';
const OTHER_CATEGORY = 'La subcategoría no pertenece a la categoría del plato';
const NO_CATEGORY = 'Un plato sin categoría no puede tener subcategoría';
const MOVE = 'El plato está en una subcategoría de su categoría actual; elige una subcategoría de la nueva categoría o quítala';
const SUBCATEGORY_KEYS = ['active', 'categoryId', 'createdAt', 'id', 'name', 'sortOrder', 'updatedAt'];

describe('menu tree endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const users = [fixtures.adminA, fixtures.waiterA, fixtures.adminB, fixtures.bcryptUser, m.kitchen, m.delivery];

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedMenu(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const user of users) {
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
  const adminB = () => as(fixtures.adminB);
  const staff = () => [as(fixtures.waiterA), as(fixtures.bcryptUser), as(m.kitchen), as(m.delivery)];
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const ids = (body: { id: string }[]) => body.map((row) => row.id);
  const order = async (table: string, rowIds: string[]) =>
    (await db<{ id: string; sort_order: number }>(`SELECT id, sort_order FROM ${table} WHERE id = ANY($1) ORDER BY id`, [rowIds]))
      .map((row) => [row.id, row.sort_order]);

  describe('categories', () => {
    it('lists by sort order then name with colour and the derived hasSubcategories', async () => {
      const res = await as(fixtures.waiterA).get('/api/catalog/categories');
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([m.drinks, m.mains, m.desserts, m.hidden]);
      expect(res.body[1]).toMatchObject({ id: m.mains, sortOrder: 1, color: 'orange', hasSubcategories: true });
      expect(res.body[2]).toMatchObject({ id: m.desserts, sortOrder: 2, color: 'neutral', hasSubcategories: false });
    });

    it('creates at the end of the order by default and accepts sortOrder and colour', async () => {
      const appended = await adminA().post('/api/catalog/categories', { name: 'Sopas', icon: 'bowl' });
      expect(appended.status).toBe(201);
      expect(appended.body).toMatchObject({ sortOrder: 4, color: 'neutral', hasSubcategories: false });
      const placed = await adminA().post('/api/catalog/categories', { name: 'Combos', icon: 'box', sortOrder: 9, color: 'rose' });
      expect(placed.body).toMatchObject({ sortOrder: 9, color: 'rose' });
      const patched = await adminA().patch(`/api/catalog/categories/${placed.body.id}`, { color: 'emerald', sortOrder: 8 });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ sortOrder: 8, color: 'emerald' });
      const bad = await adminA().post('/api/catalog/categories', { name: 'Mal', icon: 'x', color: 'red' });
      expect(bad.status).toBe(422);
      expect(await db("SELECT 1 FROM categories WHERE name = 'Mal'")).toHaveLength(0);
      for (const id of [appended.body.id, placed.body.id]) await db('DELETE FROM categories WHERE id = $1', [id]);
    });

    it('answers 409 in Spanish when the category has subcategories but no dishes, and keeps it', async () => {
      const created = await adminA().post('/api/catalog/categories', { name: 'Con sub', icon: 'x' });
      await adminA().post('/api/catalog/subcategories', { categoryId: created.body.id, name: 'Única' });
      const res = await adminA().delete(`/api/catalog/categories/${created.body.id}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'La categoría tiene subcategorías; elimínalas primero' });
      expect(await db('SELECT 1 FROM categories WHERE id = $1', [created.body.id])).toHaveLength(1);
      await db('DELETE FROM subcategories WHERE category_id = $1', [created.body.id]);
      await db('DELETE FROM categories WHERE id = $1', [created.body.id]);
    });

    it('stores trimmed category names', async () => {
      const res = await adminA().post('/api/catalog/categories', { name: '  Licores  ', icon: 'x' });
      expect(res.body.name).toBe('Licores');
      await db('DELETE FROM categories WHERE id = $1', [res.body.id]);
    });

    it('saves a full reorder in one transaction for the admin only', async () => {
      const before = await order('categories', [m.drinks, m.mains, m.desserts, m.hidden]);
      for (const user of staff()) {
        expect((await user.put('/api/catalog/categories/order', { ids: [m.mains, m.drinks] })).status).toBe(403);
      }
      const foreign = await adminA().put('/api/catalog/categories/order', { ids: [m.hidden, m.desserts, m.categoryB] });
      expect(foreign.status).toBe(422);
      expect(foreign.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Unknown category' });
      expect((await adminA().put('/api/catalog/categories/order', { ids: [m.mains, m.mains] })).status).toBe(422);
      expect(await order('categories', [m.drinks, m.mains, m.desserts, m.hidden])).toEqual(before);

      const res = await adminA().put('/api/catalog/categories/order', { ids: [m.mains, m.drinks, m.desserts, m.hidden] });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([m.mains, m.drinks, m.desserts, m.hidden]);
      await adminA().put('/api/catalog/categories/order', { ids: [m.drinks, m.mains, m.desserts, m.hidden] });
      expect(await order('categories', [m.drinks, m.mains, m.desserts, m.hidden])).toEqual(before);
    });
  });

  describe('subcategories', () => {
    it('lists the active subcategories of a category by sort order for every staff role', async () => {
      for (const user of [adminA(), ...staff()]) {
        const res = await user.get(`/api/catalog/subcategories?categoryId=${m.mains}`);
        expect(res.status).toBe(200);
        expect(ids(res.body)).toEqual([m.grill, m.soups]);
      }
      const res = await adminA().get(`/api/catalog/subcategories?categoryId=${m.mains}`);
      expect(Object.keys(res.body[0]).sort()).toEqual(SUBCATEGORY_KEYS);
      expect(res.body[0]).toMatchObject({ id: m.grill, categoryId: m.mains, name: 'Parrilla', sortOrder: 0, active: true });
      expect(ids((await adminA().get('/api/catalog/subcategories')).body)).toEqual([m.sodas, m.grill, m.soups]);
    });

    it('includes inactive subcategories for an admin only', async () => {
      const res = await adminA().get(`/api/catalog/subcategories?categoryId=${m.mains}&includeInactive=true`);
      expect(ids(res.body)).toEqual([m.grill, m.soups, m.retired]);
      expect((await as(fixtures.waiterA).get(`/api/catalog/subcategories?includeInactive=true`)).status).toBe(403);
      expect((await adminA().get('/api/catalog/subcategories?categoryId=nope')).status).toBe(422);
    });

    it("never shows restaurant A's subcategories to restaurant B", async () => {
      expect(ids((await adminB().get('/api/catalog/subcategories?includeInactive=true')).body)).toEqual([m.subB]);
      expect((await adminA().get(`/api/catalog/subcategories?categoryId=${m.categoryB}`)).body).toEqual([]);
    });

    it('creates, updates and deletes for the admin; other roles get 403 and nothing changes', async () => {
      for (const user of staff()) {
        expect((await user.post('/api/catalog/subcategories', { categoryId: m.mains, name: 'Staff' })).status).toBe(403);
        expect((await user.patch(`/api/catalog/subcategories/${m.grill}`, { name: 'x' })).status).toBe(403);
        expect((await user.delete(`/api/catalog/subcategories/${m.retired}`)).status).toBe(403);
      }
      expect(await db("SELECT 1 FROM subcategories WHERE name IN ('Staff', 'x')")).toHaveLength(0);

      const created = await adminA().post('/api/catalog/subcategories', { categoryId: m.mains, name: '  Pastas ' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ categoryId: m.mains, name: 'Pastas', sortOrder: 3, active: true });
      const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM subcategories WHERE id = $1', [created.body.id]);
      expect(row.restaurant_id).toBe(fixtures.restaurantA);

      const updated = await adminA().patch(`/api/catalog/subcategories/${created.body.id}`, { name: 'Pastas frescas', active: false });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ id: created.body.id, name: 'Pastas frescas', active: false });
      expect((await adminA().delete(`/api/catalog/subcategories/${created.body.id}`)).status).toBe(204);
      expect(await db('SELECT 1 FROM subcategories WHERE id = $1', [created.body.id])).toHaveLength(0);
    });

    it('answers 409 in Spanish for a duplicate name in the category, case-insensitive', async () => {
      const res = await adminA().post('/api/catalog/subcategories', { categoryId: m.mains, name: 'parrilla' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: DUPLICATE });
      expect((await adminA().patch(`/api/catalog/subcategories/${m.soups}`, { name: 'PARRILLA' })).body.message).toBe(DUPLICATE);
      const elsewhere = await adminA().post('/api/catalog/subcategories', { categoryId: m.drinks, name: 'Parrilla' });
      expect(elsewhere.status).toBe(201);
      await db('DELETE FROM subcategories WHERE id = $1', [elsewhere.body.id]);
    });

    it('answers 422 for unknown fields, a bad name or a category of another restaurant', async () => {
      expect((await adminA().post('/api/catalog/subcategories', { categoryId: m.mains, name: 'X', restaurantId: fixtures.restaurantB })).status).toBe(422);
      expect((await adminA().post('/api/catalog/subcategories', { categoryId: m.mains, name: ' ' })).status).toBe(422);
      expect((await adminA().post('/api/catalog/subcategories', { categoryId: m.mains, name: 'x'.repeat(41) })).status).toBe(422);
      expect((await adminA().patch(`/api/catalog/subcategories/${m.grill}`, { categoryId: m.drinks })).status).toBe(422);
      const foreign = await adminA().post('/api/catalog/subcategories', { categoryId: m.categoryB, name: 'Ajena' });
      expect(foreign.status).toBe(422);
      expect(foreign.body.message).toBe('Unknown category');
      expect(await db("SELECT 1 FROM subcategories WHERE name IN ('X', 'Ajena')")).toHaveLength(0);
    });

    it("answers 404 when restaurant B patches or deletes A's subcategory", async () => {
      expect((await adminB().patch(`/api/catalog/subcategories/${m.grill}`, { name: 'hacked' })).status).toBe(404);
      expect((await adminB().delete(`/api/catalog/subcategories/${m.retired}`)).status).toBe(404);
      expect(await db("SELECT 1 FROM subcategories WHERE id = ANY($1) AND name <> 'hacked'", [[m.grill, m.retired]])).toHaveLength(2);
    });

    it('answers 409 in Spanish when the subcategory has dishes and keeps it', async () => {
      const res = await adminA().delete(`/api/catalog/subcategories/${m.retired}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: HAS_DISHES });
      expect(await db('SELECT 1 FROM subcategories WHERE id = $1', [m.retired])).toHaveLength(1);
    });

    it('saves the order of one category in one transaction; one bad id changes nothing', async () => {
      const before = await order('subcategories', [m.grill, m.soups, m.retired]);
      expect((await as(fixtures.waiterA).put('/api/catalog/subcategories/order', { categoryId: m.mains, ids: [m.soups] })).status).toBe(403);
      const wrong = await adminA().put('/api/catalog/subcategories/order', { categoryId: m.mains, ids: [m.soups, m.grill, m.sodas] });
      expect(wrong.status).toBe(422);
      expect(wrong.body.message).toBe('Unknown subcategory');
      const foreign = await adminA().put('/api/catalog/subcategories/order', { categoryId: m.mains, ids: [m.soups, m.subB] });
      expect(foreign.status).toBe(422);
      expect(await order('subcategories', [m.grill, m.soups, m.retired])).toEqual(before);

      const res = await adminA().put('/api/catalog/subcategories/order', { categoryId: m.mains, ids: [m.retired, m.soups, m.grill] });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([m.retired, m.soups, m.grill]);
      await adminA().put('/api/catalog/subcategories/order', { categoryId: m.mains, ids: [m.grill, m.soups, m.retired] });
      expect(await order('subcategories', [m.grill, m.soups, m.retired])).toEqual(before);
    });
  });

  describe('dishes', () => {
    it('carries subcategoryId and filters by subcategory, together with categoryId', async () => {
      const res = await as(fixtures.waiterA).get(`/api/catalog/dishes?subcategoryId=${m.grill}`);
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([m.offDish, m.steak]);
      expect(res.body[1]).toMatchObject({ categoryId: m.mains, subcategoryId: m.grill });
      expect(ids((await adminA().get(`/api/catalog/dishes?categoryId=${m.mains}&subcategoryId=${m.soups}`)).body)).toEqual([m.ajiaco]);
      expect((await adminA().get(`/api/catalog/dishes?categoryId=${m.drinks}&subcategoryId=${m.soups}`)).body).toEqual([]);
      const flan = (await adminA().get(`/api/catalog/dishes?categoryId=${m.desserts}`)).body[0];
      expect(flan).toMatchObject({ id: m.flan, subcategoryId: null });
    });

    it('sets and clears the subcategory on create and update', async () => {
      const created = await adminA().post('/api/catalog/dishes', { name: 'Sobrebarriga', price: 25000, categoryId: m.mains, subcategoryId: m.grill });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ categoryId: m.mains, subcategoryId: m.grill });
      const cleared = await adminA().patch(`/api/catalog/dishes/${created.body.id}`, { subcategoryId: null });
      expect(cleared.body.subcategoryId).toBeNull();
      const moved = await adminA().patch(`/api/catalog/dishes/${created.body.id}`, { categoryId: m.drinks, subcategoryId: m.sodas });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ categoryId: m.drinks, subcategoryId: m.sodas });
      await db('DELETE FROM dishes WHERE id = $1', [created.body.id]);
    });

    it('answers 422 in Spanish for a subcategory of another category or restaurant, or without category', async () => {
      const cross = await adminA().post('/api/catalog/dishes', { name: 'Cruzado', price: 1, categoryId: m.drinks, subcategoryId: m.grill });
      expect(cross.status).toBe(422);
      expect(cross.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: OTHER_CATEGORY });
      const foreign = await adminA().post('/api/catalog/dishes', { name: 'Cruzado', price: 1, categoryId: m.mains, subcategoryId: m.subB });
      expect(foreign.status).toBe(422);
      expect(foreign.body.message).toBe(OTHER_CATEGORY);
      const orphan = await adminA().post('/api/catalog/dishes', { name: 'Cruzado', price: 1, subcategoryId: m.grill });
      expect(orphan.status).toBe(422);
      expect(orphan.body.message).toBe(NO_CATEGORY);
      const patched = await adminA().patch(`/api/catalog/dishes/${m.cola}`, { subcategoryId: m.grill });
      expect(patched.status).toBe(422);
      expect(patched.body.message).toBe(OTHER_CATEGORY);
      const uncategorised = await adminA().patch(`/api/catalog/dishes/${m.cola}`, { categoryId: null });
      expect(uncategorised.status).toBe(422);
      expect(uncategorised.body.message).toBe(NO_CATEGORY);
      expect(await db("SELECT 1 FROM dishes WHERE name = 'Cruzado'")).toHaveLength(0);
      expect(await db('SELECT category_id, subcategory_id FROM dishes WHERE id = $1', [m.cola])).toEqual([
        { category_id: m.drinks, subcategory_id: m.sodas },
      ]);
    });

    it('answers 422 when a dish moves category without choosing or clearing its subcategory', async () => {
      const res = await adminA().patch(`/api/catalog/dishes/${m.steak}`, { categoryId: m.drinks });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: MOVE });
      expect(await db('SELECT category_id, subcategory_id FROM dishes WHERE id = $1', [m.steak])).toEqual([
        { category_id: m.mains, subcategory_id: m.grill },
      ]);
      const same = await adminA().patch(`/api/catalog/dishes/${m.steak}`, { categoryId: m.mains, price: 30000 });
      expect(same.status).toBe(200);
      const plain = await adminA().patch(`/api/catalog/dishes/${m.flan}`, { categoryId: m.drinks });
      expect(plain.status).toBe(200);
      await adminA().patch(`/api/catalog/dishes/${m.flan}`, { categoryId: m.desserts });
    });

    it('rejects subcategory writes from other roles with 403', async () => {
      for (const user of staff()) {
        expect((await user.patch(`/api/catalog/dishes/${m.steak}`, { subcategoryId: null })).status).toBe(403);
      }
      expect(await db('SELECT subcategory_id FROM dishes WHERE id = $1', [m.steak])).toEqual([{ subcategory_id: m.grill }]);
    });
  });

  describe('GET /catalog/menu/tree', () => {
    it('returns the same ordered tree to every staff role', async () => {
      const bodies = [];
      for (const user of [adminA(), ...staff()]) {
        const res = await user.get('/api/catalog/menu/tree');
        expect(res.status).toBe(200);
        bodies.push(res.body);
      }
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      const tree = bodies[0];
      expect(ids(tree.categories)).toEqual([m.drinks, m.mains, m.desserts]);
      expect(tree.categories[1]).toMatchObject({ id: m.mains, name: 'Platos', icon: 'utensils', color: 'orange', sortOrder: 1, hasSubcategories: true });
      expect(ids(tree.categories[1].subcategories)).toEqual([m.grill, m.soups]);
      expect(Object.keys(tree.categories[1].subcategories[0]).sort()).toEqual(SUBCATEGORY_KEYS);
      expect(tree.categories[2]).toMatchObject({ id: m.desserts, hasSubcategories: false, subcategories: [] });
    });

    it('lists only active dishes of active subcategories, with promotion pricing and availability', async () => {
      await setControl(true);
      try {
        const tree = (await as(fixtures.waiterA).get('/api/catalog/menu/tree')).body;
        const [drinks, mains, desserts] = tree.categories;
        expect(ids(drinks.dishes)).toEqual([m.cola]);
        // The retired subcategory hides Viejo; the inactive dish is left out.
        expect(ids(mains.dishes)).toEqual([m.ajiaco, m.steak]);
        expect(mains.dishes[0]).toMatchObject({
          id: m.ajiaco,
          name: 'Ajiaco',
          price: 18000,
          originalPrice: 20000,
          discountAmount: 2000,
          discountPercentage: 10,
          promotionId: m.promo,
          promotionName: 'Mediodía',
          subcategoryId: m.soups,
          available: true,
        });
        expect(mains.dishes[1]).toMatchObject({ id: m.steak, price: 30000, subcategoryId: m.grill, available: true });
        expect(mains.dishes[1].promotionId).toBeUndefined();
        expect(desserts.dishes).toEqual([expect.objectContaining({ id: m.flan, subcategoryId: null, available: false })]);
      } finally {
        await setControl(false);
      }
      const off = (await as(m.delivery).get('/api/catalog/menu/tree')).body;
      expect(off.categories[2].dishes[0]).toMatchObject({ id: m.flan, available: true });
    });

    it("never shows restaurant A's menu to restaurant B", async () => {
      const tree = (await adminB().get('/api/catalog/menu/tree')).body;
      expect(ids(tree.categories)).toEqual([m.categoryB]);
      expect(ids(tree.categories[0].subcategories)).toEqual([m.subB]);
      expect(ids(tree.categories[0].dishes)).toEqual([m.dishB]);
    });

    it('answers 401 without the access cookie', async () => {
      expect((await request(app.getHttpServer()).get('/api/catalog/menu/tree')).status).toBe(401);
    });
  });

  function setControl(enabled: boolean) {
    return db(
      `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'inventory_control_enabled', $2)
       ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
      [fixtures.restaurantA, String(enabled)],
    );
  }

  async function seedMenu(url: string) {
    const A = fixtures.restaurantA;
    const B = fixtures.restaurantB;
    await superuserQuery(
      url,
      `INSERT INTO users (id, email, password_hash, password_algo, is_active)
       SELECT v.id::uuid, v.email, u.password_hash, u.password_algo, true
         FROM users u, (VALUES ($1, $2), ($3, $4)) AS v(id, email) WHERE u.id = $5`,
      [m.kitchen.userId, m.kitchen.email, m.delivery.userId, m.delivery.email, fixtures.waiterA.userId],
    );
    await superuserQuery(
      url,
      `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
         ($1, $2, 'Kitchen A', $3, 'kitchen', $7), ($4, $5, 'Delivery A', $6, 'delivery_operator', $7)`,
      [m.kitchen.profileId, m.kitchen.userId, m.kitchen.email, m.delivery.profileId, m.delivery.userId, m.delivery.email, A],
    );
    await superuserQuery(
      url,
      `INSERT INTO categories (id, name, icon, active, sort_order, color, restaurant_id) VALUES
         ($1, 'Bebidas', 'cup', true, 0, 'sky', $6),
         ($2, 'Platos', 'utensils', true, 1, 'orange', $6),
         ($3, 'Postres', 'cake', true, 2, 'neutral', $6),
         ($4, 'Oculta', 'eye', false, 3, 'neutral', $6),
         ($5, 'Otra', 'x', true, 0, 'neutral', $7)`,
      [m.drinks, m.mains, m.desserts, m.hidden, m.categoryB, A, B],
    );
    await superuserQuery(
      url,
      `INSERT INTO subcategories (id, category_id, name, sort_order, active, restaurant_id) VALUES
         ($1, $6, 'Parrilla', 0, true, $9),
         ($2, $6, 'Sopas', 1, true, $9),
         ($3, $6, 'Viejos', 2, false, $9),
         ($4, $7, 'Gaseosas', 0, true, $9),
         ($5, $8, 'Sub B', 0, true, $10)`,
      [m.grill, m.soups, m.retired, m.sodas, m.subB, m.mains, m.drinks, m.categoryB, A, B],
    );
    await superuserQuery(
      url,
      `INSERT INTO dishes (id, name, price, category_id, subcategory_id, active, restaurant_id) VALUES
         ($1, 'Churrasco', 30000, $8, $10, true, $15),
         ($2, 'Ajiaco', 20000, $8, $11, true, $15),
         ($3, 'Cola', 5000, $9, $13, true, $15),
         ($4, 'Flan', 8000, $14, NULL, true, $15),
         ($5, 'Viejo', 1000, $8, $12, true, $15),
         ($6, 'Apagado', 1000, $8, $10, false, $15),
         ($7, 'Plato B', 9000, $16, $17, true, $18)`,
      [m.steak, m.ajiaco, m.cola, m.flan, m.oldDish, m.offDish, m.dishB, m.mains, m.drinks, m.grill, m.soups, m.retired, m.sodas, m.desserts, A, m.categoryB, m.subB, B],
    );
    await superuserQuery(
      url,
      `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, end_date, active, restaurant_id)
       VALUES ($1, 'Mediodía', 'percentage', 10, now() - interval '1 day', now() + interval '1 day', true, $2)`,
      [m.promo, A],
    );
    await superuserQuery(url, 'INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1, $2, $3)', [m.promo, m.ajiaco, A]);
    await superuserQuery(url, `INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Leche', 'l', $2)`, [m.milk, A]);
  }

  beforeAll(async () => {
    // Flan needs milk the restaurant does not have: unavailable while inventory control is on.
    const res = await adminA().put('/api/inventory/formulas', {
      targetType: 'dish', targetId: m.flan, yieldQuantity: 1, lines: [{ ingredientId: m.milk, quantity: 1 }],
    });
    expect(res.status).toBe(200);
  });
});
