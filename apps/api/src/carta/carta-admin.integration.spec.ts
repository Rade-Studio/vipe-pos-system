import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTING_HEADER } from '../auth/terminal-access';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';
import { startTestStorage, type TestStorage } from '../testing/test-storage';

/** Rows seeded as the superuser for this spec only. */
const c = {
  mains: 'e1000000-0000-0000-0000-000000000001',
  drinks: 'e1000000-0000-0000-0000-000000000002',
  categoryB: 'e1000000-0000-0000-0000-0000000000b1',
  ajiaco: 'e3000000-0000-0000-0000-000000000001',
  juice: 'e3000000-0000-0000-0000-000000000002',
  dishB: 'e3000000-0000-0000-0000-0000000000b1',
  zone: 'e9000000-0000-0000-0000-000000000001',
  table1: 'ea000000-0000-0000-0000-000000000001',
  table2: 'ea000000-0000-0000-0000-000000000002',
  tableB: 'ea000000-0000-0000-0000-0000000000b1',
  paid: 'eb000000-0000-0000-0000-000000000001',
  kitchen: { userId: 'ee000000-0000-0000-0000-0000000000a1', profileId: 'ef000000-0000-0000-0000-0000000000a1', email: 'kitchen-admin@a.test' },
} as const;

const S3_VARS = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL', 'S3_FORCE_PATH_STYLE'];
const SLUG_MESSAGE = 'Usa minúsculas y números separados por guiones (sin tildes, espacios ni guiones al inicio o al final), hasta 64 caracteres.';
const ROUTES = [
  ['GET', '/api/carta-admin'],
  ['PUT', '/api/carta-admin/settings'],
  ['PUT', '/api/carta-admin/dayparts'],
  ['PUT', `/api/carta-admin/dishes/${c.ajiaco}`],
  ['POST', `/api/carta-admin/tables/${c.table1}/qr`],
  ['POST', '/api/carta-admin/tables/qr'],
  ['PUT', '/api/carta-admin/slug'],
  ['POST', '/api/carta-admin/assets'],
] as const;
const DAYPARTS = [
  { name: 'Desayuno', nameEn: 'Breakfast', startsAt: '07:00', endsAt: '11:00', featuredDishId: c.juice, categoryIds: [c.drinks] },
  { name: 'Almuerzo', startsAt: '11:30', endsAt: '15:30', categoryIds: [c.mains, c.drinks] },
];

describe('carta admin (Testcontainers: Postgres + MinIO, admin only)', () => {
  let database: TestDatabase;
  let storage: TestStorage;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const http = () => request(app.getHttpServer());
  const as = (email: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookies[email]),
    put: (url: string, body: unknown) => http().put(url).set('Cookie', cookies[email]).send(body as object),
    post: (url: string, body: unknown = {}) => http().post(url).set('Cookie', cookies[email]).send(body as object),
  });
  const admin = () => as(fixtures.adminA.email);
  const settingsRow = async () => (await db('SELECT * FROM carta_settings WHERE restaurant_id = $1', [fixtures.restaurantA]))[0];
  const daypartRows = () =>
    db<{ name: string; categories: string[] }>(
      `SELECT d.name, d.featured_dish_id, array(SELECT dc.category_id::text FROM carta_daypart_categories dc WHERE dc.daypart_id = d.id ORDER BY 1) AS categories
         FROM carta_dayparts d WHERE d.restaurant_id = $1 ORDER BY d.sort_order, d.name`,
      [fixtures.restaurantA],
    );
  /** Everything the admin routes can change, as the superuser sees it. */
  const snapshot = async () => [
    await settingsRow(),
    await daypartRows(),
    await db('SELECT table_id, token FROM table_qr_tokens ORDER BY table_id'),
    await db('SELECT * FROM dish_public_details ORDER BY dish_id'),
    await db('SELECT id, slug FROM restaurants ORDER BY id'),
  ];
  const send = (method: string, url: string, req: () => request.SuperTest<request.Test> | ReturnType<typeof request>) => {
    const agent = req();
    return method === 'GET' ? agent.get(url) : method === 'PUT' ? agent.put(url).send({ published: true }) : agent.post(url).send({});
  };
  const tokenOf = async (tableId: string) => (await db<{ token: string }>('SELECT token FROM table_qr_tokens WHERE table_id = $1', [tableId]))[0].token;

  beforeAll(async () => {
    [database, storage] = await Promise.all([startTestDatabase(), startTestStorage()]);
    Object.assign(process.env, storage.env);
    await seed();
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB, fixtures.bcryptUser, c.kitchen]) {
      const res = await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    for (const name of S3_VARS) {
      delete process.env[name];
    }
    await app?.close();
    await Promise.all([database?.stop(), storage?.stop()]);
  });

  describe('roles', () => {
    it.each(ROUTES)('%s %s is 403 for a waiter, a cashier and the kitchen, 401 without login', async (method, url) => {
      const before = [await settingsRow(), await tokenOf(c.table1), await daypartRows()];
      for (const email of [fixtures.waiterA.email, fixtures.bcryptUser.email, c.kitchen.email]) {
        const req = method === 'GET' ? as(email).get(url) : method === 'PUT' ? as(email).put(url, { published: true }) : as(email).post(url);
        expect((await req).status).toBe(403);
      }
      const anonymous = method === 'GET' ? http().get(url) : method === 'PUT' ? http().put(url) : http().post(url);
      expect((await anonymous).status).toBe(401);
      expect([await settingsRow(), await tokenOf(c.table1), await daypartRows()]).toEqual(before);
    });
  });

  describe('GET /carta-admin', () => {
    it('returns defaults, the slug and public path, categories, dishes, tables and the delivery fee', async () => {
      const res = await admin().get('/api/carta-admin');
      expect(res.status).toBe(200);
      expect(res.body.restaurant).toEqual({ name: 'Restaurant A', slug: 'rest-a', publicPath: '/c/rest-a', timezone: 'America/Bogota' });
      expect(res.body.settings).toEqual({
        published: false,
        description: null,
        brandColor: null,
        logoUrl: null,
        coverUrl: null,
        instagram: null,
        tiktok: null,
        whatsapp: null,
        mapsUrl: null,
        googleReviewUrl: null,
        tableOrderingEnabled: false,
        deliveryOrderingEnabled: false,
        showTableBill: true,
        englishEnabled: true,
        openingHours: null,
      });
      expect(res.body.dayparts).toEqual([]);
      expect(res.body.categories).toEqual([
        { id: c.mains, name: 'Platos', active: true },
        { id: c.drinks, name: 'Bebidas', active: true },
      ]);
      expect(res.body.dishes).toEqual([
        {
          id: c.ajiaco,
          name: 'Ajiaco',
          description: 'Sopa de la casa',
          price: 20000,
          categoryId: c.mains,
          imageUrl: null,
          active: true,
          tags: ['dairy'],
          descriptionEn: 'House soup',
          descriptionEnReviewed: false,
          mostOrdered: true,
        },
        {
          id: c.juice,
          name: 'Jugo',
          description: null,
          price: 6000,
          categoryId: c.drinks,
          imageUrl: null,
          active: true,
          tags: [],
          descriptionEn: null,
          descriptionEnReviewed: false,
          mostOrdered: false,
        },
      ]);
      expect(res.body.tables).toEqual([
        { id: c.table1, number: 1, zoneName: 'Salón', token: await tokenOf(c.table1), guestPath: `/c/rest-a/m/${await tokenOf(c.table1)}` },
        { id: c.table2, number: 2, zoneName: null, token: await tokenOf(c.table2), guestPath: `/c/rest-a/m/${await tokenOf(c.table2)}` },
      ]);
      expect(res.body.deliveryDefaultFee).toBe(4000);
    });
  });

  describe('PUT /carta-admin/settings', () => {
    const full = {
      published: true,
      description: '  Parrilla a la leña ',
      brandColor: '#9A3412',
      logoUrl: 'https://cdn.test/logo.png',
      coverUrl: 'https://cdn.test/cover.png',
      instagram: 'brasa.lena',
      tiktok: 'brasa_lena',
      whatsapp: '573104567890',
      mapsUrl: 'https://maps.app.goo.gl/x',
      googleReviewUrl: 'https://g.page/r/x/review',
      tableOrderingEnabled: true,
      deliveryOrderingEnabled: true,
      showTableBill: false,
      englishEnabled: true,
      openingHours: { 1: null, 2: { opens: '07:00', closes: '22:30' }, 3: null, 4: null, 5: null, 6: null, 7: { opens: '18:00', closes: '02:00' } },
    };

    it('creates the row, then a partial update keeps the other fields and a blank clears', async () => {
      const res = await admin().put('/api/carta-admin/settings', full);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...full, description: 'Parrilla a la leña', brandColor: '#9a3412' });
      expect(await settingsRow()).toMatchObject({ published: true, brand_color: '#9a3412', whatsapp: '573104567890', show_table_bill: false });

      const partial = await admin().put('/api/carta-admin/settings', { instagram: '', showTableBill: true });
      expect(partial.status).toBe(200);
      expect(partial.body).toEqual({ ...full, description: 'Parrilla a la leña', brandColor: '#9a3412', instagram: null, showTableBill: true });
      expect((await admin().get('/api/carta-admin')).body.settings).toEqual(partial.body);
    });

    it.each([
      [{ description: 'x'.repeat(161) }, 'La descripción corta admite hasta 160 caracteres.'],
      [{ brandColor: 'red' }, 'El color de marca debe tener el formato #rrggbb.'],
      [{ whatsapp: '123456' }, 'El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.'],
      [{ whatsapp: '+573104567890' }, 'El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.'],
      [{ mapsUrl: 'http://maps.test/x' }, 'El enlace de Google Maps debe empezar por https:// (máximo 500 caracteres).'],
      [{ googleReviewUrl: 'javascript:alert(1)' }, 'El enlace para reseñas debe empezar por https:// (máximo 500 caracteres).'],
      [{ logoUrl: 'ftp://x/logo.png' }, 'El logo debe ser un enlace https:// de hasta 1000 caracteres.'],
      [{ logoUrl: 'http://cdn.test/logo.png' }, 'El logo debe ser un enlace https:// de hasta 1000 caracteres.'],
      [{ coverUrl: 'http://cdn.test/cover.png' }, 'La portada debe ser un enlace https:// de hasta 1000 caracteres.'],
      [{ published: null }, 'Indica si la carta está publicada.'],
      [{ tableOrderingEnabled: null }, 'Revisa los interruptores de la carta.'],
      [{ instagram: '@brasa' }, 'Escribe el usuario de Instagram sin @: letras, números, punto o guion bajo (máximo 30).'],
      [{ openingHours: { 1: null } }, 'Revisa el horario de atención: cada día va cerrado o con apertura y cierre HH:MM distintos.'],
      [{ openingHours: { ...full.openingHours, 2: { opens: '07:00', closes: '07:00' } } }, 'Revisa el horario de atención: cada día va cerrado o con apertura y cierre HH:MM distintos.'],
      [{ openingHours: { ...full.openingHours, 2: { opens: '7:00', closes: '22:00' } } }, 'Revisa el horario de atención: cada día va cerrado o con apertura y cierre HH:MM distintos.'],
      [{ published: 'yes' }, 'Indica si la carta está publicada.'],
      [{ restaurantId: fixtures.restaurantB }, 'Revisa los datos de la carta.'],
    ])('422 %j leaves the row unchanged', async (body, message) => {
      const before = await settingsRow();
      const res = await admin().put('/api/carta-admin/settings', body);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(await settingsRow()).toEqual(before);
    });

    it('stores " #ABCDEF " as #abcdef, and PUT {} returns the row unchanged', async () => {
      const res = await admin().put('/api/carta-admin/settings', { brandColor: ' #ABCDEF ' });
      expect([res.status, res.body.brandColor]).toEqual([200, '#abcdef']);
      const before = await settingsRow();
      const empty = await admin().put('/api/carta-admin/settings', {});
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual(res.body);
      expect({ ...(await settingsRow()), updated_at: null }).toEqual({ ...before, updated_at: null });
    });

    it('two concurrent saves of different fields both survive', async () => {
      await db('DELETE FROM carta_settings WHERE restaurant_id = $1', [fixtures.restaurantA]);
      for (let round = 0; round < 3; round++) {
        const [first, second] = await Promise.all([
          admin().put('/api/carta-admin/settings', { instagram: `insta${round}` }),
          admin().put('/api/carta-admin/settings', { tiktok: `tik${round}` }),
        ]);
        expect([first.status, second.status]).toEqual([200, 200]);
        expect(await settingsRow()).toMatchObject({ instagram: `insta${round}`, tiktok: `tik${round}` });
      }
      await admin().put('/api/carta-admin/settings', full);
    });

    it("never touches another restaurant's settings", async () => {
      await admin().put('/api/carta-admin/settings', { description: 'Solo A' });
      expect(await db('SELECT * FROM carta_settings WHERE restaurant_id = $1', [fixtures.restaurantB])).toEqual([]);
    });
  });

  describe('PUT /carta-admin/dayparts', () => {
    it('replaces the whole list and GET returns it in order', async () => {
      await admin().put('/api/carta-admin/dayparts', { dayparts: [{ name: 'Vieja', startsAt: '01:00', endsAt: '02:00', categoryIds: [] }] });
      const res = await admin().put('/api/carta-admin/dayparts', { dayparts: DAYPARTS });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: expect.any(String), name: 'Desayuno', nameEn: 'Breakfast', startsAt: '07:00', endsAt: '11:00', sortOrder: 0, featuredDishId: c.juice, categoryIds: [c.drinks] },
        { id: expect.any(String), name: 'Almuerzo', nameEn: null, startsAt: '11:30', endsAt: '15:30', sortOrder: 1, featuredDishId: null, categoryIds: [c.mains, c.drinks] },
      ]);
      expect((await admin().get('/api/carta-admin')).body.dayparts).toEqual(res.body);
      expect((await daypartRows()).map((row) => row.name)).toEqual(['Desayuno', 'Almuerzo']);
    });

    it.each([
      ['a foreign category', [DAYPARTS[0], { ...DAYPARTS[1], categoryIds: [c.categoryB] }], 'Las categorías de la franja deben ser de tu restaurante.'],
      ['a foreign featured dish', [DAYPARTS[0], { ...DAYPARTS[1], featuredDishId: c.dishB }], 'El plato del día debe ser un plato de tu restaurante.'],
      ['an unknown category', [{ ...DAYPARTS[1], categoryIds: ['e1000000-0000-0000-0000-0000000000ff'] }], 'Las categorías de la franja deben ser de tu restaurante.'],
      ['starts after it ends', [{ ...DAYPARTS[1], startsAt: '16:00' }], 'Cada franja empieza antes de terminar, en HH:MM y sin cruzar la medianoche.'],
      ['crosses midnight', [{ ...DAYPARTS[1], startsAt: '22:00', endsAt: '01:00' }], 'Cada franja empieza antes de terminar, en HH:MM y sin cruzar la medianoche.'],
      ['a 41-character name', [{ ...DAYPARTS[1], name: 'x'.repeat(41) }], 'El nombre de la franja admite de 1 a 40 caracteres.'],
      ['a blank name', [{ ...DAYPARTS[1], name: '  ' }], 'El nombre de la franja admite de 1 a 40 caracteres.'],
      ['13 dayparts', Array.from({ length: 13 }, () => DAYPARTS[1]), 'Revisa las franjas: hasta 12, cada una con nombre, horas y categorías.'],
    ])('422 on %s and the previous list stays', async (_name, dayparts, message) => {
      const before = await daypartRows();
      const res = await admin().put('/api/carta-admin/dayparts', { dayparts });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(await daypartRows()).toEqual(before);
    });
  });

  it('a DB failure on the second daypart insert is a 4xx and the old list stays byte-identical', async () => {
    const before = await db("SELECT to_jsonb(d) - 'restaurant_id' AS row FROM carta_dayparts d ORDER BY id");
    const links = await db('SELECT * FROM carta_daypart_categories ORDER BY daypart_id, category_id');
    await db(`CREATE FUNCTION public.zz_fail_daypart() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.name = 'Almuerzo' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$`);
    await db('CREATE TRIGGER zz_fail_daypart BEFORE INSERT ON carta_dayparts FOR EACH ROW EXECUTE FUNCTION public.zz_fail_daypart()');
    try {
      const res = await admin().put('/api/carta-admin/dayparts', { dayparts: [{ ...DAYPARTS[0], name: 'Otra' }, DAYPARTS[1]] });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.message).toBe('No pudimos guardar los cambios. Intenta de nuevo.');
    } finally {
      await db('DROP TRIGGER zz_fail_daypart ON carta_dayparts');
      await db('DROP FUNCTION public.zz_fail_daypart()');
    }
    expect(await db("SELECT to_jsonb(d) - 'restaurant_id' AS row FROM carta_dayparts d ORDER BY id")).toEqual(before);
    expect(await db('SELECT * FROM carta_daypart_categories ORDER BY daypart_id, category_id')).toEqual(links);
  });

  describe('PUT /carta-admin/dishes/:dishId', () => {
    it('upserts the tags and the English description', async () => {
      const res = await admin().put(`/api/carta-admin/dishes/${c.juice}`, {
        tags: ['vegetarian', 'gluten_free', 'vegetarian', 'gluten_free', 'vegetarian'],
        descriptionEn: ' Fresh juice ',
        descriptionEnReviewed: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ dishId: c.juice, tags: ['vegetarian', 'gluten_free'], descriptionEn: 'Fresh juice', descriptionEnReviewed: true });
      const updated = await admin().put(`/api/carta-admin/dishes/${c.juice}`, { tags: [], descriptionEn: '', descriptionEnReviewed: false });
      expect(updated.body).toEqual({ dishId: c.juice, tags: [], descriptionEn: null, descriptionEnReviewed: false });
      const dishes = (await admin().get('/api/carta-admin')).body.dishes;
      expect(dishes.find((dish: { id: string }) => dish.id === c.juice)).toMatchObject({ tags: [], descriptionEn: null, descriptionEnReviewed: false });
    });

    it('404 for a dish of another restaurant, nothing written', async () => {
      const res = await admin().put(`/api/carta-admin/dishes/${c.dishB}`, { tags: ['spicy'], descriptionEnReviewed: false });
      expect([res.status, res.body.message]).toEqual([404, 'No encontramos este plato.']);
      expect(await db('SELECT * FROM dish_public_details WHERE dish_id = $1', [c.dishB])).toEqual([]);
    });

    it.each([
      [{ tags: ['most_ordered'], descriptionEnReviewed: false }, 'Las etiquetas válidas son Vegetariano, Picante, Sin gluten y Lácteos.'],
      [{ tags: [], descriptionEn: 'x'.repeat(401), descriptionEnReviewed: false }, 'La descripción en inglés admite hasta 400 caracteres.'],
      [{ tags: [] }, 'Indica si revisaste la descripción en inglés.'],
    ])('422 %j leaves the details unchanged', async (body, message) => {
      const before = await db('SELECT * FROM dish_public_details WHERE dish_id = $1', [c.ajiaco]);
      const res = await admin().put(`/api/carta-admin/dishes/${c.ajiaco}`, body);
      expect([res.status, res.body.message]).toEqual([422, message]);
      expect(await db('SELECT * FROM dish_public_details WHERE dish_id = $1', [c.ajiaco])).toEqual(before);
    });
  });

  describe('table QR codes', () => {
    it('regenerating one table: the old guest link is 404 and the new one 200', async () => {
      await admin().put('/api/carta-admin/settings', { published: true });
      const old = await tokenOf(c.table1);
      expect((await http().get(`/api/carta/rest-a/m/${old}`)).status).toBe(200);
      const res = await admin().post(`/api/carta-admin/tables/${c.table1}/qr`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: c.table1, number: 1, zoneName: 'Salón', token: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/), guestPath: `/c/rest-a/m/${res.body.token}` });
      expect(res.body.token).not.toBe(old);
      expect((await http().get(`/api/carta/rest-a/m/${old}`)).status).toBe(404);
      expect((await http().get(`/api/carta/rest-a/m/${res.body.token}`)).status).toBe(200);
    });

    it('404 for a table of another restaurant; its token stays', async () => {
      const before = await tokenOf(c.tableB);
      const res = await admin().post(`/api/carta-admin/tables/${c.tableB}/qr`);
      expect([res.status, res.body.message]).toEqual([404, 'No encontramos esta mesa.']);
      expect(await tokenOf(c.tableB)).toBe(before);
    });

    it('regenerating all replaces every token of the restaurant only', async () => {
      const before = { t1: await tokenOf(c.table1), t2: await tokenOf(c.table2), b: await tokenOf(c.tableB) };
      const res = await admin().post('/api/carta-admin/tables/qr');
      expect(res.status).toBe(200);
      expect(res.body.tables.map((table: { id: string }) => table.id)).toEqual([c.table1, c.table2]);
      expect(await tokenOf(c.table1)).not.toBe(before.t1);
      expect(await tokenOf(c.table2)).not.toBe(before.t2);
      expect(await tokenOf(c.tableB)).toBe(before.b);
      expect(res.body.tables[1].token).toBe(await tokenOf(c.table2));
      expect((await http().get(`/api/carta/rest-a/m/${before.t2}`)).status).toBe(404);
    });
  });

  it('a DB failure on the second table keeps every token', async () => {
    const before = await db('SELECT table_id, token FROM table_qr_tokens ORDER BY table_id');
    await db(`CREATE FUNCTION public.zz_fail_token() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.table_id = '${c.table2}' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$`);
    await db('CREATE TRIGGER zz_fail_token BEFORE UPDATE ON table_qr_tokens FOR EACH ROW EXECUTE FUNCTION public.zz_fail_token()');
    try {
      const res = await admin().post('/api/carta-admin/tables/qr');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    } finally {
      await db('DROP TRIGGER zz_fail_token ON table_qr_tokens');
      await db('DROP FUNCTION public.zz_fail_token()');
    }
    expect(await db('SELECT table_id, token FROM table_qr_tokens ORDER BY table_id')).toEqual(before);
  });

  describe('POST /carta-admin/assets', () => {
    it('presigns a PUT under <restaurantId>/carta/ for the caller only', async () => {
      const res = await admin().post('/api/carta-admin/assets', { kind: 'logo', contentType: 'image/png', size: 68 });
      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(new RegExp(`^${fixtures.restaurantA}/carta/[0-9a-f-]{36}\\.png$`));
      expect(res.body.publicUrl).toBe(`${storage.env.S3_PUBLIC_BASE_URL}/${res.body.key}`);
      const other = await as(fixtures.adminB.email).post('/api/carta-admin/assets', { kind: 'cover', contentType: 'image/jpeg', size: 10 });
      expect(other.body.key).toMatch(new RegExp(`^${fixtures.restaurantB}/carta/[0-9a-f-]{36}\\.jpg$`));
    });

    it('accepts webp; POST /storage/uploads refuses a folder and keeps dishes under /dishes/', async () => {
      const webp = await admin().post('/api/carta-admin/assets', { kind: 'cover', contentType: 'image/webp', size: 10 });
      expect(webp.body.key).toMatch(new RegExp(`^${fixtures.restaurantA}/carta/[0-9a-f-]{36}\\.webp$`));
      const folder = await admin().post('/api/storage/uploads', { kind: 'dish', contentType: 'image/png', size: 1, folder: 'carta' });
      expect(folder.status).toBe(422);
      const dish = await admin().post('/api/storage/uploads', { kind: 'dish', contentType: 'image/png', size: 1 });
      expect(dish.body.key).toMatch(new RegExp(`^${fixtures.restaurantA}/dishes/[0-9a-f-]{36}\\.png$`));
    });

    it.each([
      [{ kind: 'dish', contentType: 'image/png', size: 1 }, 'Elige si subes el logo o la portada.'],
      [{ kind: 'logo', contentType: 'image/png', size: 1, folder: 'dishes' }, 'Revisa los datos de la carta.'],
      [{ kind: 'logo', contentType: 'image/svg+xml', size: 1 }, 'Sube una imagen PNG, JPG o WebP (no SVG).'],
      [{ kind: 'logo', contentType: 'image/gif', size: 1 }, 'Sube una imagen PNG, JPG o WebP (no SVG).'],
      [{ kind: 'logo', contentType: 'image/x-icon', size: 1 }, 'Sube una imagen PNG, JPG o WebP (no SVG).'],
      [{ kind: 'logo', contentType: 'image/png', size: 5 * 1024 * 1024 + 1 }, 'La imagen puede pesar hasta 5 MB.'],
    ])('422 %j', async (body, message) => {
      const res = await admin().post('/api/carta-admin/assets', body);
      expect([res.status, res.body.message]).toEqual([422, message]);
    });
  });

  describe('PUT /carta-admin/slug', () => {
    it.each([['La-Parrilla'], ['la parrilla'], ['peña'], [''], ['x'.repeat(65)], ['---'], ['-a'], ['a-'], ['a--b']])('422 for %j, slug unchanged', async (slug) => {
      const res = await admin().put('/api/carta-admin/slug', { slug });
      expect([res.status, res.body.message]).toEqual([422, SLUG_MESSAGE]);
      expect((await db('SELECT slug FROM restaurants WHERE id = $1', [fixtures.restaurantA]))[0].slug).toBe('rest-a');
    });

    it('409 when another restaurant uses it', async () => {
      const res = await admin().put('/api/carta-admin/slug', { slug: 'rest-b' });
      expect([res.status, res.body.message]).toEqual([409, 'Ese enlace ya lo usa otro restaurante']);
      expect((await db('SELECT slug FROM restaurants WHERE id = $1', [fixtures.restaurantA]))[0].slug).toBe('rest-a');
    });

    it('renames the link: the guest menu answers the new slug and the old one is 404', async () => {
      await admin().put('/api/carta-admin/settings', { published: true });
      const res = await admin().put('/api/carta-admin/slug', { slug: 'la-parrilla' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'Restaurant A', slug: 'la-parrilla', publicPath: '/c/la-parrilla', timezone: 'America/Bogota' });
      expect((await http().get('/api/carta/la-parrilla')).status).toBe(200);
      expect((await http().get(`/api/carta/la-parrilla/p/${c.ajiaco}`)).status).toBe(200);
      expect((await http().get(`/api/carta/rest-a/p/${c.ajiaco}`)).status).toBe(404);
      expect((await http().get('/api/carta/rest-a')).status).toBe(404);
      const token = await tokenOf(c.table1);
      expect((await http().get(`/api/carta/la-parrilla/m/${token}`)).status).toBe(200);
      expect((await admin().get('/api/carta-admin')).body.tables[0].guestPath).toBe(`/c/la-parrilla/m/${token}`);
      expect((await db('SELECT slug FROM restaurants WHERE id = $1', [fixtures.restaurantB]))[0].slug).toBe('rest-b');
    });

    it.each([['b2'], ['bruma-bar']])('accepts %j', async (slug) => {
      const res = await admin().put('/api/carta-admin/slug', { slug });
      expect([res.status, res.body.slug]).toEqual([200, slug]);
    });
  });

  describe('shared terminal opened by an admin', () => {
    let terminal = '';
    let acting = '';
    beforeAll(async () => {
      const cookie = cookies[fixtures.adminA.email];
      expect((await http().put(`/api/staff/${fixtures.adminA.profileId}/pin`).set('Cookie', cookie).send({ pin: '9157' })).status).toBe(204);
      expect((await http().put('/api/config').set('Cookie', cookie).send({ waiterAccessMode: 'shared_terminal' })).status).toBe(200);
      const opened = await http().post('/api/auth/terminal/login').send({ email: fixtures.adminA.email, password: PASSWORD });
      expect(opened.status).toBe(200);
      terminal = cookiePair(setCookies(opened).vipe_access);
      const identified = await http().post('/api/auth/identify').set('Cookie', terminal).send({ profileId: fixtures.adminA.profileId, pin: '9157' });
      expect(identified.status).toBe(200);
      acting = identified.body.token as string;
    });

    it.each(ROUTES)('%s %s is 403 terminal_route with and without the admin PIN claim; nothing changes', async (method, url) => {
      const before = await snapshot();
      for (const claim of [undefined, acting]) {
        const res = await send(method, url, () => {
          const agent = http();
          const wrap = <T extends request.Test>(req: T) => {
            req.set('Cookie', terminal);
            return claim ? req.set(ACTING_HEADER, claim) : req;
          };
          return {
            get: (u: string) => wrap(agent.get(u)),
            put: (u: string) => wrap(agent.put(u)),
            post: (u: string) => wrap(agent.post(u)),
          } as unknown as ReturnType<typeof request>;
        });
        expect([res.status, res.body.code]).toEqual([403, 'terminal_route']);
      }
      expect(await snapshot()).toEqual(before);
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
    await db(`INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'delivery_default_fee', '4000')`, [A]);
    await db(
      `INSERT INTO categories (id, name, icon, sort_order, restaurant_id) VALUES ($1, 'Platos', 'utensils', 0, $4), ($2, 'Bebidas', 'cup', 1, $4),
         ($3, 'Categoría B', 'utensils', 0, $5)`,
      [c.mains, c.drinks, c.categoryB, A, B],
    );
    await db(
      `INSERT INTO dishes (id, name, description, price, category_id, active, restaurant_id) VALUES
         ($1, 'Ajiaco', 'Sopa de la casa', 20000, $4, true, $6), ($2, 'Jugo', NULL, 6000, $5, true, $6), ($3, 'Plato B', NULL, 9000, $7, true, $8)`,
      [c.ajiaco, c.juice, c.dishB, c.mains, c.drinks, A, c.categoryB, B],
    );
    await db(`INSERT INTO dish_public_details (dish_id, restaurant_id, tags, description_en) VALUES ($1, $2, '{dairy}', 'House soup')`, [c.ajiaco, A]);
    await db(`INSERT INTO zones (id, restaurant_id, name) VALUES ($1, $2, 'Salón')`, [c.zone, A]);
    await db('INSERT INTO tables (id, number, restaurant_id, zone_id) VALUES ($1, 1, $3, $4), ($2, 2, $3, NULL)', [c.table1, c.table2, A, c.zone]);
    await db('INSERT INTO tables (id, number, restaurant_id) VALUES ($1, 1, $2)', [c.tableB, B]);
    await db(`INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, created_at) VALUES ($1, 'paid', 40000, 0, 0, 40000, $2, now())`, [
      c.paid,
      A,
    ]);
    await db(`INSERT INTO order_items (order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES ($1, $2, 'Ajiaco', 20000, 2, 'kitchen', $3)`, [
      c.paid,
      c.ajiaco,
      A,
    ]);
  }
});
