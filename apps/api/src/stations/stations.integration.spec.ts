import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Catalog rows seeded as the superuser for this spec only (F6). */
const s = {
  mains: 'f6100000-0000-0000-0000-000000000001',
  drinks: 'f6100000-0000-0000-0000-000000000002',
  specials: 'f6100000-0000-0000-0000-000000000003',
  drinksB: 'f6100000-0000-0000-0000-0000000000b1',
  bandeja: 'f6200000-0000-0000-0000-000000000001',
  lulo: 'f6200000-0000-0000-0000-000000000002',
  limonada: 'f6200000-0000-0000-0000-000000000003',
  lechona: 'f6200000-0000-0000-0000-000000000004',
} as const;

const STATION_KEYS = ['color', 'createdAt', 'id', 'isDefault', 'kind', 'name', 'sortOrder', 'updatedAt'];

describe('stations and routes (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let ids: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    const q = (text: string, values: unknown[]) => superuserQuery(database.superuserUrl, text, values);
    await q(
      `INSERT INTO categories (id, name, icon, sort_order, restaurant_id) VALUES
         ($1, 'Platos fuertes', 'beef', 0, $5), ($2, 'Bebidas', 'water', 1, $5), ($3, 'Especiales del día', 'star', 2, $5),
         ($4, 'Bebidas B', 'water', 0, $6)`,
      [s.mains, s.drinks, s.specials, s.drinksB, fixtures.restaurantA, fixtures.restaurantB],
    );
    await q(
      `INSERT INTO dishes (id, name, price, category_id, restaurant_id) VALUES
         ($1, 'Bandeja paisa', 30000, $5, $8), ($2, 'Jugo de lulo', 8000, $6, $8),
         ($3, 'Limonada de coco', 9000, $6, $8), ($4, 'Lechona tolimense', 25000, $7, $8)`,
      [s.bandeja, s.lulo, s.limonada, s.lechona, s.mains, s.drinks, s.specials, fixtures.restaurantA],
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

  const as = (user: { email: string }) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[user.email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      delete: (url: string, body?: object) => server.delete(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA);
  const waiterA = () => as(fixtures.waiterA);
  const adminB = () => as(fixtures.adminB);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const stationCount = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM stations'))[0].n;

  it('lists no stations before the restaurant creates any', async () => {
    const res = await waiterA().get('/api/stations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('refuses station writes to a waiter and leaves nothing stored', async () => {
    const res = await waiterA().post('/api/stations/starter');
    expect(res.status).toBe(403);
    expect((await waiterA().post('/api/stations', { name: 'Parrilla' })).status).toBe(403);
    expect(await stationCount()).toBe(0);
  });

  it('creates Cocina, Barra and Caja in one call; Cocina is the default', async () => {
    const res = await adminA().post('/api/stations/starter');
    expect(res.status).toBe(201);
    expect(res.body.map((st: { name: string; kind: string; color: string; isDefault: boolean }) => [st.name, st.kind, st.color, st.isDefault])).toEqual([
      ['Cocina', 'prep', 'kitchen', true],
      ['Barra', 'prep', 'served', false],
      ['Caja', 'cashier', 'occupied', false],
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(STATION_KEYS);
    ids = Object.fromEntries(res.body.map((st: { name: string; id: string }) => [st.name, st.id]));
    const again = await adminA().post('/api/stations/starter');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'stations_exist', message: 'El restaurante ya tiene estaciones' });
    expect(await stationCount()).toBe(3);
  });

  it('creates, validates and renames a station', async () => {
    const created = await adminA().post('/api/stations', { name: 'Postres', color: 'free' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Postres', kind: 'prep', color: 'free', isDefault: false, sortOrder: 3 });
    ids.Postres = created.body.id;
    const dup = await adminA().post('/api/stations', { name: ' postres ' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'station_name_taken', message: 'Ya existe una estación con ese nombre' });
    const cashier = await adminA().post('/api/stations', { name: 'Caja 2', kind: 'cashier' });
    expect(cashier.status).toBe(409);
    expect(cashier.body).toMatchObject({ code: 'cashier_exists', message: 'El restaurante ya tiene su estación Caja' });
    expect((await adminA().post('/api/stations', { name: 'Horno', color: 'pink' })).status).toBe(422);
    expect((await adminA().post('/api/stations', { name: '' })).status).toBe(422);
    expect((await adminA().post('/api/stations', { name: 'X', isDefault: true })).status).toBe(422);
    expect(await stationCount()).toBe(4);
    const renamed = await adminA().patch(`/api/stations/${ids.Barra}`, { name: 'Barra fría' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: ids.Barra, name: 'Barra fría', color: 'served' });
  });

  it('keeps stations and routes per restaurant', async () => {
    expect((await adminB().get('/api/stations')).body).toEqual([]);
    expect((await adminB().patch(`/api/stations/${ids.Cocina}`, { name: 'Mía' })).status).toBe(404);
    const del = await adminB().delete(`/api/stations/${ids.Postres}`, { moveTo: null });
    expect(del.status).toBe(404);
    expect(del.body).toMatchObject({ code: 'station_not_found' });
    const route = await adminB().put(`/api/stations/routes/categories/${s.drinksB}`, { stationId: ids.Barra });
    expect(route.status).toBe(422);
    expect(route.body).toMatchObject({ code: 'station_invalid' });
    expect((await adminB().put(`/api/stations/routes/categories/${s.drinks}`, { stationId: null })).status).toBe(404);
    expect((await db<{ name: string }>('SELECT name FROM stations WHERE id = $1', [ids.Cocina]))[0].name).toBe('Cocina');
  });

  it('routes categories and dish exceptions, never to Caja', async () => {
    expect((await adminA().put(`/api/stations/routes/categories/${s.mains}`, { stationId: ids.Cocina })).status).toBe(204);
    expect((await adminA().put(`/api/stations/routes/categories/${s.drinks}`, { stationId: ids.Barra })).status).toBe(204);
    expect((await adminA().put(`/api/stations/routes/dishes/${s.limonada}`, { stationId: ids.Cocina })).status).toBe(204);
    const caja = await adminA().put(`/api/stations/routes/categories/${s.specials}`, { stationId: ids.Caja });
    expect(caja.status).toBe(422);
    expect(caja.body).toMatchObject({ code: 'cashier_route', message: 'Caja recibe facturas y precuentas; elige una estación de preparación' });
    expect((await waiterA().put(`/api/stations/routes/dishes/${s.lulo}`, { stationId: ids.Cocina })).status).toBe(403);
    expect((await db<{ station_id: string | null }>('SELECT station_id FROM dishes WHERE id = $1', [s.lulo]))[0].station_id).toBeNull();
  });

  it('reads the routes with the resolved station and the dishes without one', async () => {
    const res = await adminA().get('/api/stations/routes');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([
      { id: s.mains, name: 'Platos fuertes', stationId: ids.Cocina, dishCount: 1 },
      { id: s.drinks, name: 'Bebidas', stationId: ids.Barra, dishCount: 2 },
      { id: s.specials, name: 'Especiales del día', stationId: null, dishCount: 1 },
    ]);
    const dish = (id: string) => res.body.dishes.find((d: { id: string }) => d.id === id);
    expect(dish(s.limonada)).toMatchObject({ categoryId: s.drinks, stationId: ids.Cocina, routedStationId: ids.Cocina, source: 'dish' });
    expect(dish(s.lulo)).toMatchObject({ stationId: null, routedStationId: ids.Barra, source: 'category' });
    expect(dish(s.lechona)).toMatchObject({ stationId: null, routedStationId: ids.Cocina, source: 'fallback' });
    expect(res.body.unroutedDishes).toEqual([
      { id: s.lechona, name: 'Lechona tolimense', categoryId: s.specials, categoryName: 'Especiales del día' },
    ]);
    expect((await waiterA().get('/api/stations/routes')).status).toBe(403);
  });

  it('deletes a station only by moving its routes; Caja stays', async () => {
    const cashier = await adminA().delete(`/api/stations/${ids.Caja}`, { moveTo: ids.Cocina });
    expect(cashier.status).toBe(409);
    expect(cashier.body).toMatchObject({ code: 'cashier_station', message: 'La estación Caja no se puede eliminar' });
    const missing = await adminA().delete(`/api/stations/${ids.Barra}`, {});
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ code: 'move_required', message: 'Elige a qué estación pasan sus categorías y platos' });
    const toCaja = await adminA().delete(`/api/stations/${ids.Barra}`, { moveTo: ids.Caja });
    expect(toCaja.status).toBe(422);
    expect(toCaja.body).toMatchObject({ code: 'target_invalid' });
    expect(await stationCount()).toBe(4);
    expect((await adminA().delete(`/api/stations/${ids.Barra}`, { moveTo: ids.Postres })).status).toBe(204);
    expect((await db<{ station_id: string }>('SELECT station_id FROM categories WHERE id = $1', [s.drinks]))[0].station_id).toBe(ids.Postres);
    expect((await adminA().get('/api/stations')).body.map((st: { name: string }) => st.name)).toEqual(['Cocina', 'Postres', 'Caja']);
  });
});
