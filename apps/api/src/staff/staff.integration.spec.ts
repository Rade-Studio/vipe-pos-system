import { Controller, Get, type INestApplication } from '@nestjs/common';
import { sql } from '@vipe/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../db/unit-of-work';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Spec-only route: every users email vipe_api can see in the caller's transaction. */
@Controller('probe/users')
class UsersProbe {
  constructor(private readonly uow: UnitOfWork) {}

  @Get()
  async emails(): Promise<string[]> {
    const { rows } = await this.uow.db.execute(sql`SELECT email::text AS email FROM public.users ORDER BY email`);
    return rows.map((row) => row.email as string);
  }
}

const STAFF_KEYS = ['active', 'createdAt', 'email', 'fullName', 'hasPin', 'id', 'pinLockedUntil', 'role', 'userId', 'username'];
const NEW_PASSWORD = 'otra clave segura 2026';
/** A second admin of restaurant A, seeded by this spec. */
const adminA2 = {
  userId: '10000000-0000-0000-0000-0000000000a2',
  profileId: '20000000-0000-0000-0000-0000000000a2',
  email: 'admin2@a.test',
};

describe('staff endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    database = await startTestDatabase();
    await superuserQuery(
      database.superuserUrl,
      `INSERT INTO public.users (id, email, password_hash) SELECT $1, $2, password_hash FROM public.users WHERE id = $3`,
      [adminA2.userId, adminA2.email, fixtures.adminA.userId],
    );
    await superuserQuery(
      database.superuserUrl,
      `INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Admin A2', $3, 'admin', $4)`,
      [adminA2.profileId, adminA2.userId, adminA2.email, fixtures.restaurantA],
    );
    app = await createTestApp(database.apiUrl, [UsersProbe]);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      cookies[user.email] = cookiePair(setCookies(await login(user.email)).vipe_access);
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
  const countUsers = async (email: string) =>
    Number((await db<{ n: string }>('SELECT count(*) AS n FROM public.users WHERE email = $1', [email]))[0].n);

  let seq = 0;
  /** Creates a fresh staff member of restaurant A through the API. */
  const createMember = async (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    const res = await adminA().post('/api/staff', {
      email: `member${seq}@a.test`,
      password: PASSWORD,
      fullName: `Member ${seq}`,
      role: 'waiter',
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; userId: string; email: string };
  };

  describe('users visibility (RLS on public.users)', () => {
    it("an admin of A sees only A's users through vipe_api", async () => {
      const res = await adminA().get('/api/probe/users');
      expect(res.status).toBe(200);
      expect(res.body).toContain(fixtures.adminA.email);
      expect(res.body).toContain(fixtures.waiterA.email);
      expect(res.body).not.toContain(fixtures.adminB.email);
      expect(res.body.filter((email: string) => email.endsWith('@b.test'))).toEqual([]);
    });

    it("an admin of B sees only B's users", async () => {
      const res = await adminB().get('/api/probe/users');
      expect(res.body).toEqual([fixtures.adminB.email]);
    });
  });

  describe('GET /staff', () => {
    it("lists the profiles of the caller's restaurant with their login email", async () => {
      const res = await adminA().get('/api/staff');
      expect(res.status).toBe(200);
      const ids = res.body.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining([fixtures.adminA.profileId, fixtures.waiterA.profileId, adminA2.profileId]));
      expect(ids).not.toContain(fixtures.adminB.profileId);
      const waiter = res.body.find((row: { id: string }) => row.id === fixtures.waiterA.profileId);
      expect(Object.keys(waiter).sort()).toEqual(STAFF_KEYS);
      expect(waiter).toMatchObject({
        userId: fixtures.waiterA.userId,
        fullName: 'Waiter A',
        username: null,
        email: fixtures.waiterA.email,
        role: 'waiter',
        active: true,
      });
      expect(new Date(waiter.createdAt).toISOString()).toBe(waiter.createdAt);
      const names = res.body.map((row: { fullName: string }) => row.fullName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it('is admin only', async () => {
      expect((await waiterA().get('/api/staff')).status).toBe(403);
    });

    it('leaves GET /staff/waiters to the tables module (any role)', async () => {
      const res = await waiterA().get('/api/staff/waiters');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { id: string }) => row.id)).toContain(fixtures.waiterA.profileId);
    });
  });

  describe('POST /staff', () => {
    it('creates the login and the profile in the caller restaurant; the account logs in', async () => {
      const res = await adminA().post('/api/staff', {
        email: '  New.Cook@A.test ',
        password: PASSWORD,
        fullName: ' Cook A ',
        role: 'kitchen',
        username: 'cook',
      });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(STAFF_KEYS);
      expect(res.body).toMatchObject({ fullName: 'Cook A', username: 'cook', email: 'new.cook@a.test', role: 'kitchen', active: true });
      const [row] = await db<{ restaurant_id: string; password_algo: string }>(
        `SELECT p.restaurant_id, u.password_algo FROM public.profiles p JOIN public.users u ON u.id = p.user_id WHERE p.id = $1`,
        [res.body.id],
      );
      expect(row).toEqual({ restaurant_id: fixtures.restaurantA, password_algo: 'argon2id' });
      const session = await login('new.cook@a.test');
      expect(session.status).toBe(200);
      expect(session.body.profile).toMatchObject({ id: res.body.id, role: 'kitchen', restaurantId: fixtures.restaurantA });
    });

    it('creates every allowed role and keeps active: false', async () => {
      for (const role of ['waiter', 'cashier', 'delivery_operator']) {
        const member = await createMember({ role, active: false });
        expect(member).toMatchObject({ role, active: false });
      }
    });

    it('answers 409 with the Spanish message for a duplicate email (any case) and writes nothing', async () => {
      const before = await db('SELECT count(*) AS n FROM public.profiles');
      const res = await adminA().post('/api/staff', {
        email: 'WAITER@a.test',
        password: PASSWORD,
        fullName: 'Dup',
        role: 'waiter',
      });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Ya existe una cuenta con ese correo electrónico' });
      expect(await db('SELECT count(*) AS n FROM public.profiles')).toEqual(before);
    });

    it.each([
      [{ role: 'admin' }, 'El rol no es válido'],
      [{ role: 'superuser' }, 'El rol no es válido'],
      [{ email: 'not-an-email' }, 'El correo electrónico no es válido'],
      [{ password: 'short' }, 'La contraseña debe tener al menos 8 caracteres'],
      [{ password: 'x'.repeat(129) }, 'La contraseña no cumple los requisitos de seguridad'],
      [{ fullName: '   ' }, 'El nombre debe tener entre 1 y 100 caracteres'],
      [{ restaurantId: fixtures.restaurantB }, 'Solicitud inválida'],
    ])('answers 422 for %o with the Spanish message and creates nothing', async (override, message) => {
      const email = `invalid${Math.random().toString(36).slice(2)}@a.test`;
      const res = await adminA().post('/api/staff', { email, password: PASSWORD, fullName: 'X', role: 'waiter', ...override });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message });
      expect(await countUsers(email)).toBe(0);
    });

    it('answers 409 with the Spanish message for a duplicate username and writes nothing', async () => {
      await createMember({ username: 'taken-name' });
      const email = 'dup-username@a.test';
      const res = await adminA().post('/api/staff', { email, password: PASSWORD, fullName: 'X', role: 'waiter', username: 'taken-name' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Ya existe un integrante con ese nombre de usuario' });
      expect(await countUsers(email)).toBe(0);
      const member = await createMember();
      const patched = await adminA().patch(`/api/staff/${member.id}`, { username: 'taken-name' });
      expect(patched.status).toBe(409);
      expect(patched.body.message).toBe('Ya existe un integrante con ese nombre de usuario');
    });

    it('is refused for a waiter and creates nothing', async () => {
      const res = await waiterA().post('/api/staff', { email: 'w2@a.test', password: PASSWORD, fullName: 'W', role: 'waiter' });
      expect(res.status).toBe(403);
      expect(await countUsers('w2@a.test')).toBe(0);
    });
  });

  describe('PATCH /staff/:id', () => {
    it('updates the fields of a staff member', async () => {
      const member = await createMember();
      const res = await adminA().patch(`/api/staff/${member.id}`, {
        fullName: 'Renamed',
        username: 'renamed',
        active: false,
        role: 'cashier',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: member.id, fullName: 'Renamed', username: 'renamed', active: false, role: 'cashier' });
      const cleared = await adminA().patch(`/api/staff/${member.id}`, { username: null });
      expect(cleared.body).toMatchObject({ fullName: 'Renamed', username: null, active: false, role: 'cashier' });
    });

    it('refuses the admin role with the Spanish message', async () => {
      const member = await createMember();
      const res = await adminA().patch(`/api/staff/${member.id}`, { role: 'admin' });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('El rol no es válido');
      expect((await db('SELECT role FROM public.profiles WHERE id = $1', [member.id]))[0]).toEqual({ role: 'waiter' });
    });

    it('refuses an admin target, the caller and another restaurant', async () => {
      expect((await adminA().patch(`/api/staff/${adminA2.profileId}`, { fullName: 'X' })).status).toBe(403);
      expect((await adminA().patch(`/api/staff/${fixtures.adminA.profileId}`, { fullName: 'X' })).status).toBe(403);
      expect((await adminB().patch(`/api/staff/${fixtures.waiterA.profileId}`, { fullName: 'X' })).status).toBe(404);
      expect((await waiterA().patch(`/api/staff/${fixtures.waiterA.profileId}`, { fullName: 'X' })).status).toBe(403);
      const names = await db('SELECT full_name FROM public.profiles WHERE id = ANY($1) ORDER BY full_name', [
        [adminA2.profileId, fixtures.adminA.profileId, fixtures.waiterA.profileId],
      ]);
      expect(names).toEqual([{ full_name: 'Admin A' }, { full_name: 'Admin A2' }, { full_name: 'Waiter A' }]);
    });

    it('deactivating a member locks its session out with 403 on /me', async () => {
      const member = await createMember();
      const session = cookiePair(setCookies(await login(member.email)).vipe_access);
      expect((await adminA().patch(`/api/staff/${member.id}`, { active: false })).status).toBe(200);
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', session);
      expect(me.status).toBe(403);
      expect(me.body.message).toBe('No active profile for this account');
    });

    it('answers 422 for unknown fields and an invalid id', async () => {
      expect((await adminA().patch(`/api/staff/${fixtures.waiterA.profileId}`, { email: 'x@a.test' })).status).toBe(422);
      expect((await adminA().patch('/api/staff/not-a-uuid', { fullName: 'X' })).status).toBe(422);
    });
  });

  describe('POST /staff/:id/password', () => {
    it('replaces the password: the new one logs in, the old one does not, sessions end', async () => {
      const member = await createMember();
      const old = await login(member.email);
      expect(old.status).toBe(200);
      const res = await adminA().post(`/api/staff/${member.id}/password`, { password: NEW_PASSWORD });
      expect(res.status).toBe(204);
      expect((await login(member.email)).status).toBe(401);
      expect((await login(member.email, NEW_PASSWORD)).status).toBe(200);
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookiePair(setCookies(old).vipe_access));
      expect(me.status).toBe(401);
    });

    it('refuses an admin target, the caller, another restaurant and a short password', async () => {
      const body = { password: NEW_PASSWORD };
      expect((await adminA().post(`/api/staff/${adminA2.profileId}/password`, body)).status).toBe(403);
      expect((await adminA().post(`/api/staff/${fixtures.adminA.profileId}/password`, body)).status).toBe(403);
      expect((await adminB().post(`/api/staff/${fixtures.waiterA.profileId}/password`, body)).status).toBe(404);
      expect((await waiterA().post(`/api/staff/${fixtures.waiterA.profileId}/password`, body)).status).toBe(403);
      const short = await adminA().post(`/api/staff/${fixtures.waiterA.profileId}/password`, { password: 'short' });
      expect(short.status).toBe(422);
      expect(short.body.message).toBe('La contraseña debe tener al menos 8 caracteres');
      expect((await login(fixtures.waiterA.email)).status).toBe(200);
    });
  });

  describe('DELETE /staff/:id', () => {
    it('deletes the login: the profile cascades and the account no longer logs in', async () => {
      const member = await createMember();
      expect((await login(member.email)).status).toBe(200);
      const res = await adminA().delete(`/api/staff/${member.id}`);
      expect(res.status).toBe(204);
      expect(await countUsers(member.email)).toBe(0);
      expect(await db('SELECT id FROM public.profiles WHERE id = $1', [member.id])).toEqual([]);
      expect((await login(member.email)).status).toBe(401);
    });

    it('deletes a member with paid orders: orders keep no waiter and its session ends', async () => {
      const member = await createMember();
      const session = cookiePair(setCookies(await login(member.email)).vipe_access);
      const [order] = await db<{ id: string }>(
        `INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total, waiter_id, restaurant_id)
         VALUES ('paid', 10, 0, 0, 10, $1, $2) RETURNING id`,
        [member.id, fixtures.restaurantA],
      );
      expect((await adminA().delete(`/api/staff/${member.id}`)).status).toBe(204);
      expect(await db('SELECT waiter_id FROM public.orders WHERE id = $1', [order.id])).toEqual([{ waiter_id: null }]);
      expect((await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', session)).status).toBe(401);
    });

    it('refuses an admin target, the caller, another restaurant and a waiter caller', async () => {
      expect((await adminA().delete(`/api/staff/${adminA2.profileId}`)).status).toBe(403);
      expect((await adminA().delete(`/api/staff/${fixtures.adminA.profileId}`)).status).toBe(403);
      expect((await adminB().delete(`/api/staff/${fixtures.waiterA.profileId}`)).status).toBe(404);
      expect((await waiterA().delete(`/api/staff/${fixtures.waiterA.profileId}`)).status).toBe(403);
      expect(await countUsers(fixtures.waiterA.email)).toBe(1);
      expect(await countUsers(adminA2.email)).toBe(1);
    });

    it('refuses a member with assigned tables with the Spanish message', async () => {
      const member = await createMember();
      await db(`INSERT INTO public.tables (number, status, waiter_id, restaurant_id) VALUES (901, 'occupied', $1, $2)`, [
        member.id,
        fixtures.restaurantA,
      ]);
      const res = await adminA().delete(`/api/staff/${member.id}`);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('El integrante tiene mesas asignadas');
      expect(await countUsers(member.email)).toBe(1);
    });
  });
});
