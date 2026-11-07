import { Body, Controller, HttpCode, type INestApplication, Logger, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createDb } from '@vipe/db';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';
import { ACTING_HEADER } from './terminal-access';
import { SupervisorAuthorizationsService } from './supervisor-authorizations.service';

/** Spec-only route: what F1 will do before a cancellation or void (F1 imports AuthModule). */
@Controller('probe/authorizations')
class ConsumeProbe {
  constructor(private readonly moduleRef: ModuleRef) {}

  @Post('consume')
  @HttpCode(200)
  consume(@Body() body: { authorizationId: string; action: string }) {
    return this.moduleRef.get(SupervisorAuthorizationsService, { strict: false }).consume(body.authorizationId, body.action);
  }
}

const A = fixtures.restaurantA;
const B = fixtures.restaurantB;
const ids = {
  cashierUser: '10000000-0000-0000-0000-0000000000c1',
  cashier: '20000000-0000-0000-0000-0000000000c1',
  waiter2User: '10000000-0000-0000-0000-0000000000c2',
  waiter2: '20000000-0000-0000-0000-0000000000c2',
  waiterBUser: '10000000-0000-0000-0000-0000000000c3',
  waiterB: '20000000-0000-0000-0000-0000000000c3',
  cookUser: '10000000-0000-0000-0000-0000000000c4',
  cook: '20000000-0000-0000-0000-0000000000c4',
  dish: '30000000-0000-0000-0000-0000000000d1',
  tables: [
    '40000000-0000-0000-0000-0000000000e1',
    '40000000-0000-0000-0000-0000000000e2',
    '40000000-0000-0000-0000-0000000000e3',
    '40000000-0000-0000-0000-0000000000e4',
  ],
  unknown: '20000000-0000-0000-0000-00000000ffff',
};
const emails = { cashier: 'cashier@a.test', waiter2: 'waiter2@a.test', waiterB: 'waiter@b.test', cook: 'cook@a.test' };
const PINS = { waiter: '4829', waiter2: '73914', cashier: '582046', admin: '9157', waiterB: '6408' };

const MESSAGES = {
  format: 'El PIN debe tener entre 4 y 6 dígitos',
  weak: 'El PIN es muy fácil de adivinar: no uses el mismo dígito, números consecutivos ni patrones repetidos',
  wrong: 'PIN incorrecto',
  locked: 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo',
  noPin: 'Aún no tienes un PIN; pídele al administrador que te asigne uno',
  terminalOnly: 'Esta acción solo está disponible en una terminal compartida',
  terminalRoute: 'Esta terminal no puede acceder a esta sección',
  actingRequired: 'Identifícate con tu PIN para registrar el pedido',
  opener: 'Solo un administrador o cajero puede abrir una terminal compartida',
  authorization: 'La autorización del supervisor no es válida, expiró o ya fue usada',
};

describe('staff PINs, shared terminals and supervisor authorization (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const server = () => request(app.getHttpServer());
  const login = (email: string) => server().post('/api/auth/login').send({ email, password: PASSWORD });
  const openTerminal = async (email: string) => {
    const res = await server().post('/api/auth/terminal/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return cookiePair(setCookies(res).vipe_access);
  };
  const as = (cookie: string) => ({
    get: (url: string) => server().get(url).set('Cookie', cookie),
    post: (url: string, body?: object, acting?: string) => {
      const req = server().post(url).set('Cookie', cookie);
      return (acting ? req.set(ACTING_HEADER, acting) : req).send(body);
    },
    put: (url: string, body?: object) => server().put(url).set('Cookie', cookie).send(body),
    delete: (url: string) => server().delete(url).set('Cookie', cookie),
  });
  const freshLogin = async (email: string) => cookiePair(setCookies(await login(email)).vipe_access);
  const admin = () => as(cookies.adminA);
  const waiter = () => as(cookies.waiterA);
  const setPin = (profileId: string, pin: unknown) => admin().put(`/api/staff/${profileId}/pin`, { pin });
  /** The PIN row with its profile-scope counter (private.pin_attempts, readable by the superuser). */
  const pinRow = async (profileId: string) =>
    (
      await db<{ pin_hash: string; pin_pepper_version: number; failed_attempts: number; locked_until: Date | null; set_by: string | null }>(
        `SELECT sp.pin_hash, sp.pin_pepper_version, coalesce(a.failed_attempts, 0) AS failed_attempts, a.locked_until, sp.set_by
           FROM staff_pins sp
           LEFT JOIN private.pin_attempts a ON a.scope = 'profile' AND a.subject_id = sp.profile_id
          WHERE sp.profile_id = $1`,
        [profileId],
      )
    )[0];
  const identify = (terminal: string, profileId: string, pin: string) =>
    as(terminal).post('/api/auth/identify', { profileId, pin });
  const actingToken = async (terminal: string, profileId: string, pin: string) => {
    const res = await identify(terminal, profileId, pin);
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  const setMode = async (mode: 'own_accounts' | 'shared_terminal') => {
    expect((await admin().put('/api/config', { waiterAccessMode: mode })).status).toBe(200);
  };
  const orderCount = async () => Number((await db<{ n: string }>('SELECT count(*) AS n FROM orders'))[0].n);
  const resetTables = () => db(`UPDATE orders SET status = 'paid' WHERE table_id = ANY($1)`, [ids.tables]);

  beforeAll(async () => {
    database = await startTestDatabase();
    const users: [string, string][] = [
      [ids.cashierUser, emails.cashier],
      [ids.waiter2User, emails.waiter2],
      [ids.waiterBUser, emails.waiterB],
      [ids.cookUser, emails.cook],
    ];
    for (const [id, email] of users) {
      await db('INSERT INTO users (id, email, password_hash, password_algo) SELECT $1, $2, password_hash, password_algo FROM users WHERE id = $3', [
        id,
        email,
        fixtures.adminA.userId,
      ]);
    }
    await db(
      `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
         ($1, $2, 'Cashier A', $3, 'cashier', $4), ($5, $6, 'Waiter Two', $7, 'waiter', $4),
         ($8, $9, 'Waiter B', $10, 'waiter', $11), ($12, $13, 'Cook A', $14, 'kitchen', $4)`,
      [
        ids.cashier, ids.cashierUser, emails.cashier, A, ids.waiter2, ids.waiter2User, emails.waiter2,
        ids.waiterB, ids.waiterBUser, emails.waiterB, B, ids.cook, ids.cookUser, emails.cook,
      ],
    );
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [ids.dish, A]);
    for (const [index, id] of ids.tables.entries()) {
      await db(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, $2, 'available', $3)`, [id, 270 + index, A]);
    }
    app = await createTestApp(database.apiUrl, [ConsumeProbe]);
    const sessions: [string, string][] = [
      ['adminA', fixtures.adminA.email],
      ['waiterA', fixtures.waiterA.email],
      ['adminB', fixtures.adminB.email],
      ['waiter2', emails.waiter2],
      ['cook', emails.cook],
    ];
    for (const [key, email] of sessions) {
      cookies[key] = cookiePair(setCookies(await login(email)).vipe_access);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('admin sets, resets and removes PINs', () => {
    it('stores only an argon2id hash, records who set it and lists hasPin', async () => {
      const res = await setPin(fixtures.waiterA.profileId, PINS.waiter);
      expect(res.status).toBe(204);
      const row = await pinRow(fixtures.waiterA.profileId);
      expect(row.pin_hash).toMatch(/^\$argon2id\$/);
      expect(row.pin_hash).not.toContain(PINS.waiter);
      expect(row.set_by).toBe(fixtures.adminA.profileId);
      const list = await admin().get('/api/staff');
      const member = list.body.find((m: { id: string }) => m.id === fixtures.waiterA.profileId);
      expect(member).toMatchObject({ hasPin: true, pinLockedUntil: null });
      const cook = list.body.find((m: { id: string }) => m.id === ids.cook);
      expect(cook).toMatchObject({ hasPin: false, pinLockedUntil: null });
      for (const [id, pin] of [
        [ids.waiter2, PINS.waiter2],
        [ids.cashier, PINS.cashier],
        [fixtures.adminA.profileId, PINS.admin],
      ]) {
        expect((await setPin(id, pin)).status).toBe(204);
      }
    });

    it.each([
      ['1111', MESSAGES.weak],
      ['000000', MESSAGES.weak],
      ['1234', MESSAGES.weak],
      ['4321', MESSAGES.weak],
      ['7890', MESSAGES.weak],
      ['987654', MESSAGES.weak],
      ['1212', MESSAGES.weak],
      ['456456', MESSAGES.weak],
      ['123', MESSAGES.format],
      ['1234567', MESSAGES.format],
      ['12a4', MESSAGES.format],
      [4829, MESSAGES.format],
    ])('refuses %o with 422 and keeps the stored PIN', async (pin, message) => {
      const before = await pinRow(fixtures.waiterA.profileId);
      const res = await setPin(fixtures.waiterA.profileId, pin);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message });
      expect(await pinRow(fixtures.waiterA.profileId)).toEqual(before);
    });

    it('is admin only and never reaches another restaurant', async () => {
      const before = await pinRow(fixtures.waiterA.profileId);
      expect((await waiter().put(`/api/staff/${fixtures.waiterA.profileId}/pin`, { pin: '5820' })).status).toBe(403);
      expect((await waiter().delete(`/api/staff/${fixtures.waiterA.profileId}/pin`)).status).toBe(403);
      expect(await pinRow(fixtures.waiterA.profileId)).toEqual(before);
      expect((await setPin(ids.waiterB, PINS.waiterB)).status).toBe(404);
      expect(await pinRow(ids.waiterB)).toBeUndefined();
      expect((await as(cookies.adminB).put(`/api/staff/${ids.waiterB}/pin`, { pin: PINS.waiterB })).status).toBe(204);
    });

    it('removes a PIN (idempotent)', async () => {
      expect((await setPin(ids.cook, '6031')).status).toBe(204);
      expect((await admin().delete(`/api/staff/${ids.cook}/pin`)).status).toBe(204);
      expect(await pinRow(ids.cook)).toBeUndefined();
      expect((await admin().delete(`/api/staff/${ids.cook}/pin`)).status).toBe(204);
    });
  });

  describe('a staff member changes their own PIN', () => {
    it('with the current PIN', async () => {
      const before = await pinRow(ids.waiter2);
      const res = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '30517' });
      expect(res.status).toBe(204);
      const after = await pinRow(ids.waiter2);
      expect(after.pin_hash).not.toBe(before.pin_hash);
      expect(after.set_by).toBe(ids.waiter2);
      PINS.waiter2 = '30517';
    });

    it('refuses a wrong current PIN, counts the failure and keeps the PIN', async () => {
      const before = await pinRow(ids.waiter2);
      const res = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: '000111', pin: '61842' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ statusCode: 403, message: MESSAGES.wrong, code: 'pin_invalid' });
      const after = await pinRow(ids.waiter2);
      expect(after.pin_hash).toBe(before.pin_hash);
      expect(after.failed_attempts).toBe(before.failed_attempts + 1);
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter2 })).status).toBe(204);
      expect((await pinRow(ids.waiter2)).failed_attempts).toBe(0);
    });

    it('refuses a weak new PIN and a member without PIN', async () => {
      const weak = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '2222' });
      expect(weak.status).toBe(422);
      expect(weak.body.message).toBe(MESSAGES.weak);
      const none = await as(cookies.cook).put('/api/auth/pin', { currentPin: '6031', pin: '61842' });
      expect(none.status).toBe(422);
      expect(none.body.message).toBe(MESSAGES.noPin);
    });
  });

  describe('terminal sessions', () => {
    it('opens only for an admin or cashier and leaves the normal login unchanged', async () => {
      const before = Number((await db<{ n: string }>("SELECT count(*) AS n FROM auth_sessions WHERE kind = 'terminal'"))[0].n);
      const refused = await server().post('/api/auth/terminal/login').send({ email: fixtures.waiterA.email, password: PASSWORD });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(MESSAGES.opener);
      expect(setCookies(refused).vipe_access).toBeUndefined();
      const wrong = await server().post('/api/auth/terminal/login').send({ email: emails.cashier, password: 'nope' });
      expect(wrong.status).toBe(401);
      expect(Number((await db<{ n: string }>("SELECT count(*) AS n FROM auth_sessions WHERE kind = 'terminal'"))[0].n)).toBe(before);

      const res = await server().post('/api/auth/terminal/login').send({ email: emails.cashier, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ sessionKind: 'terminal', profile: { id: ids.cashier, role: 'cashier' } });
      expect(decodeJwt(cookiePair(setCookies(res).vipe_access).split('=')[1])).toMatchObject({ knd: 'terminal' });
      const me = await as(cookiePair(setCookies(res).vipe_access)).get('/api/auth/me');
      expect(me.body.sessionKind).toBe('terminal');

      const normal = await login(emails.cashier);
      expect(normal.body.sessionKind).toBe('user');
      expect(Object.keys(decodeJwt(cookiePair(setCookies(normal).vipe_access).split('=')[1])).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    });

    it('keeps the terminal kind across a refresh', async () => {
      const res = await server().post('/api/auth/terminal/login').send({ email: emails.cashier, password: PASSWORD });
      const refreshed = await server().post('/api/auth/refresh').set('Cookie', cookiePair(setCookies(res).vipe_refresh));
      expect(refreshed.status).toBe(204);
      expect(decodeJwt(cookiePair(setCookies(refreshed).vipe_access).split('=')[1])).toMatchObject({ knd: 'terminal' });
    });

    it('cannot reach admin endpoints, even when an admin opened it', async () => {
      const terminal = as(await openTerminal(fixtures.adminA.email));
      for (const res of [
        await terminal.get('/api/staff'),
        await terminal.put('/api/config', { taxPercentage: 1 }),
        await terminal.get('/api/dashboard/summary'),
        await terminal.put('/api/auth/pin', { currentPin: PINS.admin, pin: '61842' }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ message: MESSAGES.terminalRoute, code: 'terminal_route' });
      }
      expect((await terminal.get('/api/config')).status).toBe(200);
      expect((await terminal.get('/api/staff/waiters')).status).toBe(200);
      expect((await terminal.get('/api/tables')).status).toBe(200);
    });

    it('identifies staff only on a terminal, with one answer for every wrong case', async () => {
      const fromUser = await waiter().post('/api/auth/identify', { profileId: fixtures.waiterA.profileId, pin: PINS.waiter });
      expect(fromUser.status).toBe(403);
      expect(fromUser.body.message).toBe(MESSAGES.terminalOnly);

      const terminal = await openTerminal(emails.cashier);
      const bodies = [];
      for (const [profileId, pin] of [
        [fixtures.waiterA.profileId, '5820'],
        [ids.unknown, PINS.waiter],
        [ids.waiterB, PINS.waiterB],
        [ids.cook, '6031'],
      ]) {
        const res = await identify(terminal, profileId, pin);
        expect(res.status).toBe(403);
        bodies.push(res.body);
      }
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
      expect(bodies[0]).toEqual({ statusCode: 403, error: 'Forbidden', message: MESSAGES.wrong, code: 'pin_invalid' });

      const ok = await identify(terminal, fixtures.waiterA.profileId, PINS.waiter);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ profile: { id: fixtures.waiterA.profileId, name: 'Waiter A', role: 'waiter' } });
      const ttl = new Date(ok.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(4 * 60_000);
      expect(ttl).toBeLessThanOrEqual(5 * 60_000);
    });
  });

  describe('order writes on a terminal', () => {
    const items = [{ dishId: ids.dish, quantity: 1 }];

    it('in shared_terminal mode require the acting claim and record the real waiter', async () => {
      await setMode('shared_terminal');
      await resetTables();
      const terminal = await openTerminal(emails.cashier);
      const before = await orderCount();
      const refused = await as(terminal).post('/api/orders', { tableId: ids.tables[0], items });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ message: MESSAGES.actingRequired, code: 'acting_required' });
      expect(await orderCount()).toBe(before);

      const token = await actingToken(terminal, fixtures.waiterA.profileId, PINS.waiter);
      const created = await as(terminal).post('/api/orders', { tableId: ids.tables[0], items }, token);
      expect(created.status).toBe(201);
      const [order] = await db<{ waiter_id: string; created_by_profile_id: string }>(
        'SELECT waiter_id, created_by_profile_id FROM orders WHERE id = $1',
        [created.body.id],
      );
      expect(order).toEqual({ waiter_id: fixtures.waiterA.profileId, created_by_profile_id: fixtures.waiterA.profileId });

      const other = await actingToken(terminal, ids.waiter2, PINS.waiter2);
      const added = await as(terminal).post(`/api/orders/${created.body.id}/items`, { items }, other);
      expect(added.status).toBe(201);
      const rows = await db<{ created_by_profile_id: string }>(
        'SELECT created_by_profile_id FROM order_items WHERE order_id = $1 ORDER BY created_at, id',
        [created.body.id],
      );
      expect(rows.map((row) => row.created_by_profile_id)).toEqual([fixtures.waiterA.profileId, ids.waiter2]);

      const noClaim = await as(terminal).post(`/api/orders/${created.body.id}/items`, { items });
      expect(noClaim.status).toBe(403);
      expect(noClaim.body.code).toBe('acting_required');
    });

    it('refuses a claim of another terminal, an expired claim and a claim used as a cookie', async () => {
      const t1 = await openTerminal(emails.cashier);
      const t2 = await openTerminal(emails.cashier);
      const token = await actingToken(t1, fixtures.waiterA.profileId, PINS.waiter);
      const before = await orderCount();
      const foreign = await as(t2).post('/api/orders', { tableId: ids.tables[1], items }, token);
      expect(foreign.status).toBe(403);
      expect(foreign.body.code).toBe('acting_required');

      const clock = app.get(Clock);
      vi.spyOn(clock, 'now').mockReturnValue(new Date(Date.now() - 6 * 60_000));
      const stale = await actingToken(t1, fixtures.waiterA.profileId, PINS.waiter);
      vi.restoreAllMocks();
      const expired = await as(t1).post('/api/orders', { tableId: ids.tables[1], items }, stale);
      expect(expired.status).toBe(403);
      expect(expired.body.code).toBe('acting_required');

      const asCookie = await server().post('/api/orders').set('Cookie', `vipe_access=${token}`).send({ tableId: ids.tables[1], items });
      expect(asCookie.status).toBe(401);
      expect(await orderCount()).toBe(before);
    });

    it('ends the acting sessions when the terminal logs out', async () => {
      const res = await server().post('/api/auth/terminal/login').send({ email: emails.cashier, password: PASSWORD });
      const terminal = cookiePair(setCookies(res).vipe_access);
      const token = await actingToken(terminal, fixtures.waiterA.profileId, PINS.waiter);
      await server().post('/api/auth/logout').set('Cookie', cookiePair(setCookies(res).vipe_refresh));
      const sid = decodeJwt(token).sid as string;
      const [row] = await db<{ revoked_at: Date | null }>('SELECT revoked_at FROM auth_sessions WHERE id = $1', [sid]);
      expect(row.revoked_at).not.toBeNull();
    });

    it('in own_accounts mode keep today: the terminal and each waiter write as themselves', async () => {
      await setMode('own_accounts');
      await resetTables();
      const terminal = await openTerminal(emails.cashier);
      const created = await as(terminal).post('/api/orders', { tableId: ids.tables[2], items });
      expect(created.status).toBe(201);
      const own = await waiter().post('/api/orders', { tableId: ids.tables[3], items });
      expect(own.status).toBe(201);
      const rows = await db<{ id: string; created_by_profile_id: string }>(
        'SELECT id, created_by_profile_id FROM orders WHERE id = ANY($1)',
        [[created.body.id, own.body.id]],
      );
      expect(Object.fromEntries(rows.map((row) => [row.id, row.created_by_profile_id]))).toEqual({
        [created.body.id]: ids.cashier,
        [own.body.id]: fixtures.waiterA.profileId,
      });
    });
  });

  describe('lockout: 5 failures lock 5 minutes, per profile and per terminal', () => {
    it('locks the profile and the terminal, then unlocks after exactly 5 minutes', async () => {
      const clock = app.get(Clock);
      const t0 = new Date('2030-01-01T12:00:00.000Z');
      const at = (ms: number) => vi.spyOn(clock, 'now').mockReturnValue(new Date(t0.getTime() + ms));
      const t1 = await openTerminal(emails.cashier);
      const t2 = await openTerminal(emails.cashier);
      at(0);
      for (let i = 0; i < 5; i++) {
        expect((await identify(t1, ids.waiter2, '808080')).status).toBe(403);
      }
      const locked = await identify(t1, ids.waiter2, PINS.waiter2);
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ statusCode: 429, message: MESSAGES.locked, code: 'pin_locked' });
      // F4: the terminal shows "Bloqueado hasta hh:mm" from the answer itself.
      expect(locked.body.lockedUntil).toBe(new Date(t0.getTime() + 5 * 60_000).toISOString());
      // Per profile: another terminal is refused for that profile, not for others.
      expect((await identify(t2, ids.waiter2, PINS.waiter2)).status).toBe(429);
      expect((await identify(t2, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(200);
      // Per terminal: t1 is locked for every profile.
      expect((await identify(t1, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(429);
      at(5 * 60_000 - 1000);
      expect((await identify(t1, ids.waiter2, PINS.waiter2)).status).toBe(429);
      at(5 * 60_000);
      expect((await identify(t1, ids.waiter2, PINS.waiter2)).status).toBe(200);
      expect(await pinRow(ids.waiter2)).toMatchObject({ failed_attempts: 0, locked_until: null });
    });

    it('locks a terminal that guesses across unknown profiles', async () => {
      const t3 = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) {
        expect((await identify(t3, ids.unknown, '808080')).status).toBe(403);
      }
      expect((await identify(t3, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(429);
    });

    it('an admin reset clears a profile lockout', async () => {
      const t4 = await openTerminal(emails.cashier);
      const t5 = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) {
        await identify(t4, fixtures.waiterA.profileId, '808080');
      }
      expect((await identify(t5, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(429);
      const list = await admin().get('/api/staff');
      expect(list.body.find((m: { id: string }) => m.id === fixtures.waiterA.profileId).pinLockedUntil).not.toBeNull();
      expect((await setPin(fixtures.waiterA.profileId, PINS.waiter)).status).toBe(204);
      expect((await identify(t5, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(200);
    });

    it('an admin unlocks a locked PIN early, keeping the PIN, and the unlock is logged', async () => {
      const t6 = await openTerminal(emails.cashier);
      const t7 = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) {
        await identify(t6, fixtures.waiterA.profileId, '808080');
      }
      expect((await identify(t7, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(429);
      const before = await pinRow(fixtures.waiterA.profileId);
      expect(before.locked_until).not.toBeNull();
      const logged = vi.spyOn(Logger.prototype, 'log');
      const res = await admin().delete(`/api/staff/${fixtures.waiterA.profileId}/pin/lock`);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      const after = await pinRow(fixtures.waiterA.profileId);
      expect(after).toEqual({ ...before, failed_attempts: 0, locked_until: null });
      expect(logged).toHaveBeenCalledWith(
        `PIN unlocked early: profile ${fixtures.waiterA.profileId} by admin ${fixtures.adminA.profileId}`,
      );
      const list = await admin().get('/api/staff');
      expect(list.body.find((m: { id: string }) => m.id === fixtures.waiterA.profileId).pinLockedUntil).toBeNull();
      expect((await identify(t7, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(200);
      // Idempotent: nothing to unlock is still 204.
      expect((await admin().delete(`/api/staff/${fixtures.waiterA.profileId}/pin/lock`)).status).toBe(204);
    });

    it('an early unlock also clears failures below the lock threshold', async () => {
      const t8 = await openTerminal(emails.cashier);
      for (let i = 0; i < 3; i++) {
        await identify(t8, ids.waiter2, '808080');
      }
      expect(await pinRow(ids.waiter2)).toMatchObject({ failed_attempts: 3, locked_until: null });
      expect((await admin().delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(204);
      expect(await pinRow(ids.waiter2)).toMatchObject({ failed_attempts: 0, locked_until: null });
    });

    it('an early unlock is admin only and never crosses restaurants', async () => {
      const t9 = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) {
        await identify(t9, ids.waiter2, '808080');
      }
      const before = await pinRow(ids.waiter2);
      expect(before.locked_until).not.toBeNull();
      expect((await waiter().delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(403);
      expect((await as(cookies.cook).delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(403);
      const foreign = await as(cookies.adminB).delete(`/api/staff/${ids.waiter2}/pin/lock`);
      expect(foreign.status).toBe(404);
      expect(await pinRow(ids.waiter2)).toEqual(before);
      expect((await admin().delete(`/api/staff/${ids.unknown}/pin/lock`)).status).toBe(404);
      expect((await as(t9).delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(403);
      expect(await pinRow(ids.waiter2)).toEqual(before);
      expect((await admin().delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(204);
    });
  });

  describe('GET /staff/supervisors (close a terminal, F3 authorizations)', () => {
    const supervisorsOf = async (restaurant: string) =>
      db<{ id: string; full_name: string; role: string }>(
        `SELECT p.id, p.full_name, p.role FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.restaurant_id = $1 AND p.active AND u.is_active AND p.role IN ('admin', 'cashier')
          ORDER BY p.full_name, p.id`,
        [restaurant],
      );

    it('lists the active admins and cashiers of the caller restaurant, by name, with the PIN state', async () => {
      const expected = await supervisorsOf(A);
      expect(expected.map((p) => p.id)).toEqual(expect.arrayContaining([fixtures.adminA.profileId, ids.cashier]));
      const res = await admin().get('/api/staff/supervisors');
      expect(res.status).toBe(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual(expected.map((p) => p.id));
      for (const member of res.body) {
        expect(Object.keys(member).sort()).toEqual(['fullName', 'hasPin', 'id', 'pinLockedUntil', 'role']);
      }
      expect(res.body.find((p: { id: string }) => p.id === ids.cashier)).toEqual({
        id: ids.cashier,
        fullName: 'Cashier A',
        role: 'cashier',
        hasPin: true,
        pinLockedUntil: null,
      });
    });

    it('is readable by admin, cashier, waiter and a terminal; not by the kitchen', async () => {
      const cashier = as(await freshLogin(emails.cashier));
      const terminal = as(await openTerminal(emails.cashier));
      for (const caller of [admin(), cashier, waiter(), terminal]) {
        expect((await caller.get('/api/staff/supervisors')).status).toBe(200);
      }
      expect((await as(cookies.cook).get('/api/staff/supervisors')).status).toBe(403);
    });

    it('never crosses restaurants and leaves inactive supervisors out', async () => {
      const b = await as(cookies.adminB).get('/api/staff/supervisors');
      expect(b.body.map((p: { id: string }) => p.id)).toEqual((await supervisorsOf(B)).map((p) => p.id));
      expect(b.body.map((p: { id: string }) => p.id)).not.toContain(ids.cashier);
      await db('UPDATE profiles SET active = false WHERE id = $1', [ids.cashier]);
      try {
        expect((await admin().get('/api/staff/supervisors')).body.map((p: { id: string }) => p.id)).not.toContain(ids.cashier);
      } finally {
        await db('UPDATE profiles SET active = true WHERE id = $1', [ids.cashier]);
      }
    });

    it('shows a running lock to an admin; other callers get null (private.staff_pin_locks is admin-only)', async () => {
      const t = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) {
        await identify(t, ids.cashier, '808080');
      }
      const locked = (await pinRow(ids.cashier)).locked_until!;
      const forAdmin = (await admin().get('/api/staff/supervisors')).body.find((p: { id: string }) => p.id === ids.cashier);
      expect(forAdmin.pinLockedUntil).toBe(new Date(locked).toISOString());
      const forTerminal = (await as(t).get('/api/staff/supervisors')).body.find((p: { id: string }) => p.id === ids.cashier);
      expect(forTerminal).toMatchObject({ hasPin: true, pinLockedUntil: null });
      expect((await admin().delete(`/api/staff/${ids.cashier}/pin/lock`)).status).toBe(204);
    });
  });

  describe('supervisor authorization', () => {
    const authorize = (cookie: string, body: object) => as(cookie).post('/api/auth/authorize', body);
    const consume = (cookie: string, authorizationId: string, action: string) =>
      as(cookie).post('/api/probe/authorizations/consume', { authorizationId, action });

    it('a supervisor PIN (cashier or admin) returns a single-use authorization bound to the action', async () => {
      const res = await authorize(cookies.waiter2, { pin: PINS.cashier, action: 'void_item' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ action: 'void_item', supervisor: { id: ids.cashier, name: 'Cashier A' } });
      const [row] = await db<{ restaurant_id: string; requested_by_profile_id: string }>(
        'SELECT restaurant_id, requested_by_profile_id FROM supervisor_authorizations WHERE id = $1',
        [res.body.authorizationId],
      );
      expect(row).toEqual({ restaurant_id: A, requested_by_profile_id: ids.waiter2 });

      expect((await consume(cookies.waiter2, res.body.authorizationId, 'cancel_order')).status).toBe(403);
      const used = await consume(cookies.waiter2, res.body.authorizationId, 'void_item');
      expect(used.status).toBe(200);
      expect(used.body).toEqual({ supervisorProfileId: ids.cashier });
      const again = await consume(cookies.waiter2, res.body.authorizationId, 'void_item');
      expect(again.status).toBe(403);
      expect(again.body).toMatchObject({ message: MESSAGES.authorization, code: 'authorization_invalid' });

      const byAdmin = await authorize(cookies.waiter2, { pin: PINS.admin, action: 'cancel_order', profileId: fixtures.adminA.profileId });
      expect(byAdmin.status).toBe(201);
      expect(byAdmin.body.supervisor.id).toBe(fixtures.adminA.profileId);
    });

    it('refuses a waiter PIN, a non-supervisor profile and an unknown action', async () => {
      const before = Number((await db<{ n: string }>('SELECT count(*) AS n FROM supervisor_authorizations'))[0].n);
      const waiterPin = await authorize(cookies.waiter2, { pin: PINS.waiter, action: 'void_item' });
      expect(waiterPin.status).toBe(403);
      expect(waiterPin.body.message).toBe(MESSAGES.wrong);
      const notSupervisor = await authorize(cookies.waiter2, { pin: PINS.waiter, action: 'void_item', profileId: fixtures.waiterA.profileId });
      expect(notSupervisor.status).toBe(403);
      expect(notSupervisor.body).toEqual(waiterPin.body);
      expect((await authorize(cookies.waiter2, { pin: PINS.cashier, action: 'drop_tables' })).status).toBe(422);
      expect(Number((await db<{ n: string }>('SELECT count(*) AS n FROM supervisor_authorizations'))[0].n)).toBe(before);
    });

    it('expires after 2 minutes', async () => {
      const clock = app.get(Clock);
      const t0 = new Date('2031-01-01T12:00:00.000Z');
      vi.spyOn(clock, 'now').mockReturnValue(t0);
      const first = await authorize(cookies.waiter2, { pin: PINS.cashier, action: 'void_payment' });
      const second = await authorize(cookies.waiter2, { pin: PINS.cashier, action: 'void_payment' });
      expect(first.body.expiresAt).toBe('2031-01-01T12:02:00.000Z');
      vi.spyOn(clock, 'now').mockReturnValue(new Date(t0.getTime() + 119_000));
      expect((await consume(cookies.waiter2, first.body.authorizationId, 'void_payment')).status).toBe(200);
      vi.spyOn(clock, 'now').mockReturnValue(new Date(t0.getTime() + 120_000));
      expect((await consume(cookies.waiter2, second.body.authorizationId, 'void_payment')).status).toBe(403);
    });

    it('never crosses restaurants', async () => {
      const res = await authorize(cookies.waiter2, { pin: PINS.cashier, action: 'void_item' });
      expect((await consume(cookies.adminB, res.body.authorizationId, 'void_item')).status).toBe(403);
      const fromB = await authorize(cookies.adminB, { pin: PINS.cashier, action: 'void_item', profileId: ids.cashier });
      expect(fromB.status).toBe(403);
      expect(fromB.body.message).toBe(MESSAGES.wrong);
      expect((await consume(cookies.waiter2, res.body.authorizationId, 'void_item')).status).toBe(200);
    });
  });
  describe('verifier regressions (B1-B3)', () => {
    it('a single-use authorization is consumed once under concurrency', async () => {
      const res = await as(cookies.waiter2).post('/api/auth/authorize', { pin: PINS.cashier, action: 'void_item' });
      expect(res.status).toBe(201);
      const statuses = await Promise.all(
        Array.from({ length: 6 }, () =>
          as(cookies.waiter2).post('/api/probe/authorizations/consume', { authorizationId: res.body.authorizationId, action: 'void_item' }),
        ),
      );
      expect(statuses.filter((r) => r.status === 200).length).toBe(1);
      expect(statuses.filter((r) => r.status === 403).length).toBe(5);
    });

    it('profile-less authorize lockout survives a fresh login', async () => {
      for (let round = 0; round < 2; round++) {
        const c = await freshLogin(emails.waiter2);
        for (let i = 0; i < 5; i++) await as(c).post('/api/auth/authorize', { pin: String(100003 + round * 10 + i), action: 'void_item' });
      }
      const c = await freshLogin(emails.waiter2);
      expect((await as(c).post('/api/auth/authorize', { pin: PINS.cashier, action: 'void_item' })).status).toBe(429);
    });

    it('parallel wrong identifies verify at most 5', async () => {
      const t = await openTerminal(emails.cashier);
      const res = await Promise.all(Array.from({ length: 9 }, (_, i) => identify(t, ids.waiter2, String(520000 + i * 7))));
      expect(res.filter((r) => r.status === 403).length).toBeLessThanOrEqual(5);
      expect(res.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(4);
    });

    it('12 parallel wrong PINs leave the API responsive', async () => {
      const c = await freshLogin(emails.waiter2);
      const burst = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          as(c)
            .post('/api/auth/authorize', { pin: String(610000 + i * 13), action: 'void_item' })
            .timeout(10_000)
            .then((r) => r.status, () => 0),
        ),
      );
      expect(burst.every((s) => s === 403 || s === 429)).toBe(true);
      expect((await admin().get('/api/auth/me').timeout(5_000)).status).toBe(200);
    }, 30_000);
  });
  describe('pepper versions (PIN_PEPPER)', () => {
    it('re-hashes a v1 PIN to v2 on a correct PIN once PIN_PEPPER is set, and new PINs use v2', async () => {
      expect((await pinRow(fixtures.waiterA.profileId)).pin_pepper_version).toBe(1);
      const previous = process.env.PIN_PEPPER;
      process.env.PIN_PEPPER = 'a-test-pin-pepper-that-is-long-enough-0123';
      let app2: INestApplication | undefined;
      try {
        app2 = await createTestApp(database.apiUrl);
        const server2 = () => request(app2!.getHttpServer());
        const terminalRes = await server2().post('/api/auth/terminal/login').send({ email: emails.cashier, password: PASSWORD });
        const terminal2 = cookiePair(setCookies(terminalRes).vipe_access);
        const identify2 = () =>
          server2().post('/api/auth/identify').set('Cookie', terminal2).send({ profileId: fixtures.waiterA.profileId, pin: PINS.waiter });
        expect((await identify2()).status).toBe(200);
        expect((await pinRow(fixtures.waiterA.profileId)).pin_pepper_version).toBe(2);
        expect((await identify2()).status).toBe(200);
        const admin2 = cookiePair(setCookies(await server2().post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD })).vipe_access);
        expect((await server2().put(`/api/staff/${ids.cook}/pin`).set('Cookie', admin2).send({ pin: '6031' })).status).toBe(204);
        expect((await pinRow(ids.cook)).pin_pepper_version).toBe(2);
      } finally {
        await app2?.close();
        if (previous === undefined) delete process.env.PIN_PEPPER;
        else process.env.PIN_PEPPER = previous;
      }
      // Without PIN_PEPPER a v2 PIN cannot be verified: the same uniform 403.
      const terminal = await openTerminal(emails.cashier);
      expect((await identify(terminal, fixtures.waiterA.profileId, PINS.waiter)).status).toBe(403);
    });

    it('refuses a PIN_PEPPER shorter than 32 characters at startup', async () => {
      const previous = process.env.PIN_PEPPER;
      process.env.PIN_PEPPER = 'short';
      try {
        await expect(createTestApp(database.apiUrl)).rejects.toThrow('PIN_PEPPER must be at least 32 characters');
      } finally {
        if (previous === undefined) delete process.env.PIN_PEPPER;
        else process.env.PIN_PEPPER = previous;
      }
    });
  });
  describe('lock order between staff_pins and pin_attempts', () => {
    it('a claim + own change and an admin reset of the same profile never deadlock (40P01)', async () => {
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
      const profile = ids.waiter2;
      const { pool } = createDb(database.apiUrl, { max: 2 });
      const t1 = await pool.connect();
      const t2 = await pool.connect();
      const as = async (client: typeof t1, userId: string) => {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      };
      await db(
        `INSERT INTO staff_pins (profile_id, restaurant_id, pin_hash) VALUES ($1, $2, $3) ON CONFLICT (profile_id) DO NOTHING`,
        [profile, A, hash],
      );
      try {
        // An existing counter row for the profile.
        await as(t1, ids.waiter2User);
        await t1.query("SELECT private.claim_pin_attempt(NULL, $1, ARRAY['profile'], now())", [profile]);
        await t1.query('COMMIT');

        // T1 claims (locks the pin_attempts row) ...
        await as(t1, ids.waiter2User);
        await t1.query("SELECT private.claim_pin_attempt(NULL, $1, ARRAY['profile'], now())", [profile]);
        // ... T2, an admin reset of the same PIN, starts and waits ...
        await as(t2, fixtures.adminA.userId);
        const reset = t2.query('SELECT private.set_staff_pin($1, $2, 1::smallint)', [profile, hash]).then(
          () => 'ok',
          (error: { code?: string }) => error.code ?? 'error',
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        // ... then T1 writes staff_pins (the own change after a correct PIN).
        const change = await t1.query('SELECT private.change_own_pin($1, 1::smallint)', [hash]).then(
          () => 'ok',
          (error: { code?: string }) => error.code ?? 'error',
        );
        await t1.query(change === 'ok' ? 'COMMIT' : 'ROLLBACK');
        const resetResult = await reset;
        await t2.query(resetResult === 'ok' ? 'COMMIT' : 'ROLLBACK');
        expect({ change, reset: resetResult }).toEqual({ change: 'ok', reset: 'ok' });
      } finally {
        t1.release();
        t2.release();
        await pool.end();
      }
    });
  });
});
