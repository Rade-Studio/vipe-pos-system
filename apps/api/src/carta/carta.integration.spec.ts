import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Carta rows seeded as the superuser for this spec only. */
const c = {
  drinks: 'c1000000-0000-0000-0000-000000000001',
  mains: 'c1000000-0000-0000-0000-000000000002',
  desserts: 'c1000000-0000-0000-0000-000000000003',
  hidden: 'c1000000-0000-0000-0000-000000000004',
  grill: 'c2000000-0000-0000-0000-000000000001',
  steak: 'c3000000-0000-0000-0000-000000000001',
  ajiaco: 'c3000000-0000-0000-0000-000000000002',
  cola: 'c3000000-0000-0000-0000-000000000003',
  flan: 'c3000000-0000-0000-0000-000000000004',
  off: 'c3000000-0000-0000-0000-000000000005',
  inHidden: 'c3000000-0000-0000-0000-000000000006',
  loose: 'c3000000-0000-0000-0000-000000000007',
  dishB: 'c3000000-0000-0000-0000-0000000000b1',
  lunchPromo: 'c4000000-0000-0000-0000-000000000001',
  expiredPromo: 'c4000000-0000-0000-0000-000000000002',
  pausedPromo: 'c4000000-0000-0000-0000-000000000003',
  doneness: 'c5000000-0000-0000-0000-000000000001',
  wellDone: 'c6000000-0000-0000-0000-000000000001',
  milk: 'c7000000-0000-0000-0000-000000000001',
  breakfast: 'c8000000-0000-0000-0000-000000000001',
  lunch: 'c8000000-0000-0000-0000-000000000002',
  night: 'c8000000-0000-0000-0000-000000000003',
  zone: 'c9000000-0000-0000-0000-000000000001',
  table12: 'ca000000-0000-0000-0000-000000000012',
  table13: 'ca000000-0000-0000-0000-000000000013',
  tableB: 'ca000000-0000-0000-0000-0000000000b1',
} as const;

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'No encontramos esta carta.' };

/** Tuesday 2026-11-10 at hh:mm in Bogotá (UTC-5). */
const bogota = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 10, h + 5, m));
};

/** Every key anywhere in a JSON value. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

interface GuestDish {
  id: string;
  available: boolean;
  [key: string]: unknown;
}

describe('public carta (Testcontainers, vipe_api, no login)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let adminCookie = '';
  const tokens: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const guest = () => request(app.getHttpServer());
  const at = (hhmm: string) => vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota(hhmm));

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed();
    app = await createTestApp(database.apiUrl);
    const login = await guest().post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD });
    adminCookie = cookiePair(setCookies(login).vipe_access);
    // Flan needs milk the restaurant does not have: sold out while inventory control is on.
    const formula = await guest()
      .put('/api/inventory/formulas')
      .set('Cookie', adminCookie)
      .send({ targetType: 'dish', targetId: c.flan, yieldQuantity: 1, lines: [{ ingredientId: c.milk, quantity: 1 }] });
    expect(formula.status).toBe(200);
    for (const row of await db<{ table_id: string; token: string }>('SELECT table_id, token FROM table_qr_tokens')) {
      tokens[row.table_id] = row.token;
    }
    at('12:00');
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('not found (S1): one body for every case', () => {
    it.each([
      ['an unknown slug', '/api/carta/nope'],
      ['an unpublished carta', '/api/carta/rest-b'],
      ['an invalid slug', '/api/carta/Rest_A'],
      ['a too long slug', `/api/carta/${'a'.repeat(65)}`],
      ['an unknown token', '/api/carta/rest-a/m/AAAAAAAAAAAAAAAAAAAAAAAA'],
      ['an invalid token', '/api/carta/rest-a/m/short'],
      ['an unknown dish', '/api/carta/rest-a/p/c3000000-0000-0000-0000-0000000000ff'],
      ['an invalid dish id', '/api/carta/rest-a/p/not-a-uuid'],
    ])('%s', async (_name, url) => {
      const res = await guest().get(url);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it("another restaurant's table token on this slug", async () => {
      const res = await guest().get(`/api/carta/rest-a/m/${tokens[c.tableB]}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it('an old token after regenerating the QR', async () => {
      const old = tokens[c.table13];
      await db("UPDATE table_qr_tokens SET token = 'ZZZZZZZZZZZZZZZZZZZZZZZZ' WHERE table_id = $1", [c.table13]);
      try {
        const res = await guest().get(`/api/carta/rest-a/m/${old}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
      } finally {
        await db('UPDATE table_qr_tokens SET token = $2 WHERE table_id = $1', [c.table13, old]);
      }
    });
  });

  describe('GET /carta/:slug (S2, S5–S7, S10)', () => {
    it('serves the restaurant, guest-safe settings, hours, dayparts and fees without a login', async () => {
      const res = await guest().get('/api/carta/rest-a');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        lang: 'es',
        channel: 'delivery',
        restaurant: { name: 'Restaurant A', slug: 'rest-a', currency: 'COP' },
        settings: { description: 'Brasa y leña', instagram: 'brasa', englishEnabled: true, tableOrderingEnabled: false },
        isOpenNow: true,
        closesAt: '22:30',
        nextOpening: null,
        currentDaypartId: c.lunch,
        deliveryFee: 4000,
        tipPercentage: 10,
      });
      expect(res.body.table).toBeUndefined();
      expect(res.body.dayparts).toEqual([
        { id: c.breakfast, name: 'Desayuno', nameEn: 'Breakfast', startsAt: '07:00', endsAt: '11:00', current: false, featuredDishId: null, categoryIds: [c.drinks] },
        { id: c.lunch, name: 'Almuerzo', nameEn: null, startsAt: '11:30', endsAt: '15:30', current: true, featuredDishId: c.ajiaco, categoryIds: [c.mains, c.desserts] },
        // The featured dish and the category are hidden from the menu, so the guest does not get them either.
        { id: c.night, name: 'Noche', nameEn: null, startsAt: '18:00', endsAt: '22:30', current: false, featuredDishId: null, categoryIds: [c.drinks] },
      ]);
    });

    it('never returns costs, stock, ingredients, staff data or internal timestamps', async () => {
      const res = await guest().get('/api/carta/rest-a');
      const keys = new Set(keysOf(res.body));
      for (const key of keys) {
        expect(key).not.toMatch(/cost|stock|ingredient|quantity|createdAt|updatedAt|restaurantId|tableId|waiter|sortOrder|timezone/i);
      }
      const dish = res.body.menu.categories[1].dishes[0] as GuestDish;
      expect(Object.keys(dish).sort()).toEqual(
        ['allowComments', 'available', 'categoryId', 'description', 'id', 'imageUrl', 'modifierGroups', 'name', 'price', 'subcategoryId', 'tags'].concat(
          'promotionId' in dish ? ['promotionBadge', 'promotionEndsAt', 'promotionId', 'promotionName', 'promoPrice'] : [],
        ).sort(),
      );
    });

    it('lists only active categories and dishes; sold out stays at the end of its category (S6)', async () => {
      const res = await guest().get('/api/carta/rest-a');
      const tree = res.body.menu as { categories: { id: string; dishes: GuestDish[]; subcategories: { id: string; name: string }[] }[]; uncategorized: GuestDish[] };
      expect(tree.categories.map((category) => category.id)).toEqual([c.drinks, c.mains, c.desserts]);
      expect(tree.categories[1].subcategories).toEqual([{ id: c.grill, name: 'Parrilla' }]);
      expect(tree.categories[0].dishes.map((dish) => [dish.id, dish.available])).toEqual([[c.cola, true]]);
      expect(tree.categories[1].dishes.map((dish) => dish.id)).toEqual([c.ajiaco, c.steak]);
      expect(tree.categories[2].dishes.map((dish) => [dish.id, dish.available])).toEqual([[c.flan, false]]);
      expect(tree.uncategorized.map((dish) => dish.id)).toEqual([c.loose]);
      const all = [...tree.categories.flatMap((category) => category.dishes), ...tree.uncategorized].map((dish) => dish.id);
      expect(all).not.toContain(c.off);
      expect(all).not.toContain(c.inHidden);
      expect(all).not.toContain(c.dishB);
    });

    it('sold-out dishes go after the available ones of the category', async () => {
      await db('UPDATE dishes SET category_id = $1, subcategory_id = NULL WHERE id = $2', [c.desserts, c.loose]);
      try {
        const res = await guest().get('/api/carta/rest-a');
        expect(res.body.menu.categories[2].dishes.map((dish: GuestDish) => [dish.id, dish.available])).toEqual([
          [c.loose, true],
          [c.flan, false],
        ]);
      } finally {
        await db('UPDATE dishes SET category_id = NULL WHERE id = $1', [c.loose]);
      }
    });

    it('prices with the current automatic promotion only; expired and paused ones are filtered (A4)', async () => {
      const res = await guest().get('/api/carta/rest-a');
      const [ajiaco, steak] = res.body.menu.categories[1].dishes as GuestDish[];
      expect(ajiaco).toMatchObject({ price: 20000, promotionId: c.lunchPromo, promotionBadge: '10%', promoPrice: 18000, promotionEndsAt: null });
      expect(steak).toMatchObject({ price: 30000 });
      expect(steak.promotionId).toBeUndefined();
      expect(res.body.menu.categories[0].dishes[0].promotionId).toBeUndefined();
    });

    it('the channel decides the promotion fields (dine_in only promotion)', async () => {
      await db("UPDATE promotions SET channels = '{dine_in}' WHERE id = $1", [c.lunchPromo]);
      try {
        const delivery = await guest().get('/api/carta/rest-a?channel=delivery');
        expect(delivery.body.menu.categories[1].dishes[0].promotionId).toBeUndefined();
        const dineIn = await guest().get('/api/carta/rest-a?channel=dine_in');
        expect(dineIn.body.channel).toBe('dine_in');
        expect(dineIn.body.menu.categories[1].dishes[0].promotionId).toBe(c.lunchPromo);
        const takeaway = await guest().get('/api/carta/rest-a?channel=takeaway');
        expect(takeaway.status).toBe(200);
        expect(takeaway.body.menu.categories[1].dishes[0].promotionId).toBeUndefined();
      } finally {
        await db("UPDATE promotions SET channels = '{dine_in,takeaway,delivery}' WHERE id = $1", [c.lunchPromo]);
      }
      expect((await guest().get('/api/carta/rest-a?channel=bar')).status).toBe(422);
    });

    it('modifiers: active groups and options, without the ingredient', async () => {
      const res = await guest().get('/api/carta/rest-a');
      const steak = res.body.menu.categories[1].dishes[1] as GuestDish;
      expect(steak.modifierGroups).toEqual([
        { id: c.doneness, name: 'Término', required: true, minSelect: 1, maxSelect: 1, options: [{ id: c.wellDone, name: 'Bien asado', price: 2000 }] },
      ]);
    });

    it('tags plus most_ordered from paid sales (S7)', async () => {
      const res = await guest().get('/api/carta/rest-a');
      const [cola] = res.body.menu.categories[0].dishes as GuestDish[];
      const [ajiaco, steak] = res.body.menu.categories[1].dishes as GuestDish[];
      expect(cola.tags).toEqual(['vegetarian', 'gluten_free']);
      expect(ajiaco.tags).toEqual(['spicy', 'most_ordered']);
      expect(steak.tags).toEqual([]);
    });

    it('English (S10): Accept-Language or lang, descriptionEn only when enabled', async () => {
      const header = await guest().get('/api/carta/rest-a').set('Accept-Language', 'en-US,en;q=0.9');
      expect(header.body.lang).toBe('en');
      expect(header.body.menu.categories[0].dishes[0]).toMatchObject({ description: 'Gaseosa', descriptionEn: 'Soda' });
      const query = await guest().get('/api/carta/rest-a?lang=es').set('Accept-Language', 'en-US');
      expect(query.body.lang).toBe('es');
      expect(query.body.menu.categories[0].dishes[0].descriptionEn).toBe('Soda');
      await db('UPDATE carta_settings SET english_enabled = false WHERE restaurant_id = $1', [fixtures.restaurantA]);
      try {
        const off = await guest().get('/api/carta/rest-a?lang=en');
        expect(off.body.lang).toBe('es');
        expect(off.body.settings.englishEnabled).toBe(false);
        expect(off.body.menu.categories[0].dishes[0].descriptionEn).toBeUndefined();
        expect(off.body.dayparts[0].nameEn).toBeNull();
      } finally {
        await db('UPDATE carta_settings SET english_enabled = true WHERE restaurant_id = $1', [fixtures.restaurantA]);
      }
    });

    it('closed: isOpenNow false with the next opening (S5)', async () => {
      at('23:00');
      try {
        const res = await guest().get('/api/carta/rest-a');
        expect(res.body).toMatchObject({ isOpenNow: false, closesAt: null, nextOpening: { date: '2026-11-11', opensAt: '07:00', inDays: 1 }, currentDaypartId: null });
        expect(res.body.dayparts.map((daypart: { current: boolean }) => daypart.current)).toEqual([false, false, false]);
      } finally {
        at('12:00');
      }
    });

    it.each([
      ['never published (live structure)', false],
      ['published, with live changes pending', true],
    ])('the menu tree equals the staff menu tree on the shared fields (A4 contract): %s', async (_name, publish) => {
      if (publish) {
        expect((await guest().post('/api/catalog/menu/publish').set('Cookie', adminCookie)).status).toBe(201);
        // Pending until the next publication: the published name and order stay.
        await db("UPDATE categories SET name = 'Bebidas frías', sort_order = 9 WHERE id = $1", [c.drinks]);
      }
      for (const channel of ['dine_in', 'takeaway', 'delivery']) {
        const staff = await guest().get(`/api/catalog/menu/tree?channel=${channel}`).set('Cookie', adminCookie);
        expect(staff.status).toBe(200);
        const carta = await guest().get(`/api/carta/rest-a?channel=${channel}`);
        type Tree = { categories: { id: string; name: string; icon: string; color: string; hasSubcategories: boolean; subcategories: { id: string; name: string }[]; dishes: GuestDish[] }[]; uncategorized: GuestDish[] };
        const dish = (d: GuestDish) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          price: d.price,
          categoryId: d.categoryId,
          subcategoryId: d.subcategoryId,
          imageUrl: d.imageUrl,
          allowComments: d.allowComments,
          available: d.available,
          promotionId: d.promotionId,
          promotionName: d.promotionName,
          promotionBadge: d.promotionBadge,
          promoPrice: d.promoPrice,
          promotionEndsAt: d.promotionEndsAt,
          modifierGroups: (d.modifierGroups as { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: { id: string; name: string; price: number }[] }[]).map((g) => ({
            id: g.id,
            name: g.name,
            required: g.required,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price })),
          })),
        });
        // The guest lists sold-out dishes last (S6), keeping the staff order otherwise.
        const soldOutLast = (dishes: GuestDish[]) => [...dishes.filter((d) => d.available), ...dishes.filter((d) => !d.available)];
        const shared = (tree: Tree, reorder: boolean) => ({
          categories: tree.categories.map((category) => ({
            id: category.id,
            name: category.name,
            icon: category.icon,
            color: category.color,
            hasSubcategories: category.hasSubcategories,
            subcategories: category.subcategories.map((s) => ({ id: s.id, name: s.name })),
            dishes: (reorder ? soldOutLast(category.dishes) : category.dishes).map(dish),
          })),
          uncategorized: (reorder ? soldOutLast(tree.uncategorized) : tree.uncategorized).map(dish),
        });
        expect(shared(carta.body.menu as Tree, false)).toEqual(shared(staff.body as Tree, true));
        if (publish) {
          expect(carta.body.menu.categories[0]).toMatchObject({ id: c.drinks, name: 'Bebidas' });
        }
      }
    });
  });

  describe('GET /carta/:slug/m/:token (S1)', () => {
    it('the table of the token, open, with the dine_in menu', async () => {
      const res = await guest().get(`/api/carta/rest-a/m/${tokens[c.table12]}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ channel: 'dine_in', table: { number: 12, zoneName: 'Terraza', isOpen: true }, restaurant: { slug: 'rest-a' } });
      expect(Object.keys(res.body.table).sort()).toEqual(['isOpen', 'number', 'zoneName']);
    });

    it('a table without an active order is not open', async () => {
      const res = await guest().get(`/api/carta/rest-a/m/${tokens[c.table13]}`);
      expect(res.body.table).toEqual({ number: 13, zoneName: 'Terraza', isOpen: false });
    });
  });

  describe('GET /carta/:slug/p/:dishId (S9 link previews)', () => {
    it('share data of a listed dish, sold out included', async () => {
      const res = await guest().get(`/api/carta/rest-a/p/${c.ajiaco}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        restaurant: { name: 'Restaurant A', slug: 'rest-a' },
        dish: { id: c.ajiaco, name: 'Ajiaco', description: 'Sopa santafereña', price: 20000, imageUrl: 'https://img.test/ajiaco.jpg' },
      });
      expect((await guest().get(`/api/carta/rest-a/p/${c.flan}`)).status).toBe(200);
    });

    it.each([
      ['a paused dish', c.off],
      ['a dish of an inactive category', c.inHidden],
      ["another restaurant's dish", c.dishB],
    ])('404 for %s', async (_name, id) => {
      const res = await guest().get(`/api/carta/rest-a/p/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('regressions from the independent verification', () => {
    it('S2: a staff cookie changes nothing and does not unlock an unpublished carta', async () => {
      const anon = await guest().get('/api/carta/rest-a');
      const loginB = await guest().post('/api/auth/login').send({ email: fixtures.adminB.email, password: PASSWORD });
      const cookieB = cookiePair(setCookies(loginB).vipe_access);
      expect((await guest().get('/api/carta/rest-a').set('Cookie', adminCookie)).body).toEqual(anon.body);
      expect((await guest().get('/api/carta/rest-a').set('Cookie', cookieB)).body).toEqual(anon.body);
      expect((await guest().get('/api/carta/rest-b').set('Cookie', cookieB)).status).toBe(404);
      expect((await guest().get('/api/catalog/menu/tree')).status).toBe(401);
    });

    it('S1: every not-found cause has the identical bytes', async () => {
      const urls = ['/api/carta/nope', '/api/carta/rest-b', `/api/carta/rest-b/m/${tokens[c.tableB]}`, `/api/carta/nope/m/${tokens[c.table12]}`, `/api/carta/rest-a/p/${c.off}`, `/api/carta/rest-b/p/${c.dishB}`];
      const seen = new Set<string>();
      for (const url of urls) {
        const r = await guest().get(url);
        expect(r.status).toBe(404);
        seen.add(`${r.text}|${r.headers['content-length']}`);
      }
      expect(seen.size).toBe(1);
    });

    it('S5/S6 contract: buy_x_pay_y + manual promotion with a time window in the restaurant timezone', async () => {
      const [a1, a2] = ['c4000000-0000-0000-0000-0000000000a1', 'c4000000-0000-0000-0000-0000000000a2'];
      await db(`INSERT INTO promotions (id, name, kind, mode, buy_quantity, pay_quantity, rest_discount_percent, discount_type, discount_value, start_date, active, time_windows, restaurant_id) VALUES
        ($1,'DosPorUno','buy_x_pay_y','automatic',2,1,100,NULL,NULL,'2026-01-01T00:00:00-05',true,'[{"from":"01:00","to":"03:00"}]',$3),
        ($2,'Manual','product_discount','manual',NULL,NULL,NULL,'percentage',90,'2026-01-01T00:00:00-05',true,'[]',$3)`, [a1, a2, fixtures.restaurantA]);
      await db('INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1,$3,$5),($2,$4,$5)', [a1, a2, c.steak, c.cola, fixtures.restaurantA]);
      await db("UPDATE restaurants SET timezone = 'Asia/Tokyo' WHERE id = $1", [fixtures.restaurantA]);
      try {
        const pick = (t: { categories: { dishes: GuestDish[] }[] }) =>
          t.categories.flatMap((x) => x.dishes).map((d) => [d.id, d.promotionId, d.promotionBadge, d.promotionEndsAt, d.promoPrice]);
        const staff = await guest().get('/api/catalog/menu/tree?channel=delivery').set('Cookie', adminCookie);
        const carta = await guest().get('/api/carta/rest-a?channel=delivery');
        expect(pick(carta.body.menu).sort()).toEqual(pick(staff.body).sort());
        expect(carta.body.menu.categories[1].dishes.find((d: GuestDish) => d.id === c.steak)).toMatchObject({ promotionBadge: '2x1', promotionEndsAt: '03:00' });
        expect(carta.body.menu.categories[0].dishes[0].promotionId).toBeUndefined();
        expect(carta.body).toMatchObject({ isOpenNow: false, nextOpening: { date: '2026-11-11', opensAt: '07:00', inDays: 0 } });
      } finally {
        await db("UPDATE restaurants SET timezone = 'America/Bogota' WHERE id = $1", [fixtures.restaurantA]);
        await db('DELETE FROM promotion_dishes WHERE promotion_id = ANY($1)', [[a1, a2]]);
        await db('DELETE FROM promotions WHERE id = ANY($1)', [[a1, a2]]);
      }
    });

    it('S5: closing after midnight is open in the early hours', async () => {
      await db(`UPDATE carta_settings SET opening_hours = jsonb_set(opening_hours, '{1}', '{"opens":"18:00","closes":"02:00"}') WHERE restaurant_id = $1`, [fixtures.restaurantA]);
      at('01:00');
      try {
        expect((await guest().get('/api/carta/rest-a')).body).toMatchObject({ isOpenNow: true, closesAt: '02:00' });
      } finally {
        at('12:00');
        await db(`UPDATE carta_settings SET opening_hours = jsonb_set(opening_hours, '{1}', '{"opens":"07:00","closes":"22:30"}') WHERE restaurant_id = $1`, [fixtures.restaurantA]);
      }
    });
  });

  describe('rate limit (S2)', () => {
    it('120 reads a minute per IP and route, then 429 in Spanish with Retry-After', async () => {
      let limited: request.Response | undefined;
      for (let i = 0; i < 125 && !limited; i++) {
        const res = await guest().get('/api/carta/rate-probe');
        if (res.status === 429) {
          limited = res;
        } else {
          expect(res.status).toBe(404);
        }
      }
      expect(limited?.body).toEqual({ statusCode: 429, error: 'Too Many Requests', message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' });
      expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
      // Another route keeps its own window.
      expect((await guest().get(`/api/carta/rest-a/p/${c.ajiaco}`)).status).toBe(200);
    });
  });

  async function seed() {
    const A = fixtures.restaurantA;
    const B = fixtures.restaurantB;
    const hours = JSON.stringify(Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((day) => [day, { opens: '07:00', closes: '22:30' }])));
    await db(
      `INSERT INTO carta_settings (restaurant_id, published, description, instagram, english_enabled, opening_hours) VALUES
         ($1, true, 'Brasa y leña', 'brasa', true, $3::jsonb), ($2, false, NULL, NULL, true, NULL)`,
      [A, B, hours],
    );
    await db(
      `INSERT INTO business_config (key, value, restaurant_id) VALUES ('delivery_default_fee', '4000', $1), ('inventory_control_enabled', 'true', $1)`,
      [A],
    );
    await db(
      `INSERT INTO categories (id, name, icon, active, sort_order, color, restaurant_id) VALUES
         ($1, 'Bebidas', 'cup', true, 0, 'sky', $5), ($2, 'Platos', 'utensils', true, 1, 'orange', $5),
         ($3, 'Postres', 'cake', true, 2, 'neutral', $5), ($4, 'Oculta', 'eye', false, 3, 'neutral', $5)`,
      [c.drinks, c.mains, c.desserts, c.hidden, A],
    );
    await db(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ('c1000000-0000-0000-0000-0000000000b1', 'Otra', 'x', $1)`, [B]);
    await db(`INSERT INTO subcategories (id, category_id, name, sort_order, active, restaurant_id) VALUES ($1, $2, 'Parrilla', 0, true, $3)`, [c.grill, c.mains, A]);
    await db(
      `INSERT INTO dishes (id, name, description, price, category_id, subcategory_id, image_url, active, sort_order, restaurant_id) VALUES
         ($1, 'Churrasco', NULL, 30000, $9, $10, NULL, true, 1, $13),
         ($2, 'Ajiaco', 'Sopa santafereña', 20000, $9, NULL, 'https://img.test/ajiaco.jpg', true, 0, $13),
         ($3, 'Cola', 'Gaseosa', 5000, $11, NULL, NULL, true, 0, $13),
         ($4, 'Flan', NULL, 8000, $12, NULL, NULL, true, 0, $13),
         ($5, 'Apagado', NULL, 1000, $9, NULL, NULL, false, 0, $13),
         ($6, 'Escondido', NULL, 1000, $14, NULL, NULL, true, 0, $13),
         ($7, 'Suelto', NULL, 3000, NULL, NULL, NULL, true, 0, $13),
         ($8, 'Plato B', NULL, 9000, NULL, NULL, NULL, true, 0, $15)`,
      [c.steak, c.ajiaco, c.cola, c.flan, c.off, c.inHidden, c.loose, c.dishB, c.mains, c.grill, c.drinks, c.desserts, A, c.hidden, B],
    );
    await db(
      `INSERT INTO dish_public_details (dish_id, tags, description_en, restaurant_id) VALUES
         ($1, '{vegetarian,gluten_free}', 'Soda', $3), ($2, '{spicy}', NULL, $3)`,
      [c.cola, c.ajiaco, A],
    );
    await db(
      `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, end_date, active, restaurant_id) VALUES
         ($1, 'Mediodía', 'percentage', 10, '2026-01-01T00:00:00-05', '2027-12-31T00:00:00-05', true, $4),
         ($2, 'Vieja', 'percentage', 50, '2025-01-01T00:00:00-05', '2025-02-01T00:00:00-05', true, $4),
         ($3, 'Pausada', 'percentage', 50, '2026-01-01T00:00:00-05', NULL, false, $4)`,
      [c.lunchPromo, c.expiredPromo, c.pausedPromo, A],
    );
    await db(
      `INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1, $4, $6), ($2, $5, $6), ($3, $7, $6)`,
      [c.lunchPromo, c.expiredPromo, c.pausedPromo, c.ajiaco, c.steak, A, c.cola],
    );
    await db(`INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Leche', 'l', $2)`, [c.milk, A]);
    await db(
      `INSERT INTO modifier_groups (id, name, required, min_select, max_select, sort_order, is_active, restaurant_id) VALUES
         ($1, 'Término', true, 1, 1, 0, true, $2), ('c5000000-0000-0000-0000-000000000002', 'Apagado', false, 0, NULL, 1, false, $2)`,
      [c.doneness, A],
    );
    await db(
      `INSERT INTO modifier_options (id, group_id, name, price, ingredient_id, ingredient_qty, sort_order, is_active, restaurant_id) VALUES
         ($1, $2, 'Bien asado', 2000, $3, 0.1, 0, true, $4), ('c6000000-0000-0000-0000-000000000002', $2, 'Crudo', 0, NULL, NULL, 1, false, $4)`,
      [c.wellDone, c.doneness, c.milk, A],
    );
    await db(
      `INSERT INTO dish_modifier_groups (dish_id, group_id, sort_order, restaurant_id) VALUES
         ($1, $2, 0, $3), ($1, 'c5000000-0000-0000-0000-000000000002', 1, $3)`,
      [c.steak, c.doneness, A],
    );
    await db(
      `INSERT INTO carta_dayparts (id, name, name_en, starts_at, ends_at, sort_order, featured_dish_id, restaurant_id) VALUES
         ($1, 'Desayuno', 'Breakfast', '07:00', '11:00', 0, NULL, $4), ($2, 'Almuerzo', NULL, '11:30', '15:30', 1, $5, $4),
         ($3, 'Noche', NULL, '18:00', '22:30', 2, $6, $4)`,
      [c.breakfast, c.lunch, c.night, A, c.ajiaco, c.off],
    );
    await db(
      `INSERT INTO carta_daypart_categories (daypart_id, category_id, restaurant_id) VALUES
         ($1, $4, $7), ($2, $5, $7), ($2, $6, $7), ($3, $4, $7), ($3, $8, $7)`,
      [c.breakfast, c.lunch, c.night, c.drinks, c.mains, c.desserts, A, c.hidden],
    );
    await db(`INSERT INTO zones (id, restaurant_id, name) VALUES ($1, $2, 'Terraza')`, [c.zone, A]);
    await db(
      `INSERT INTO tables (id, number, restaurant_id, zone_id) VALUES ($1, 12, $3, $4), ($2, 13, $3, $4)`,
      [c.table12, c.table13, A, c.zone],
    );
    await db(`INSERT INTO tables (id, number, restaurant_id) VALUES ($1, 5, $2)`, [c.tableB, B]);
    await db(
      `INSERT INTO orders (status, subtotal, tax, tax_percentage, total, restaurant_id, table_id) VALUES ('active', 0, 0, 0, 0, $1, $2)`,
      [A, c.table12],
    );
    const [paid] = await db<{ id: string }>(
      `INSERT INTO orders (status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ('paid', 60000, 0, 0, 60000, $1) RETURNING id`,
      [A],
    );
    await db(
      `INSERT INTO order_items (order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES ($1, $2, 'Ajiaco', 20000, 3, 'delivered', $3)`,
      [paid.id, c.ajiaco, A],
    );
  }
});
