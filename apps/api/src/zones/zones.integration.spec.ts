import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const z = {
  hall: 'fa000000-0000-0000-0000-000000000001',
  terrace: 'fa000000-0000-0000-0000-000000000002',
  closed: 'fa000000-0000-0000-0000-000000000003',
  zoneB: 'fa000000-0000-0000-0000-0000000000b1',
  hallTable: 'fa100000-0000-0000-0000-000000000001',
} as const;

const ZONE_KEYS = ['active', 'aspect', 'createdAt', 'depthM', 'id', 'labels', 'name', 'sortOrder', 'updatedAt', 'widthM'];
const DIMENSIONS_TOGETHER = 'El ancho y el fondo de la zona se indican juntos';
const DIMENSIONS_RANGE = 'Las medidas de la zona deben ser mayores que 0 y de máximo 200 metros';
const HAS_TABLES = 'La zona tiene mesas; muévelas o elimínalas primero';

describe('zones endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedZones(database.superuserUrl);
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
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA);
  const waiterA = () => as(fixtures.waiterA);
  const adminB = () => as(fixtures.adminB);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const zoneCount = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM zones'))[0].n;

  it('answers 401 without the access cookie', async () => {
    expect((await request(app.getHttpServer()).get('/api/zones')).status).toBe(401);
  });

  describe('GET /zones', () => {
    it('lists the active zones by sort order then name, for any role', async () => {
      const res = await waiterA().get('/api/zones');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { name: string }) => row.name)).toEqual(['Salón', 'Barra', 'Terraza']);
      expect(Object.keys(res.body[0]).sort()).toEqual(ZONE_KEYS);
      expect(res.body.find((row: { id: string }) => row.id === z.terrace)).toMatchObject({
        name: 'Terraza',
        aspect: 2,
        sortOrder: 1,
        labels: [{ text: 'Entrada', side: 'bottom' }],
        active: true,
      });
    });

    it('includes inactive zones for an admin only', async () => {
      const res = await adminA().get('/api/zones?includeInactive=true');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toContain(z.closed);
      expect((await waiterA().get('/api/zones?includeInactive=true')).status).toBe(403);
      expect((await adminA().get('/api/zones?includeInactive=yes')).status).toBe(422);
    });

    it("never shows restaurant A's zones to restaurant B", async () => {
      const res = await adminB().get('/api/zones?includeInactive=true');
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([z.zoneB]);
    });
  });

  describe('admin writes', () => {
    it('creates a zone with defaults; the waiter gets 403 and nothing is stored', async () => {
      const res = await adminA().post('/api/zones', { name: 'Patio' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Patio', aspect: 1.6, sortOrder: 0, labels: [], active: true });
      const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM zones WHERE id = $1', [res.body.id]);
      expect(row.restaurant_id).toBe(fixtures.restaurantA);
      const before = await zoneCount();
      expect((await waiterA().post('/api/zones', { name: 'Sótano' })).status).toBe(403);
      expect(await zoneCount()).toBe(before);
    });

    it('answers 422 for invalid values and unknown fields, 409 for a duplicate name', async () => {
      const before = await zoneCount();
      for (const body of [
        {},
        { name: '  ' },
        { name: 'x'.repeat(41) },
        { name: 'Ok', aspect: 5 },
        { name: 'Ok', labels: [{ text: 'Puerta', side: 'up' }] },
        { name: 'Ok', labels: [{ text: '', side: 'top' }] },
        { name: 'Ok', restaurantId: fixtures.restaurantB },
      ]) {
        expect((await adminA().post('/api/zones', body)).status).toBe(422);
      }
      const duplicate = await adminA().post('/api/zones', { name: 'salón' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe('Ya existe una zona con ese nombre');
      expect(await zoneCount()).toBe(before);
    });

    it('patches a zone; the waiter gets 403 and B gets 404', async () => {
      const res = await adminA().patch(`/api/zones/${z.terrace}`, {
        name: 'Terraza norte',
        aspect: 1.5,
        sortOrder: 4,
        labels: [{ text: 'Cocina', side: 'top' }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Terraza norte', aspect: 1.5, sortOrder: 4, labels: [{ text: 'Cocina', side: 'top' }] });
      expect((await waiterA().patch(`/api/zones/${z.terrace}`, { name: 'X' })).status).toBe(403);
      expect((await adminB().patch(`/api/zones/${z.terrace}`, { name: 'X' })).status).toBe(404);
      expect((await adminA().patch(`/api/zones/${z.terrace}`, { aspect: 0 })).status).toBe(422);
      const [row] = await db<{ name: string }>('SELECT name FROM zones WHERE id = $1', [z.terrace]);
      expect(row.name).toBe('Terraza norte');
    });

    it('refuses to delete a zone that still has tables with 409 and keeps it', async () => {
      const res = await adminA().delete(`/api/zones/${z.hall}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: HAS_TABLES });
      expect(await db('SELECT 1 FROM zones WHERE id = $1', [z.hall])).toHaveLength(1);
    });

    it('deletes an empty zone; the waiter gets 403 and B gets 404', async () => {
      expect((await waiterA().delete(`/api/zones/${z.closed}`)).status).toBe(403);
      expect((await adminB().delete(`/api/zones/${z.closed}`)).status).toBe(404);
      expect(await db('SELECT 1 FROM zones WHERE id = $1', [z.closed])).toHaveLength(1);
      expect((await adminA().delete(`/api/zones/${z.closed}`)).status).toBe(204);
      expect(await db('SELECT 1 FROM zones WHERE id = $1', [z.closed])).toHaveLength(0);
    });
  });

  describe('zone dimensions', () => {
    it('creates and updates a zone with both dimensions, and clears them together', async () => {
      const res = await adminA().post('/api/zones', { name: 'Con medidas', widthM: 12.5, depthM: 8 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ widthM: 12.5, depthM: 8 });
      const updated = await adminA().patch(`/api/zones/${res.body.id}`, { widthM: 200, depthM: 0.5 });
      expect(updated.body).toMatchObject({ widthM: 200, depthM: 0.5 });
      expect((await adminA().patch(`/api/zones/${res.body.id}`, { name: 'Con medidas 2' })).body).toMatchObject({ widthM: 200, depthM: 0.5 });
      const cleared = await adminA().patch(`/api/zones/${res.body.id}`, { widthM: null, depthM: null });
      expect(cleared.body).toMatchObject({ widthM: null, depthM: null });
      await adminA().delete(`/api/zones/${res.body.id}`);
    });

    it('lists zones without dimensions as null', async () => {
      const res = await waiterA().get('/api/zones');
      expect(res.body.find((row: { id: string }) => row.id === z.hall)).toMatchObject({ widthM: null, depthM: null });
    });

    it.each([
      [{ widthM: 10 }, DIMENSIONS_TOGETHER],
      [{ widthM: 10, depthM: null }, DIMENSIONS_TOGETHER],
      [{ widthM: 0, depthM: 5 }, DIMENSIONS_RANGE],
      [{ widthM: 10, depthM: 200.5 }, DIMENSIONS_RANGE],
      [{ widthM: -1, depthM: 5 }, DIMENSIONS_RANGE],
    ])('refuses %o with 422 in Spanish and stores nothing', async (dimensions, message) => {
      const before = await zoneCount();
      const res = await adminA().post('/api/zones', { name: 'Medidas', ...dimensions });
      expect(res.status).toBe(422);
      expect(res.body.message).toContain(message);
      expect(await zoneCount()).toBe(before);
      const patch = await adminA().patch(`/api/zones/${z.terrace}`, dimensions);
      expect(patch.status).toBe(422);
      expect(patch.body.message).toContain(message);
      expect(await db('SELECT width_m, depth_m FROM zones WHERE id = $1', [z.terrace])).toEqual([{ width_m: null, depth_m: null }]);
    });

    it('refuses dimensions from a waiter', async () => {
      expect((await waiterA().patch(`/api/zones/${z.terrace}`, { widthM: 5, depthM: 5 })).status).toBe(403);
    });
  });
});

async function seedZones(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO zones (id, name, aspect, sort_order, labels, active, restaurant_id) VALUES
       ($1, 'Salón', 1.6, 0, '[]', true, $5),
       ($2, 'Terraza', 2, 1, '[{"text": "Entrada", "side": "bottom"}]', true, $5),
       ($3, 'Cerrada', 1.6, 0, '[]', false, $5),
       ($4, 'Zona B', 1.6, 0, '[]', true, $6),
       ('fa000000-0000-0000-0000-000000000004', 'Barra', 1.6, 1, '[]', true, $5)`,
    [z.hall, z.terrace, z.closed, z.zoneB, A, B],
  );
  await q(
    `INSERT INTO tables (id, number, status, restaurant_id, zone_id, x, y, w, h) VALUES
       ($1, 1, 'available', $2, $3, 0.5, 0.5, 0.1, 0.1)`,
    [z.hallTable, A, z.hall],
  );
}
