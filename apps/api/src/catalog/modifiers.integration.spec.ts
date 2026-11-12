import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';
import { MODIFIER_MESSAGES } from './modifiers.dto';

/** F7 rows seeded as the superuser for this spec only. */
const m = {
  burger: 'f7000000-0000-0000-0000-000000000001',
  lemonade: 'f7000000-0000-0000-0000-000000000002',
  promoBurger: 'f7000000-0000-0000-0000-000000000003',
  dishB: 'f7000000-0000-0000-0000-0000000000b1',
  doneness: 'f7100000-0000-0000-0000-000000000001',
  extras: 'f7100000-0000-0000-0000-000000000002',
  sauces: 'f7100000-0000-0000-0000-000000000003',
  groupB: 'f7100000-0000-0000-0000-0000000000b1',
  medium: 'f7200000-0000-0000-0000-000000000011',
  wellDone: 'f7200000-0000-0000-0000-000000000012',
  bacon: 'f7200000-0000-0000-0000-000000000021',
  cheese: 'f7200000-0000-0000-0000-000000000022',
  egg: 'f7200000-0000-0000-0000-000000000023',
  pineapple: 'f7200000-0000-0000-0000-000000000024',
  bbq: 'f7200000-0000-0000-0000-000000000031',
  optionB: 'f7200000-0000-0000-0000-0000000000b1',
  t1: 'f7300000-0000-0000-0000-000000000001',
  t2: 'f7300000-0000-0000-0000-000000000002',
  t3: 'f7300000-0000-0000-0000-000000000003',
  t4: 'f7300000-0000-0000-0000-000000000004',
  t5: 'f7300000-0000-0000-0000-000000000005',
  flour: 'f7400000-0000-0000-0000-000000000001',
} as const;

const opt = (...ids: string[]) => ids.map((optionId) => ({ optionId }));

describe('priced modifiers (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const count = async (table: string) => Number((await db<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);

  describe('catalog: groups, options and dish assignment', () => {
    it('lets an admin create a group, deriving minSelect from required', async () => {
      const res = await adminA().post('/api/catalog/modifier-groups', { name: 'Punto de la carne', required: true, maxSelect: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Punto de la carne', required: true, minSelect: 1, maxSelect: 1, isActive: true, options: [] });
      expect(res.body.sortOrder).toBe(3);
    });

    it('refuses a duplicate name ignoring case with 409 in Spanish', async () => {
      const res = await adminA().post('/api/catalog/modifier-groups', { name: 'término' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(MODIFIER_MESSAGES.duplicateGroup);
    });

    it.each([
      ['an optional group with a minimum', { name: 'X1', required: false, minSelect: 1 }, MODIFIER_MESSAGES.required],
      ['a maximum under the minimum', { name: 'X2', minSelect: 3, maxSelect: 2 }, MODIFIER_MESSAGES.minMax],
    ])('refuses %s with 422 and writes nothing', async (_label, body, message) => {
      const before = await count('modifier_groups');
      const res = await adminA().post('/api/catalog/modifier-groups', body);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(await count('modifier_groups')).toBe(before);
    });

    it('keeps every write admin-only and lets staff read active groups only', async () => {
      const before = await count('modifier_groups');
      expect((await waiterA().post('/api/catalog/modifier-groups', { name: 'Mesero' })).status).toBe(403);
      expect((await waiterA().patch(`/api/catalog/modifier-groups/${m.extras}`, { name: 'Otro' })).status).toBe(403);
      expect((await waiterA().delete(`/api/catalog/modifier-groups/${m.extras}`)).status).toBe(403);
      expect((await waiterA().post(`/api/catalog/modifier-groups/${m.extras}/options`, { name: 'Y', price: 1 })).status).toBe(403);
      expect((await waiterA().patch(`/api/catalog/modifier-options/${m.cheese}`, { price: 1 })).status).toBe(403);
      expect((await waiterA().delete(`/api/catalog/modifier-options/${m.cheese}`)).status).toBe(403);
      expect((await waiterA().put(`/api/catalog/dishes/${m.burger}/modifier-groups`, { groupIds: [] })).status).toBe(403);
      expect((await waiterA().get('/api/catalog/modifier-groups?includeInactive=true')).status).toBe(403);
      expect(await count('modifier_groups')).toBe(before);
      const list = await waiterA().get('/api/catalog/modifier-groups');
      expect(list.status).toBe(200);
      expect(list.body.map((g: { id: string }) => g.id)).not.toContain(m.sauces);
      const extras = list.body.find((g: { id: string }) => g.id === m.extras);
      expect(extras.options.map((o: { name: string }) => o.name)).toEqual(['Tocineta', 'Queso', 'Huevo']);
      const all = await adminA().get('/api/catalog/modifier-groups?includeInactive=true');
      expect(all.body.map((g: { id: string }) => g.id)).toContain(m.sauces);
    });

    it('keeps another restaurant out', async () => {
      const list = await adminB().get('/api/catalog/modifier-groups');
      expect(list.body.map((g: { id: string }) => g.id)).toEqual([m.groupB]);
      expect((await adminB().patch(`/api/catalog/modifier-groups/${m.extras}`, { name: 'Robado' })).status).toBe(404);
      expect((await adminB().patch(`/api/catalog/modifier-options/${m.cheese}`, { price: 0 })).status).toBe(404);
      const assign = await adminB().put(`/api/catalog/dishes/${m.dishB}/modifier-groups`, { groupIds: [m.extras] });
      expect(assign.status).toBe(422);
      expect(assign.body.message).toBe(MODIFIER_MESSAGES.unknownGroup);
    });

    it('creates, updates and deletes options with their ingredient rule', async () => {
      const group = (await adminA().post('/api/catalog/modifier-groups', { name: 'Bebida', maxSelect: 1 })).body.id as string;
      const noQty = await adminA().post(`/api/catalog/modifier-groups/${group}/options`, { name: 'Gaseosa', price: 3000, ingredientId: m.flour });
      expect(noQty.status).toBe(422);
      expect(noQty.body.message).toBe(MODIFIER_MESSAGES.ingredient);
      expect((await adminA().post(`/api/catalog/modifier-groups/${group}/options`, { name: 'Gaseosa', price: -1 })).status).toBe(422);
      const created = await adminA().post(`/api/catalog/modifier-groups/${group}/options`, {
        name: 'Gaseosa',
        price: 3000,
        ingredientId: m.flour,
        ingredientQty: 1.5,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ groupId: group, name: 'Gaseosa', price: 3000, ingredientId: m.flour, ingredientQty: 1.5, sortOrder: 0 });
      const duplicate = await adminA().post(`/api/catalog/modifier-groups/${group}/options`, { name: 'GASEOSA', price: 0 });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe(MODIFIER_MESSAGES.duplicateOption);
      const patched = await adminA().patch(`/api/catalog/modifier-options/${created.body.id}`, { price: 3500, ingredientId: null });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ price: 3500, ingredientId: null, ingredientQty: null });
      expect((await adminA().delete(`/api/catalog/modifier-options/${created.body.id}`)).status).toBe(204);
      expect((await adminA().delete(`/api/catalog/modifier-groups/${group}`)).status).toBe(204);
      expect((await adminA().delete(`/api/catalog/modifier-groups/${group}`)).status).toBe(404);
    });

    it('assigns groups to a dish in order and serves them, active only, on the dish', async () => {
      const lemonade = `/api/catalog/dishes/${m.lemonade}/modifier-groups`;
      const set = await adminA().put(lemonade, { groupIds: [m.extras, m.sauces] });
      expect(set.status).toBe(200);
      expect(set.body).toEqual({ groupIds: [m.extras, m.sauces] });
      expect((await adminA().get(lemonade)).body).toEqual({ groupIds: [m.extras, m.sauces] });
      const dish = (await waiterA().get('/api/catalog/dishes')).body.find((d: { id: string }) => d.id === m.lemonade);
      expect(dish.modifierGroups).toEqual([
        {
          id: m.extras,
          name: 'Adiciones',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          options: [
            expect.objectContaining({ id: m.bacon, name: 'Tocineta', price: 3000 }),
            expect.objectContaining({ id: m.cheese, name: 'Queso', price: 2500 }),
            expect.objectContaining({ id: m.egg, name: 'Huevo', price: 2000 }),
          ],
        },
      ]);
      const tree = (await waiterA().get('/api/catalog/menu/tree')).body;
      const burger = tree.uncategorized.find((d: { id: string }) => d.id === m.burger);
      expect(burger.modifierGroups.map((g: { name: string }) => g.name)).toEqual(['Término', 'Adiciones']);
      expect((await adminA().put(lemonade, { groupIds: [] })).body).toEqual({ groupIds: [] });
    });
  });

  describe('table orders: server pricing and rules', () => {
    const orderOn = (tableId: string, items: object[]) => waiterA().post('/api/orders', { tableId, items });

    it.each([
      ['a required group left empty', [{ dishId: m.burger, quantity: 1 }], 'modifier_required', 'Elige al menos 1 en "Término"'],
      ['more than the maximum', [{ dishId: m.burger, quantity: 1, modifiers: opt(m.medium, m.bacon, m.cheese, m.egg) }], 'modifier_max', 'Elige máximo 2 en "Adiciones"'],
      ['an option the dish does not offer', [{ dishId: m.lemonade, quantity: 1, modifiers: opt(m.medium) }], 'modifier_invalid', undefined],
      ['an option of another restaurant', [{ dishId: m.burger, quantity: 1, modifiers: opt(m.medium, m.optionB) }], 'modifier_invalid', undefined],
      ['an inactive option', [{ dishId: m.burger, quantity: 1, modifiers: opt(m.medium, m.pineapple) }], 'modifier_inactive', undefined],
      ['an option twice', [{ dishId: m.burger, quantity: 1, modifiers: opt(m.medium, m.medium) }], 'modifier_duplicate', undefined],
    ])('refuses %s with 422 and writes nothing', async (_label, items, code, message) => {
      const before = { orders: await count('orders'), lines: await count('order_items'), mods: await count('order_item_modifiers') };
      const res = await orderOn(m.t1, items);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(code);
      if (message) expect(res.body.message).toBe(message);
      expect({ orders: await count('orders'), lines: await count('order_items'), mods: await count('order_item_modifiers') }).toEqual(before);
      expect((await db('SELECT status FROM tables WHERE id = $1', [m.t1]))[0]).toEqual({ status: 'available' });
    });

    it('charges the list dish price plus the options, the promotion as a discount, and stores the snapshot', async () => {
      const res = await orderOn(m.t2, [{ dishId: m.promoBurger, quantity: 2, unitPrice: 12500, modifiers: opt(m.cheese) }]);
      expect(res.status).toBe(201);
      // Diez 10% on the unit price with its options: 1250 per unit.
      expect(res.body).toMatchObject({ subtotal: 22500, totalDiscounts: 2500, grossSubtotal: 25000 });
      expect(res.body.items[0]).toMatchObject({
        price: 12500,
        quantity: 2,
        modifiers: [{ groupId: m.extras, groupName: 'Adiciones', optionId: m.cheese, name: 'Queso', price: 2500 }],
      });
      const add = await waiterA().post(`/api/orders/${res.body.id as string}/items`, {
        items: [{ dishId: m.burger, quantity: 1, modifiers: opt(m.bacon, m.wellDone), comments: 'Sin sal' }],
      });
      expect(add.status).toBe(201);
      expect(add.body.subtotal).toBe(45500);
      expect(add.body.items[1]).toMatchObject({ price: 23000, comments: 'Sin sal' });
      expect(add.body.items[1].modifiers.map((x: { name: string }) => x.name)).toEqual(['Bien asado', 'Tocineta']);
    });

    it('answers 409 with every line unit price when the client price is stale', async () => {
      const before = await count('order_items');
      const res = await orderOn(m.t3, [
        { dishId: m.burger, quantity: 1, unitPrice: 20000, modifiers: opt(m.medium, m.bacon) },
        { dishId: m.lemonade, quantity: 1, unitPrice: 5000 },
      ]);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Price changed',
        prices: [{ dishId: m.burger, price: 20000 }, { dishId: m.lemonade, price: 5000 }],
        lines: [{ index: 0, dishId: m.burger, unitPrice: 23000 }, { index: 1, dishId: m.lemonade, unitPrice: 5000 }],
      });
      expect(await count('order_items')).toBe(before);
    });

    it('prices an order without options exactly as before', async () => {
      const res = await orderOn(m.t4, [{ dishId: m.lemonade, quantity: 3, unitPrice: 5000 }]);
      expect(res.status).toBe(201);
      expect(res.body.subtotal).toBe(15000);
      expect(res.body.items[0]).toMatchObject({ price: 5000, modifiers: [] });
      const stale = await orderOn(m.t5, [{ dishId: m.lemonade, quantity: 1, unitPrice: 1 }]);
      expect(stale.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Price changed', prices: [{ dishId: m.lemonade, price: 5000 }] });
    });

    it('stores the modifiers of a comanda line as sent and leaves a line without them as before', async () => {
      const items = [
        { name: 'Hamburguesa', quantity: 1, dishId: m.burger, comments: 'Sin sal', modifiers: [{ group: 'Término', name: 'Medio', price: 0 }] },
        { name: 'Limonada', quantity: 1, dishId: m.lemonade },
      ];
      // #157: a comanda names its order; the latest order of this spec (restaurant A) will do.
      const [{ id: orderId }] = await db<{ id: string }>('SELECT id FROM orders ORDER BY created_at DESC LIMIT 1');
      const res = await waiterA().post('/api/print/commands', { orderId, items, table: 4 });
      expect(res.status).toBe(201);
      const [job] = await db<{ payload: { items: unknown[] } }>('SELECT payload FROM print_jobs WHERE id = $1', [res.body.id]);
      expect(job.payload.items).toEqual(items);
    });
  });

  describe('deliveries', () => {
    const delivery = (items: object[]) =>
      adminA().post('/api/delivery/orders', {
        customer: { phone: '3157778899', name: 'Carla' },
        address: { addressLine: 'Calle 7' },
        items,
        deliveryFee: 0,
        paymentMode: 'prepaid',
      });

    it('prices and stores the options and prints them on the comanda', async () => {
      const res = await delivery([
        { dishId: m.burger, quantity: 2, modifiers: opt(m.bacon, m.medium), comments: 'Bien caliente' },
        { dishId: m.lemonade, quantity: 1 },
      ]);
      expect(res.status).toBe(201);
      const orderId = res.body.orderId as string;
      const order = await adminA().get(`/api/orders/${orderId}`);
      expect(order.body.subtotal).toBe(51000);
      const burger = order.body.items.find((i: { dishId: string }) => i.dishId === m.burger);
      expect(burger.price).toBe(23000);
      expect(burger.modifiers.map((x: { name: string; price: number }) => [x.name, x.price])).toEqual([['Medio', 0], ['Tocineta', 3000]]);
      const [job] = await db<{ payload: { items: unknown[] } }>('SELECT payload FROM print_jobs WHERE id = $1', [res.body.printJob.id]);
      expect(job.payload.items).toEqual([
        {
          name: 'Hamburguesa',
          quantity: 2,
          comments: 'Bien caliente',
          modifiers: [{ group: 'Término', name: 'Medio', price: 0 }, { group: 'Adiciones', name: 'Tocineta', price: 3000 }],
        },
        { name: 'Limonada', quantity: 1 },
      ]);
    });

    it('refuses a line without its required option with 422 modifier_required and writes nothing', async () => {
      const before = { orders: await count('orders'), jobs: await count('print_jobs') };
      const res = await delivery([{ dishId: m.burger, quantity: 1 }]);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'modifier_required', message: 'Elige al menos 1 en "Término"' });
      expect({ orders: await count('orders'), jobs: await count('print_jobs') }).toEqual(before);
    });

    it('takes a delivery without options as before', async () => {
      const res = await delivery([{ dishId: m.lemonade, quantity: 2 }]);
      expect(res.status).toBe(201);
      const [row] = await db<{ subtotal: string }>('SELECT subtotal::text FROM orders WHERE id = $1', [res.body.orderId]);
      expect(row.subtotal).toBe('10000.00');
      const [job] = await db<{ payload: { items: unknown[] } }>('SELECT payload FROM print_jobs WHERE id = $1', [res.body.printJob.id]);
      expect(job.payload.items).toEqual([{ name: 'Limonada', quantity: 2 }]);
    });
  });
});

async function seed(url: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(url, text, values);
  await q(
    `INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES
       ($1, 'Hamburguesa', 20000, true, $5), ($2, 'Limonada', 5000, true, $5), ($3, 'Hamburguesa promo', 10000, true, $5),
       ($4, 'Plato B', 1000, true, $6)`,
    [m.burger, m.lemonade, m.promoBurger, m.dishB, A, B],
  );
  await q(
    `WITH p AS (INSERT INTO promotions (name, discount_type, discount_value, start_date, end_date, active, restaurant_id)
                VALUES ('Diez', 'percentage', 10, now() - interval '1 day', now() + interval '1 day', true, $2) RETURNING id)
     INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) SELECT id, $1, $2 FROM p`,
    [m.promoBurger, A],
  );
  await q(`INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Harina', 'g', $2)`, [m.flour, A]);
  await q(
    `INSERT INTO modifier_groups (id, name, required, min_select, max_select, sort_order, is_active, restaurant_id) VALUES
       ($1, 'Término', true, 1, 1, 0, true, $5), ($2, 'Adiciones', false, 0, 2, 1, true, $5),
       ($3, 'Salsas', true, 1, NULL, 2, false, $5), ($4, 'Término B', true, 1, 1, 0, true, $6)`,
    [m.doneness, m.extras, m.sauces, m.groupB, A, B],
  );
  await q(
    `INSERT INTO modifier_options (id, group_id, name, price, sort_order, is_active, restaurant_id) VALUES
       ($1, $9, 'Medio', 0, 0, true, $13), ($2, $9, 'Bien asado', 0, 1, true, $13),
       ($3, $10, 'Tocineta', 3000, 0, true, $13), ($4, $10, 'Queso', 2500, 1, true, $13), ($5, $10, 'Huevo', 2000, 2, true, $13),
       ($6, $10, 'Piña', 1000, 3, false, $13), ($7, $11, 'BBQ', 0, 0, true, $13), ($8, $12, 'Medio B', 0, 0, true, $14)`,
    [m.medium, m.wellDone, m.bacon, m.cheese, m.egg, m.pineapple, m.bbq, m.optionB, m.doneness, m.extras, m.sauces, m.groupB, A, B],
  );
  await q(
    `INSERT INTO dish_modifier_groups (dish_id, group_id, sort_order, restaurant_id) VALUES
       ($1, $3, 0, $6), ($1, $4, 1, $6), ($1, $5, 2, $6), ($2, $4, 0, $6)`,
    [m.burger, m.promoBurger, m.doneness, m.extras, m.sauces, A],
  );
  await q(
    `INSERT INTO tables (id, number, status, restaurant_id) VALUES
       ($1, 71, 'available', $6), ($2, 72, 'available', $6), ($3, 73, 'available', $6), ($4, 74, 'available', $6), ($5, 75, 'available', $6)`,
    [m.t1, m.t2, m.t3, m.t4, m.t5, A],
  );
}
