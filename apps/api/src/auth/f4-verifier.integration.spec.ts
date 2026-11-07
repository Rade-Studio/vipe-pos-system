import { Body, Controller, HttpCode, type INestApplication, Logger, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
// POST /auth/authorize is bound to a target since F1 round 2 (L19).
const ORDER_TARGET = { targetType: 'order', targetId: '60000000-0000-0000-0000-0000000000a1' } as const;
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

  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  const clearCounters = () => db('DELETE FROM private.pin_attempts');
  const supervisorsOf = async (restaurant: string) =>
    db<{ id: string }>(
      `SELECT p.id FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.restaurant_id = $1 AND p.active AND u.is_active AND p.role IN ('admin', 'cashier')
        ORDER BY p.full_name, p.id`,
      [restaurant],
    );

  describe('F4 verifier probes', () => {
    it('P1 supervisors: same list for waiter/cashier/delivery, exact shape, no leaks, kitchen 403, tenant B isolated', async () => {
      expect((await setPin(ids.cashier, PINS.cashier)).status).toBe(204);
      await db(`INSERT INTO users (id, email, password_hash, password_algo) SELECT '10000000-0000-0000-0000-0000000000c9', 'del@a.test', password_hash, password_algo FROM users WHERE id = $1`, [fixtures.adminA.userId]);
      await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ('20000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-0000000000c9', 'Del A', 'del@a.test', 'delivery_operator', $1)`, [A]);
      const delivery = as(await freshLogin('del@a.test'));
      const cashier = as(await freshLogin(emails.cashier));
      const expected = (await supervisorsOf(A)).map((p) => p.id);
      const forAdmin = (await admin().get('/api/staff/supervisors')).body;
      for (const caller of [waiter(), cashier, delivery]) {
        const res = await caller.get('/api/staff/supervisors');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(forAdmin);
        expect(res.body.map((p: { id: string }) => p.id)).toEqual(expected);
        expect(JSON.stringify(res.body)).not.toMatch(/@|argon|pin_hash|email/i);
        for (const m of res.body) expect(Object.keys(m).sort()).toEqual(['fullName', 'hasPin', 'id', 'pinLockedUntil', 'role']);
        expect(res.body.find((p: { id: string }) => p.id === ids.cashier)).toMatchObject({ hasPin: true, role: 'cashier' });
      }
      expect(forAdmin.every((p: { role: string }) => ['admin', 'cashier'].includes(p.role))).toBe(true);
      expect((await as(cookies.cook).get('/api/staff/supervisors')).status).toBe(403);
      const waiterB = as(await freshLogin(emails.waiterB));
      const b = await waiterB.get('/api/staff/supervisors');
      expect(b.status).toBe(200);
      expect(b.body.map((p: { id: string }) => p.id)).toEqual((await supervisorsOf(B)).map((p) => p.id));
      expect(b.body.map((p: { id: string }) => p.id)).not.toContain(fixtures.adminA.profileId);
      await db('UPDATE users SET is_active = false WHERE id = $1', [ids.cashierUser]);
      try {
        expect((await waiter().get('/api/staff/supervisors')).body.map((p: { id: string }) => p.id)).not.toContain(ids.cashier);
      } finally {
        await db('UPDATE users SET is_active = true WHERE id = $1', [ids.cashierUser]);
      }
    });

    it('P2 no other staff route widened: waiter, cashier, delivery and terminal get 403 everywhere else', async () => {
      const callers = [cookies.waiterA, await freshLogin(emails.cashier), await freshLogin('del@a.test'), await openTerminal(emails.cashier)];
      const id = fixtures.waiterA.profileId;
      for (const cookie of callers) {
        const caller = as(cookie);
        const codes = [
          (await caller.get('/api/staff')).status,
          (await caller.post('/api/staff', { email: 'x@a.test', password: 'Password123!', fullName: 'X', role: 'waiter' })).status,
          (await server().patch(`/api/staff/${id}`).set('Cookie', cookie).send({ fullName: 'Hacked' })).status,
          (await caller.put(`/api/staff/${id}/pin`, { pin: '4829' })).status,
          (await caller.delete(`/api/staff/${id}/pin`)).status,
          (await caller.delete(`/api/staff/${id}/pin/lock`)).status,
          (await caller.post(`/api/staff/${id}/password`, { password: 'Password123!' })).status,
          (await caller.delete(`/api/staff/${id}`)).status,
        ];
        expect(codes).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
      }
    });

    it('P3 unlock clears only the profile counter: the guessing terminal stays locked; cross-tenant leaves rows byte-identical; malformed id', async () => {
      await clearCounters();
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
      const t = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) await identify(t, ids.waiter2, '808080');
      const sessionRowsBefore = await db(`SELECT * FROM private.pin_attempts WHERE scope = 'session' ORDER BY subject_id`);
      const before = await pinRow(ids.waiter2);
      const log = vi.spyOn(Logger.prototype, 'log');
      expect((await as(cookies.adminB).delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(404);
      expect(await pinRow(ids.waiter2)).toEqual(before);
      expect(log.mock.calls.some((c) => String(c[0]).startsWith('PIN unlocked early'))).toBe(false);
      const bad = await admin().delete('/api/staff/not-a-uuid/pin/lock');
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(bad.status).toBeLessThan(500);
      expect((await admin().delete(`/api/staff/${ids.waiter2}/pin/lock`)).status).toBe(204);
      expect(await db(`SELECT * FROM private.pin_attempts WHERE scope = 'session' ORDER BY subject_id`)).toEqual(sessionRowsBefore);
      const again = await identify(t, ids.waiter2, PINS.waiter2);
      expect(again.status).toBe(429);
      expect(again.body.lockedUntil).toMatch(ISO);
      const other = await openTerminal(emails.cashier);
      expect((await identify(other, ids.waiter2, PINS.waiter2)).status).toBe(200);
    });

    it('P4 lockedUntil on every 429 pin_locked: identify, authorize, change own PIN', async () => {
      await clearCounters();
      expect((await setPin(ids.cashier, PINS.cashier)).status).toBe(204);
      const cashier = as(await freshLogin(emails.cashier));
      for (let i = 0; i < 5; i++) await cashier.post('/api/auth/authorize', { pin: '808080', action: 'cancel_order', profileId: ids.cashier, ...ORDER_TARGET });
      const auth = await cashier.post('/api/auth/authorize', { pin: PINS.cashier, action: 'cancel_order', profileId: ids.cashier, ...ORDER_TARGET });
      expect(auth.status).toBe(429);
      expect(auth.body).toMatchObject({ code: 'pin_locked', message: MESSAGES.locked });
      expect(auth.body.lockedUntil).toMatch(ISO);
      expect(Date.parse(auth.body.lockedUntil)).toBeGreaterThan(Date.now());
      const own = await cashier.put('/api/auth/pin', { currentPin: PINS.cashier, pin: '73915' });
      expect(own.status).toBe(429);
      expect(own.body.lockedUntil).toMatch(ISO);
      await clearCounters();
      const w2 = as(cookies.waiter2);
      for (let i = 0; i < 5; i++) await w2.put('/api/auth/pin', { currentPin: '808080', pin: '73915' });
      const own2 = await w2.put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '73915' });
      expect(own2.status).toBe(429);
      expect(own2.body.lockedUntil).toMatch(ISO);
      await clearCounters();
      const t = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) await identify(t, ids.waiter2, '808080');
      const id = await identify(t, ids.waiter2, PINS.waiter2);
      expect(id.status).toBe(429);
      expect(id.body.lockedUntil).toMatch(ISO);
      await clearCounters();
    });

    it('P5 a terminal opened by an admin sees supervisor locks (admin caller); one opened by a cashier gets null', async () => {
      await clearCounters();
      const tc = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) await identify(tc, ids.cashier, '808080');
      const ta = await openTerminal(fixtures.adminA.email);
      const viaAdminTerminal = (await as(ta).get('/api/staff/supervisors')).body.find((p: { id: string }) => p.id === ids.cashier);
      const viaCashierTerminal = (await as(tc).get('/api/staff/supervisors')).body.find((p: { id: string }) => p.id === ids.cashier);
      expect(viaAdminTerminal.pinLockedUntil).toMatch(ISO);
      expect(viaCashierTerminal.pinLockedUntil).toBeNull();
      await clearCounters();
    });
  });
});
