import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Menu publication rows (T20, S5/S8) seeded as the superuser for this spec only. */
const p = {
  drinks: 'da000000-0000-0000-0000-000000000001',
  mains: 'da000000-0000-0000-0000-000000000002',
  grill: 'db000000-0000-0000-0000-000000000001',
  water: 'dc000000-0000-0000-0000-000000000001',
  coffee: 'dc000000-0000-0000-0000-000000000002',
  steak: 'dc000000-0000-0000-0000-000000000003',
  loose: 'dc000000-0000-0000-0000-000000000004',
  looseOff: 'dc000000-0000-0000-0000-000000000005',
  wings: 'dc000000-0000-0000-0000-000000000006',
  categoryB: 'da000000-0000-0000-0000-0000000000b1',
  dishB: 'dc000000-0000-0000-0000-0000000000b1',
} as const;

const PUBLISH_FORBIDDEN = 'Solo un administrador puede publicar el menú';

describe('menu publication and dish order (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
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
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const publications = async () =>
    (await db<{ n: number }>('SELECT count(*)::int AS n FROM menu_publications WHERE restaurant_id = $1', [fixtures.restaurantA]))[0].n;
  const sortOrders = async (dishIds: string[]) =>
    (await db<{ id: string; sort_order: number }>('SELECT id, sort_order FROM dishes WHERE id = ANY($1) ORDER BY id', [dishIds]))
      .map((row) => [row.id, row.sort_order]);
  const tree = async () => {
    const res = await waiterA().get('/api/catalog/menu/tree');
    expect(res.status).toBe(200);
    return res.body;
  };

  describe('before the first publication', () => {
    it('serves the live tree: dishes by sortOrder then name, modifier groups, loose dishes with availability', async () => {
      const body = await tree();
      expect(ids(body.categories)).toEqual([p.drinks, p.mains]);
      expect(ids(body.categories[0].dishes)).toEqual([p.coffee, p.water]);
      expect(body.categories[0].dishes[0]).toMatchObject({ name: 'Café', sortOrder: 0, modifierGroups: [], available: true });
      expect(body.categories[0].dishes[1]).toMatchObject({ name: 'Agua', sortOrder: 1, modifierGroups: [] });
      expect(body.uncategorized).toEqual([expect.objectContaining({ id: p.loose, categoryId: null, available: true })]);
    });

    it('reports no publication and nothing pending', async () => {
      const res = await adminA().get('/api/catalog/menu/publication');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publishedAt: null, publishedByName: null, pendingChanges: 0 });
    });
  });

  describe('publish', () => {
    it('refuses every role but admin with 403 in Spanish and stores nothing', async () => {
      const res = await waiterA().post('/api/catalog/menu/publish');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(PUBLISH_FORBIDDEN);
      expect(await publications()).toBe(0);
      expect((await waiterA().get('/api/catalog/menu/publication')).status).toBe(403);
      expect((await waiterA().get('/api/catalog/menu/draft')).status).toBe(403);
    });

    it('publishes as the admin and returns the new status', async () => {
      const res = await adminA().post('/api/catalog/menu/publish');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ publishedByName: 'Admin A', pendingChanges: 0 });
      expect(Date.parse(res.body.publishedAt)).not.toBeNaN();
      expect(await publications()).toBe(1);
      expect((await adminA().get('/api/catalog/menu/publication')).body).toEqual(res.body);
    });
  });

  describe('published vs live', () => {
    it('keeps the published structure until the next publication; price stays live', async () => {
      expect((await adminA().patch(`/api/catalog/categories/${p.drinks}`, { name: 'Bebidas frías' })).status).toBe(200);
      expect((await adminA().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.water, p.coffee] })).status).toBe(200);
      const added = await adminA().post('/api/catalog/categories', { name: 'Entradas', icon: 'utensils' });
      expect(added.status).toBe(201);
      const wings = await adminA().post('/api/catalog/dishes', { name: 'Alitas', price: 9000, categoryId: p.drinks });
      expect(wings.status).toBe(201);
      expect(wings.body.sortOrder).toBe(2);
      expect((await adminA().delete(`/api/catalog/dishes/${p.steak}`)).status).toBe(204);
      expect((await adminA().patch(`/api/catalog/dishes/${p.coffee}`, { price: 4500 })).status).toBe(200);

      const body = await tree();
      expect(ids(body.categories)).toEqual([p.drinks, p.mains]);
      expect(body.categories[0].name).toBe('Bebidas');
      expect(ids(body.categories[0].dishes)).toEqual([p.coffee, p.water]);
      expect(body.categories[0].dishes[0]).toMatchObject({ price: 4500 });
      expect(body.categories[1].dishes).toEqual([]);

      // rename 1 + two dish orders + new category + new dish + deleted dish
      expect((await adminA().get('/api/catalog/menu/publication')).body.pendingChanges).toBe(6);

      const draft = await adminA().get('/api/catalog/menu/draft');
      expect(draft.status).toBe(200);
      expect(draft.body.categories.map((category: { name: string }) => category.name)).toEqual(['Bebidas frías', 'Platos', 'Entradas']);
      expect(ids(draft.body.categories[0].dishes)).toEqual([p.water, p.coffee, wings.body.id]);

      const published = await adminA().post('/api/catalog/menu/publish');
      expect(published.body.pendingChanges).toBe(0);
      const after = await tree();
      expect(after.categories.map((category: { name: string }) => category.name)).toEqual(['Bebidas frías', 'Platos', 'Entradas']);
      expect(ids(after.categories[0].dishes)).toEqual([p.water, p.coffee, wings.body.id]);
      expect(after).toEqual(draft.body);
    });

    it('hides a new loose dish until published and drops a deleted one', async () => {
      const extra = await adminA().post('/api/catalog/dishes', { name: 'Postre suelto', price: 3000 });
      expect(extra.status).toBe(201);
      expect(ids((await tree()).uncategorized)).toEqual([p.loose]);
      await adminA().post('/api/catalog/menu/publish');
      expect(ids((await tree()).uncategorized).sort()).toEqual([p.loose, extra.body.id].sort());
      expect((await adminA().delete(`/api/catalog/dishes/${extra.body.id}`)).status).toBe(204);
      expect(ids((await tree()).uncategorized)).toEqual([p.loose]);
    });

    it('takes category and subcategory active flags from the publication; any role header is ignored', async () => {
      expect((await adminA().patch(`/api/catalog/categories/${p.mains}`, { active: false })).status).toBe(200);
      expect((await adminA().patch(`/api/catalog/subcategories/${p.grill}`, { active: false })).status).toBe(200);
      const kept = await tree();
      expect(ids(kept.categories)).toContain(p.mains);
      expect(ids(kept.categories.find((c: { id: string }) => c.id === p.mains).subcategories)).toEqual([p.grill]);
      expect((await as(fixtures.waiterA).get('/api/catalog/menu/tree')).body).toEqual(kept);
      const forged = await waiterA().post('/api/catalog/menu/publish').set('x-role', 'admin');
      expect([forged.status, forged.body.message]).toEqual([403, PUBLISH_FORBIDDEN]);
      await adminA().post('/api/catalog/menu/publish');
      expect(ids((await tree()).categories)).not.toContain(p.mains);
      await adminA().patch(`/api/catalog/categories/${p.mains}`, { active: true });
      expect(ids((await tree()).categories)).not.toContain(p.mains);
      await adminA().patch(`/api/catalog/subcategories/${p.grill}`, { active: true });
      await adminA().post('/api/catalog/menu/publish');
    });

    it("never shows restaurant A's publication to restaurant B", async () => {
      const res = await adminB().get('/api/catalog/menu/tree');
      expect(ids(res.body.categories)).toEqual([p.categoryB]);
      expect(ids(res.body.categories[0].dishes)).toEqual([p.dishB]);
      expect((await adminB().get('/api/catalog/menu/publication')).body).toEqual({ publishedAt: null, publishedByName: null, pendingChanges: 0 });
    });
  });

  describe('PUT /catalog/dishes/order', () => {
    it('reorders the dishes of a group and returns them, inactive included', async () => {
      const before = await sortOrders([p.loose, p.looseOff]);
      const res = await adminA().put('/api/catalog/dishes/order', { categoryId: null, subcategoryId: null, ids: [p.looseOff, p.loose] });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([p.looseOff, p.loose]);
      expect(before).not.toEqual(await sortOrders([p.loose, p.looseOff]));
    });

    it('saves nothing when an id is of another group or restaurant, repeated, or the caller is not an admin', async () => {
      const before = await sortOrders([p.water, p.coffee, p.loose]);
      const foreign = await adminA().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.coffee, p.dishB] });
      expect(foreign.status).toBe(422);
      expect(foreign.body.message).toBe('Unknown dish');
      const otherGroup = await adminA().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.coffee, p.loose] });
      expect(otherGroup.status).toBe(422);
      expect((await adminA().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.coffee, p.coffee] })).status).toBe(422);
      expect((await adminB().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.coffee, p.water] })).status).toBe(422);
      expect((await waiterA().put('/api/catalog/dishes/order', { categoryId: p.drinks, subcategoryId: null, ids: [p.coffee, p.water] })).status).toBe(403);
      expect(await sortOrders([p.water, p.coffee, p.loose])).toEqual(before);
    });
  });

  describe('moving a dish to another group', () => {
    it('places it after the last dish of the new group', async () => {
      expect(await sortOrders([p.loose, p.looseOff])).toEqual([[p.loose, 1], [p.looseOff, 0]]);
      const res = await adminA().patch(`/api/catalog/dishes/${p.water}`, { categoryId: null });
      expect(res.status).toBe(200);
      expect(res.body.sortOrder).toBe(2);
      expect(ids((await adminA().get('/api/catalog/menu/draft')).body.uncategorized)).toEqual([p.loose, p.water]);
      const same = await adminA().patch(`/api/catalog/dishes/${p.water}`, { categoryId: null, price: 3100 });
      expect(same.body.sortOrder).toBe(2);
      const back = await adminA().patch(`/api/catalog/dishes/${p.water}`, { categoryId: p.drinks });
      expect(back.body.sortOrder).toBe(3);
    });
  });

  describe('quick notes (removed in F7)', () => {
    it('refuses quickNotes as an unknown field and the dish no longer carries it', async () => {
      const res = await adminA().patch(`/api/catalog/dishes/${p.water}`, { quickNotes: ['Sin hielo'] });
      expect(res.status).toBe(422);
      expect((await adminA().post('/api/catalog/dishes', { name: 'Nuevo', price: 1, quickNotes: [] })).status).toBe(422);
      const dish = (await adminA().get('/api/catalog/dishes')).body.find((d: { id: string }) => d.id === p.water);
      expect(dish).not.toHaveProperty('quickNotes');
    });
  });
});

async function seed(url: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(url, text, values);
  await q(
    `INSERT INTO categories (id, name, icon, sort_order, restaurant_id) VALUES
       ($1, 'Bebidas', 'coffee', 0, $4), ($2, 'Platos', 'utensils', 1, $4), ($3, 'Categoría B', 'utensils', 0, $5)`,
    [p.drinks, p.mains, p.categoryB, A, B],
  );
  await q(`INSERT INTO subcategories (id, category_id, name, restaurant_id) VALUES ($1, $2, 'Parrilla', $3)`, [p.grill, p.mains, A]);
  await q(
    `INSERT INTO dishes (id, name, price, category_id, subcategory_id, sort_order, active, restaurant_id) VALUES
       ($1, 'Agua', 3000, $7, NULL, 1, true, $9),
       ($2, 'Café', 4000, $7, NULL, 0, true, $9),
       ($3, 'Lomo', 30000, $8, $10, 0, true, $9),
       ($4, 'Suelto', 2000, NULL, NULL, 0, true, $9),
       ($5, 'Suelto apagado', 2000, NULL, NULL, 1, false, $9),
       ($6, 'Plato B', 1000, $11, NULL, 0, true, $12)`,
    [p.water, p.coffee, p.steak, p.loose, p.looseOff, p.dishB, p.drinks, p.mains, A, p.grill, p.categoryB, B],
  );
}
