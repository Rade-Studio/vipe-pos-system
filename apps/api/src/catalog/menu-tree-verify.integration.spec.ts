import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Independent T8 verifier probes (S5, S3, S8). */
const v = {
  c1: 'da000000-0000-0000-0000-000000000001', // Platos, split
  c2: 'da000000-0000-0000-0000-000000000002', // Bebidas, plain
  c3: 'da000000-0000-0000-0000-000000000003', // empty subcategory only
  c4: 'da000000-0000-0000-0000-000000000004', // only an inactive dish in a subcategory
  c5: 'da000000-0000-0000-0000-000000000005', // inactive category
  cB: 'da000000-0000-0000-0000-0000000000b1',
  s1: 'db000000-0000-0000-0000-000000000001',
  s2: 'db000000-0000-0000-0000-000000000002',
  s3: 'db000000-0000-0000-0000-000000000003', // c3 empty
  s4: 'db000000-0000-0000-0000-000000000004', // c4
  sOff: 'db000000-0000-0000-0000-000000000005', // c1 inactive
  sB: 'db000000-0000-0000-0000-0000000000b1',
  d1: 'dc000000-0000-0000-0000-000000000001',
  d2: 'dc000000-0000-0000-0000-000000000002',
  d3: 'dc000000-0000-0000-0000-000000000003',
  d4: 'dc000000-0000-0000-0000-000000000004', // c4 inactive dish in s4
  d5: 'dc000000-0000-0000-0000-000000000005', // uncategorised active
  d6: 'dc000000-0000-0000-0000-000000000006', // in inactive category
  d7: 'dc000000-0000-0000-0000-000000000007', // in sOff
  dB: 'dc000000-0000-0000-0000-0000000000b1',
  promo: 'dd000000-0000-0000-0000-000000000001',
  ing: 'de000000-0000-0000-0000-000000000001',
  kitchen: { userId: '1b000000-0000-0000-0000-000000000001', profileId: '2b000000-0000-0000-0000-000000000001', email: 'k2@a.test' },
  delivery: { userId: '1b000000-0000-0000-0000-000000000002', profileId: '2b000000-0000-0000-0000-000000000002', email: 'd2@a.test' },
} as const;
const OTHER_CATEGORY = 'La subcategoría no pertenece a la categoría del plato';
const NO_CATEGORY = 'Un plato sin categoría no puede tener subcategoría';
const MOVE = 'El plato está en una subcategoría de su categoría actual; elige una subcategoría de la nueva categoría o quítala';
const DUPLICATE = 'Ya existe una subcategoría con ese nombre en la categoría';
const HAS_DISHES = 'La subcategoría tiene platos; muévelos primero';
const HAS_SUBS = 'La categoría tiene subcategorías; elimínalas primero';
const BOGUS = 'deadbeef-0000-4000-8000-000000000000';

describe('T8 verifier probes', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB, fixtures.bcryptUser, v.kitchen, v.delivery]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });
  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });
  const as = (user: { email: string }) => {
    const s = request(app.getHttpServer());
    const c = cookies[user.email];
    return {
      get: (u: string) => s.get(u).set('Cookie', c),
      post: (u: string, b?: object) => s.post(u).set('Cookie', c).send(b),
      patch: (u: string, b?: object) => s.patch(u).set('Cookie', c).send(b),
      put: (u: string, b?: object) => s.put(u).set('Cookie', c).send(b),
      delete: (u: string) => s.delete(u).set('Cookie', c),
    };
  };
  const A = () => as(fixtures.adminA);
  const B = () => as(fixtures.adminB);
  const staff = () => [as(fixtures.waiterA), as(fixtures.bcryptUser), as(v.kitchen), as(v.delivery)];
  const db = <T = Record<string, unknown>>(t: string, vals: unknown[] = []) => superuserQuery<T>(database.superuserUrl, t, vals);
  const md5 = async () =>
    (await db<{ h: string }>(`SELECT md5(
      (SELECT coalesce(string_agg(c::text, '|' ORDER BY c.id), '') FROM categories c) ||
      (SELECT coalesce(string_agg(s::text, '|' ORDER BY s.id), '') FROM subcategories s) ||
      (SELECT coalesce(string_agg(d::text, '|' ORDER BY d.id), '') FROM dishes d)) AS h`))[0].h;
  const ids = (b: { id: string }[]) => b.map((r) => r.id);

  it('P1 roles: reads for every staff role, every write 403 and data byte-identical', async () => {
    for (const u of staff()) {
      expect((await u.get('/api/catalog/menu/tree')).status).toBe(200);
      expect((await u.get('/api/catalog/subcategories')).status).toBe(200);
      expect((await u.get(`/api/catalog/subcategories?categoryId=${v.c1}&includeInactive=false`)).status).toBe(200);
      expect((await u.get('/api/catalog/subcategories?includeInactive=true')).status).toBe(403);
    }
    const before = await md5();
    for (const u of staff()) {
      const statuses = [
        (await u.put('/api/catalog/categories/order', { ids: [v.c2, v.c1] })).status,
        (await u.patch(`/api/catalog/categories/${v.c1}`, { color: 'rose' })).status,
        (await u.patch(`/api/catalog/categories/${v.c1}`, { sortOrder: 9 })).status,
        (await u.post('/api/catalog/categories', { name: 'Z', icon: 'z', color: 'rose', sortOrder: 1 })).status,
        (await u.post('/api/catalog/subcategories', { categoryId: v.c1, name: 'Staff' })).status,
        (await u.patch(`/api/catalog/subcategories/${v.s1}`, { name: 'Staff', sortOrder: 5, active: false })).status,
        (await u.delete(`/api/catalog/subcategories/${v.s3}`)).status,
        (await u.put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.s2, v.s1] })).status,
        (await u.patch(`/api/catalog/dishes/${v.d1}`, { subcategoryId: v.s2 })).status,
        (await u.post('/api/catalog/dishes', { name: 'Z', price: 1, categoryId: v.c1, subcategoryId: v.s1 })).status,
      ];
      expect(statuses).toEqual(Array(10).fill(403));
    }
    expect(await md5()).toBe(before);
  });

  it('P2 tenant isolation: B never sees or changes A', async () => {
    const before = await md5();
    expect((await B().get(`/api/catalog/subcategories?categoryId=${v.c1}&includeInactive=true`)).body).toEqual([]);
    expect((await B().get(`/api/catalog/dishes?subcategoryId=${v.s1}`)).body).toEqual([]);
    const tree = (await B().get('/api/catalog/menu/tree')).body;
    expect(ids(tree.categories)).toEqual([v.cB]);
    expect(JSON.stringify(tree)).not.toContain('da000000-0000-0000-0000-00000000000');
    const r = [
      await B().put('/api/catalog/categories/order', { ids: [v.cB, v.c1] }),
      await B().put('/api/catalog/categories/order', { ids: [v.c1] }),
      await B().patch(`/api/catalog/categories/${v.c1}`, { color: 'rose', sortOrder: 7 }),
      await B().delete(`/api/catalog/categories/${v.c3}`),
      await B().post('/api/catalog/subcategories', { categoryId: v.c1, name: 'B en A' }),
      await B().patch(`/api/catalog/subcategories/${v.s1}`, { sortOrder: 9 }),
      await B().delete(`/api/catalog/subcategories/${v.s3}`),
      await B().put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.s1] }),
      await B().put('/api/catalog/subcategories/order', { categoryId: v.cB, ids: [v.sB, v.s1] }),
      await B().post('/api/catalog/dishes', { name: 'X', price: 1, categoryId: v.cB, subcategoryId: v.s1 }),
      await B().patch(`/api/catalog/dishes/${v.dB}`, { subcategoryId: v.s1 }),
      await B().patch(`/api/catalog/dishes/${v.d1}`, { subcategoryId: null }),
    ];
    expect(r.map((x) => x.status)).toEqual([422, 422, 404, 404, 422, 404, 404, 422, 422, 422, 422, 404]);
    expect(r[0].body.message).toBe('Unknown category');
    expect(r[4].body.message).toBe('Unknown category');
    expect(r[7].body.message).toBe('Unknown subcategory');
    expect(r[9].body.message).toBe(OTHER_CATEGORY);
    expect(r[10].body.message).toBe(OTHER_CATEGORY);
    expect(await md5()).toBe(before);
  });

  it('P3 atomic reorders; duplicates/empty refused; subset semantics', async () => {
    const before = await md5();
    const bad = [
      await A().put('/api/catalog/categories/order', { ids: [v.c3, v.c2, v.c1, BOGUS] }),
      await A().put('/api/catalog/categories/order', { ids: [v.c2, v.c2] }),
      await A().put('/api/catalog/categories/order', { ids: [] }),
      await A().put('/api/catalog/categories/order', { ids: ['nope'] }),
      await A().put('/api/catalog/categories/order', { ids: [v.c2], extra: 1 }),
      await A().put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.sOff, v.s2, v.s1, v.s3] }),
      await A().put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.s2, v.s2] }),
      await A().put('/api/catalog/subcategories/order', { categoryId: BOGUS, ids: [v.s1] }),
      await A().put('/api/catalog/subcategories/order', { ids: [v.s1] }),
    ];
    expect(bad.map((x) => x.status)).toEqual(Array(9).fill(422));
    expect(bad[0].body.message).toBe('Unknown category');
    expect(bad[5].body.message).toBe('Unknown subcategory');
    expect(await md5()).toBe(before);
    // subset: listed ids get 0..n-1, others keep theirs
    const subset = await A().put('/api/catalog/categories/order', { ids: [v.c4] });
    expect(subset.status).toBe(200);
    const rows = await db<{ id: string; sort_order: number }>('SELECT id, sort_order FROM categories WHERE id = ANY($1) ORDER BY id', [[v.c1, v.c2, v.c3, v.c4, v.c5]]);
    expect(rows.map((x) => x.sort_order)).toEqual([0, 1, 2, 0, 4]);
    await A().put('/api/catalog/categories/order', { ids: [v.c1, v.c2, v.c3, v.c4, v.c5] });
    const subSubset = await A().put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.s2] });
    expect(subSubset.status).toBe(200);
    expect(ids(subSubset.body)).toContain(v.sOff);
    await A().put('/api/catalog/subcategories/order', { categoryId: v.c1, ids: [v.s1, v.s2, v.sOff] });
    expect(await md5()).not.toBe(''); // order restored above
  });

  it('P4 dish rules with Spanish messages, no write on 422, no 500 under a race', async () => {
    const before = await md5();
    const r = [
      await A().patch(`/api/catalog/dishes/${v.d1}`, { categoryId: v.c2 }),
      await A().patch(`/api/catalog/dishes/${v.d1}`, { categoryId: v.c2, subcategoryId: v.s1 }),
      await A().patch(`/api/catalog/dishes/${v.d1}`, { categoryId: null }),
      await A().patch(`/api/catalog/dishes/${v.d2}`, { subcategoryId: v.s1 }),
      await A().patch(`/api/catalog/dishes/${v.d5}`, { subcategoryId: v.s1 }),
      await A().post('/api/catalog/dishes', { name: 'X', price: 1, categoryId: null, subcategoryId: v.s1 }),
      await A().post('/api/catalog/dishes', { name: 'X', price: 1, categoryId: v.c2, subcategoryId: BOGUS }),
      await A().patch(`/api/catalog/dishes/${v.d1}`, { subcategoryId: 'nope' }),
    ];
    expect(r.map((x) => x.status)).toEqual([422, 422, 422, 422, 422, 422, 422, 422]);
    expect(r.slice(0, 7).map((x) => x.body.message)).toEqual([MOVE, OTHER_CATEGORY, NO_CATEGORY, OTHER_CATEGORY, NO_CATEGORY, NO_CATEGORY, OTHER_CATEGORY]);
    expect(await md5()).toBe(before);
    // race: delete a fresh subcategory while a dish moves into it
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const sub = await A().post('/api/catalog/subcategories', { categoryId: v.c1, name: `Race ${i}` });
      const [del, mv] = await Promise.all([
        A().delete(`/api/catalog/subcategories/${sub.body.id}`),
        A().patch(`/api/catalog/dishes/${v.d3}`, { subcategoryId: sub.body.id }),
      ]);
      statuses.push(del.status, mv.status);
      await A().patch(`/api/catalog/dishes/${v.d3}`, { subcategoryId: v.s2 });
      await db('DELETE FROM subcategories WHERE id = $1', [sub.body.id]);
    }
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
  });

  it('P5 409s: trimmed case-insensitive duplicate, subcategory with (inactive) dishes, category with subcategories', async () => {
    const before = await md5();
    const dup = await A().post('/api/catalog/subcategories', { categoryId: v.c1, name: '  PARRILLA  ' });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ statusCode: 409, error: 'Conflict', message: DUPLICATE });
    expect((await A().patch(`/api/catalog/subcategories/${v.s2}`, { name: ' parrilla' })).body.message).toBe(DUPLICATE);
    // dup against an inactive one too
    expect((await A().post('/api/catalog/subcategories', { categoryId: v.c1, name: 'viejos' })).status).toBe(409);
    const withInactiveDish = await A().delete(`/api/catalog/subcategories/${v.s4}`);
    expect(withInactiveDish.status).toBe(409);
    expect(withInactiveDish.body.message).toBe(HAS_DISHES);
    const cat = await A().delete(`/api/catalog/categories/${v.c3}`);
    expect(cat.status).toBe(409);
    expect(cat.body).toEqual({ statusCode: 409, error: 'Conflict', message: HAS_SUBS });
    expect(await md5()).toBe(before);
    const self = await A().patch(`/api/catalog/subcategories/${v.s1}`, { name: 'PARRILLA' });
    expect(self.status).toBe(200);
    await A().patch(`/api/catalog/subcategories/${v.s1}`, { name: 'Parrilla' });
  });

  it('P6 tree: order, pricing/availability = existing endpoints, omissions, hasSubcategories, waiter = delivery', async () => {
    await db(`INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'inventory_control_enabled', 'true')
      ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`, [fixtures.restaurantA]);
    const waiter = (await as(fixtures.waiterA).get('/api/catalog/menu/tree')).body;
    const delivery = (await as(v.delivery).get('/api/catalog/menu/tree')).body;
    expect(delivery).toEqual(waiter);
    expect(ids(waiter.categories)).toEqual([v.c1, v.c2, v.c3, v.c4]);
    const byId = Object.fromEntries(waiter.categories.map((c: { id: string }) => [c.id, c]));
    expect(byId[v.c1].hasSubcategories).toBe(true);
    expect(byId[v.c2].hasSubcategories).toBe(false);
    expect(byId[v.c3].hasSubcategories).toBe(false); // empty subcategory does not count
    expect(byId[v.c4].hasSubcategories).toBe(true); // inactive dish counts
    expect(ids(byId[v.c1].subcategories)).toEqual([v.s1, v.s2]);
    expect(ids(byId[v.c3].subcategories)).toEqual([v.s3]);
    const treeDishes = waiter.categories.flatMap((c: { dishes: object[] }) => c.dishes);
    expect(ids(treeDishes)).not.toContain(v.d7);
    expect(ids(treeDishes)).not.toContain(v.d4);
    expect(ids(treeDishes)).not.toContain(v.d6);
    const legacy = (await as(fixtures.waiterA).get('/api/catalog/dishes?active=true&pricing=promotions')).body;
    const avail = (await as(fixtures.waiterA).post('/api/inventory/dish-availability', { dishIds: ids(legacy) })).body;
    for (const d of treeDishes as { id: string; available: boolean }[]) {
      const { available, ...rest } = d;
      expect(rest).toEqual(legacy.find((x: { id: string }) => x.id === d.id));
      expect(available).toBe(avail[d.id]);
    }
    expect(treeDishes.find((d: { id: string }) => d.id === v.d2).available).toBe(false);
    expect(treeDishes.find((d: { id: string }) => d.id === v.d1)).toMatchObject({ price: 9000, originalPrice: 10000 });
    // ordering of dishes by name within a category
    expect(byId[v.c1].dishes.map((d: { name: string }) => d.name)).toEqual(['Ajiaco', 'Churrasco']);
    // S8 advisory probe: an active uncategorised dish appears in the legacy list but not in the tree
    expect(ids(legacy)).toContain(v.d5);
    expect(ids(treeDishes)).not.toContain(v.d5);
  });

  async function seed(url: string) {
    const a = fixtures.restaurantA;
    const b = fixtures.restaurantB;
    await superuserQuery(url, `INSERT INTO users (id, email, password_hash, password_algo, is_active)
      SELECT x.id::uuid, x.email, u.password_hash, u.password_algo, true FROM users u, (VALUES ($1, $2), ($3, $4)) AS x(id, email) WHERE u.id = $5`,
      [v.kitchen.userId, v.kitchen.email, v.delivery.userId, v.delivery.email, fixtures.waiterA.userId]);
    await superuserQuery(url, `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
      ($1, $2, 'K', $3, 'kitchen', $7), ($4, $5, 'D', $6, 'delivery_operator', $7)`,
      [v.kitchen.profileId, v.kitchen.userId, v.kitchen.email, v.delivery.profileId, v.delivery.userId, v.delivery.email, a]);
    await superuserQuery(url, `INSERT INTO categories (id, name, icon, active, sort_order, color, restaurant_id) VALUES
      ($1, 'Platos', 'u', true, 0, 'orange', $7), ($2, 'Bebidas', 'c', true, 1, 'sky', $7), ($3, 'Vacía', 'v', true, 2, 'neutral', $7),
      ($4, 'Inactivos', 'i', true, 3, 'neutral', $7), ($5, 'Oculta', 'o', false, 4, 'neutral', $7), ($6, 'Otra', 'x', true, 0, 'neutral', $8)`,
      [v.c1, v.c2, v.c3, v.c4, v.c5, v.cB, a, b]);
    await superuserQuery(url, `INSERT INTO subcategories (id, category_id, name, sort_order, active, restaurant_id) VALUES
      ($1, $7, 'Parrilla', 0, true, $10), ($2, $7, 'Sopas', 1, true, $10), ($3, $8, 'Sola', 0, true, $10),
      ($4, $9, 'Sub4', 0, true, $10), ($5, $7, 'Viejos', 2, false, $10), ($6, $11, 'Sub B', 0, true, $12)`,
      [v.s1, v.s2, v.s3, v.s4, v.sOff, v.sB, v.c1, v.c3, v.c4, a, v.cB, b]);
    await superuserQuery(url, `INSERT INTO dishes (id, name, price, category_id, subcategory_id, active, restaurant_id) VALUES
      ($1, 'Ajiaco', 10000, $9, $10, true, $8), ($2, 'Cola', 5000, $11, NULL, true, $8), ($3, 'Churrasco', 30000, $9, $12, true, $8),
      ($4, 'Off', 1000, $13, $14, false, $8), ($5, 'Suelto', 1000, NULL, NULL, true, $8), ($6, 'Escondido', 1000, $15, NULL, true, $8),
      ($7, 'Retirado', 1000, $9, $16, true, $8)`,
      [v.d1, v.d2, v.d3, v.d4, v.d5, v.d6, v.d7, a, v.c1, v.s1, v.c2, v.s2, v.c4, v.s4, v.c5, v.sOff]);
    await superuserQuery(url, `INSERT INTO dishes (id, name, price, category_id, subcategory_id, active, restaurant_id) VALUES ($1, 'B', 1, $2, $3, true, $4)`, [v.dB, v.cB, v.sB, b]);
    await superuserQuery(url, `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, end_date, active, restaurant_id)
      VALUES ($1, 'P', 'percentage', 10, now() - interval '1 day', now() + interval '1 day', true, $2)`, [v.promo, a]);
    await superuserQuery(url, 'INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1, $2, $3)', [v.promo, v.d1, a]);
    await superuserQuery(url, `INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Leche', 'l', $2)`, [v.ing, a]);
  }

  beforeAll(async () => {
    const res = await A().put('/api/inventory/formulas', { targetType: 'dish', targetId: v.d2, yieldQuantity: 1, lines: [{ ingredientId: v.ing, quantity: 1 }] });
    expect(res.status).toBe(200);
  });
});
