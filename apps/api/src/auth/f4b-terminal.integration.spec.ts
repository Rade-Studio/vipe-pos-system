import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * F4b (odd/tasks/fase3-operacion.md, L20-L22): the shared terminal identifies
 * by PIN alone, PINs are unique per restaurant, and a tablet locked by 5 wrong
 * PINs is unlocked early with a supervisor PIN.
 */
const A = fixtures.restaurantA;
const B = fixtures.restaurantB;
const ids = {
  cashierUser: '10000000-0000-0000-0000-0000000000f1',
  cashier: '20000000-0000-0000-0000-0000000000f1',
  waiter2User: '10000000-0000-0000-0000-0000000000f2',
  waiter2: '20000000-0000-0000-0000-0000000000f2',
  waiterBUser: '10000000-0000-0000-0000-0000000000f3',
  waiterB: '20000000-0000-0000-0000-0000000000f3',
  cookUser: '10000000-0000-0000-0000-0000000000f4',
  cook: '20000000-0000-0000-0000-0000000000f4',
  goneUser: '10000000-0000-0000-0000-0000000000f5',
  gone: '20000000-0000-0000-0000-0000000000f5',
};
const emails = { cashier: 'cashier@a.test', waiter2: 'waiter2@a.test', waiterB: 'waiter@b.test', cook: 'cook@a.test', gone: 'gone@a.test' };
const PINS = { waiter: '4829', waiter2: '73914', cashier: '582046', admin: '9157', waiterB: '6408', cook: '6031', gone: '3917' };

const MESSAGES = {
  wrong: 'PIN incorrecto',
  locked: 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo',
  terminalOnly: 'Esta acción solo está disponible en una terminal compartida',
  ambiguous: 'Ese PIN lo tiene más de una persona; pide al administrador que lo cambie',
  taken: 'Ese PIN no está disponible, elige otro',
};
const WRONG = { statusCode: 403, error: 'Forbidden', message: MESSAGES.wrong, code: 'pin_invalid' };

describe('F4b shared terminal: PIN-only identify, unique PINs, tablet unlock (Testcontainers, vipe_api)', () => {
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
    post: (url: string, body?: object) => server().post(url).set('Cookie', cookie).send(body),
    put: (url: string, body?: object) => server().put(url).set('Cookie', cookie).send(body),
  });
  const setPin = (profileId: string, pin: string, cookie = cookies.adminA) => as(cookie).put(`/api/staff/${profileId}/pin`, { pin });
  const identify = (terminal: string, pin: string) => as(terminal).post('/api/auth/identify', { pin });
  const unlock = (terminal: string, profileId: string, pin: string) => as(terminal).post('/api/auth/terminal/unlock', { profileId, pin });
  const pinHash = async (profileId: string) =>
    (await db<{ pin_hash: string }>('SELECT pin_hash FROM staff_pins WHERE profile_id = $1', [profileId]))[0]?.pin_hash;
  const actingSessions = async () =>
    Number((await db<{ n: string }>(`SELECT count(*) AS n FROM auth_sessions WHERE kind = 'acting'`))[0].n);
  const counters = () => db<{ scope: string; subject_id: string; failed_attempts: number }>('SELECT scope, subject_id, failed_attempts FROM private.pin_attempts ORDER BY scope, subject_id');
  const at = (ms: number) => vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(Date.parse('2030-01-01T12:00:00.000Z') + ms));

  beforeAll(async () => {
    database = await startTestDatabase();
    const users: [string, string][] = [
      [ids.cashierUser, emails.cashier],
      [ids.waiter2User, emails.waiter2],
      [ids.waiterBUser, emails.waiterB],
      [ids.cookUser, emails.cook],
      [ids.goneUser, emails.gone],
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
         ($8, $9, 'Waiter B', $10, 'waiter', $11), ($12, $13, 'Cook A', $14, 'kitchen', $4),
         ($15, $16, 'Gone A', $17, 'waiter', $4)`,
      [
        ids.cashier, ids.cashierUser, emails.cashier, A, ids.waiter2, ids.waiter2User, emails.waiter2,
        ids.waiterB, ids.waiterBUser, emails.waiterB, B, ids.cook, ids.cookUser, emails.cook,
        ids.gone, ids.goneUser, emails.gone,
      ],
    );
    app = await createTestApp(database.apiUrl);
    for (const [key, email] of [
      ['adminA', fixtures.adminA.email],
      ['adminB', fixtures.adminB.email],
      ['waiterA', fixtures.waiterA.email],
      ['waiter2', emails.waiter2],
    ] as const) {
      cookies[key] = cookiePair(setCookies(await login(email)).vipe_access);
    }
    const assigned: [string, string, string][] = [
      [fixtures.waiterA.profileId, PINS.waiter, cookies.adminA],
      [ids.waiter2, PINS.waiter2, cookies.adminA],
      [ids.cashier, PINS.cashier, cookies.adminA],
      [fixtures.adminA.profileId, PINS.admin, cookies.adminA],
      [ids.cook, PINS.cook, cookies.adminA],
      [ids.gone, PINS.gone, cookies.adminA],
      [ids.waiterB, PINS.waiterB, cookies.adminB],
    ];
    for (const [profileId, pin, cookie] of assigned) {
      expect((await setPin(profileId, pin, cookie)).status).toBe(204);
    }
    await db('UPDATE profiles SET active = false WHERE id = $1', [ids.gone]);
  });

  beforeEach(() => db('DELETE FROM private.pin_attempts'));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('POST /auth/identify with the PIN alone', () => {
    it('identifies whoever has that PIN among the active admins, cashiers and waiters of the restaurant', async () => {
      const terminal = await openTerminal(emails.cashier);
      for (const [pin, profile] of [
        [PINS.waiter2, { id: ids.waiter2, name: 'Waiter Two', role: 'waiter' }],
        [PINS.cashier, { id: ids.cashier, name: 'Cashier A', role: 'cashier' }],
        [PINS.admin, { id: fixtures.adminA.profileId, name: 'Admin A', role: 'admin' }],
      ] as const) {
        const res = await identify(terminal, pin);
        expect(res.status).toBe(200);
        expect(res.body.profile).toEqual(profile);
        expect(typeof res.body.token).toBe('string');
      }
    });

    it('answers one 403 for a wrong PIN, another restaurant, the kitchen and an inactive member', async () => {
      const terminal = await openTerminal(emails.cashier);
      const before = await actingSessions();
      for (const pin of ['5820', PINS.waiterB, PINS.cook, PINS.gone]) {
        const res = await identify(terminal, pin);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(WRONG);
      }
      expect(await actingSessions()).toBe(before);
    });

    it('is a terminal action only and still accepts a profile id (compatibility)', async () => {
      const fromUser = await as(cookies.waiterA).post('/api/auth/identify', { pin: PINS.waiter });
      expect(fromUser.status).toBe(403);
      expect(fromUser.body.message).toBe(MESSAGES.terminalOnly);
      const terminal = await openTerminal(emails.cashier);
      const legacy = await as(terminal).post('/api/auth/identify', { profileId: ids.waiter2, pin: PINS.waiter2 });
      expect(legacy.status).toBe(200);
      expect(legacy.body.profile.id).toBe(ids.waiter2);
    });

    it('refuses a PIN two active members share (legacy duplicate) without identifying anyone', async () => {
      const legacy = '20000000-0000-0000-0000-0000000000f6';
      await db('INSERT INTO users (id, email, password_hash, password_algo) SELECT $1, $2, password_hash, password_algo FROM users WHERE id = $3', [
        '10000000-0000-0000-0000-0000000000f6',
        'twin@a.test',
        fixtures.adminA.userId,
      ]);
      await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Twin A', 'twin@a.test', 'waiter', $3)`, [
        legacy,
        '10000000-0000-0000-0000-0000000000f6',
        A,
      ]);
      await db(
        `INSERT INTO staff_pins (profile_id, restaurant_id, pin_hash, pin_pepper_version)
         SELECT $1, restaurant_id, pin_hash, pin_pepper_version FROM staff_pins WHERE profile_id = $2`,
        [legacy, ids.waiter2],
      );
      try {
        const terminal = await openTerminal(emails.cashier);
        const before = await actingSessions();
        const res = await identify(terminal, PINS.waiter2);
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: MESSAGES.ambiguous, code: 'pin_ambiguous' });
        expect(JSON.stringify(res.body)).not.toMatch(/Twin|Waiter Two/);
        expect(await actingSessions()).toBe(before);
      } finally {
        await db('DELETE FROM profiles WHERE id = $1', [legacy]);
      }
    });
  });

  describe('PINs are unique per restaurant', () => {
    const TAKEN = { statusCode: 409, error: 'Conflict', message: MESSAGES.taken, code: 'pin_taken' };

    it('admin assign and reset refuse a PIN another active member has, without saying whose', async () => {
      const before = await pinHash(ids.cashier);
      const res = await setPin(ids.cashier, PINS.waiter2);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(TAKEN);
      expect(await pinHash(ids.cashier)).toBe(before);
      // A first assignment too.
      await db('DELETE FROM staff_pins WHERE profile_id = $1', [ids.cook]);
      expect((await setPin(ids.cook, PINS.admin)).body).toEqual(TAKEN);
      expect(await pinHash(ids.cook)).toBeUndefined();
      expect((await setPin(ids.cook, PINS.cook)).status).toBe(204);
    });

    it('allows the member own current PIN, an inactive member PIN and a PIN used in another restaurant', async () => {
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
      const freshCashier = '640275';
      expect((await setPin(ids.cashier, PINS.gone)).status).toBe(204);
      expect((await setPin(ids.cashier, PINS.waiterB)).status).toBe(204);
      expect((await setPin(ids.cashier, freshCashier)).status).toBe(204);
      expect((await setPin(ids.cashier, PINS.cashier)).status).toBe(204);
    });

    it('changing one own PIN refuses a taken PIN, keeps the PIN and counts the probe', async () => {
      const before = await pinHash(ids.waiter2);
      for (let i = 0; i < 5; i++) {
        const res = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter });
        expect(res.status).toBe(409);
        expect(res.body).toEqual(TAKEN);
      }
      expect(await pinHash(ids.waiter2)).toBe(before);
      // Probing which PINs are in use is bounded like a wrong PIN: 5 lock 5 minutes.
      const sixth = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '640271' });
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('pin_locked');
      await db('DELETE FROM private.pin_attempts');
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter2 })).status).toBe(204);
    });
  });

  describe('the tablet lock', () => {
    it('5 wrong PINs lock only that tablet 5 minutes; another tablet of the restaurant still identifies', async () => {
      at(0);
      const t1 = await openTerminal(emails.cashier);
      const t2 = await openTerminal(fixtures.adminA.email);
      for (let i = 0; i < 5; i++) {
        expect((await identify(t1, String(808080 + i))).body).toEqual(WRONG);
      }
      const locked = await identify(t1, PINS.waiter);
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'pin_locked', message: MESSAGES.locked, lockedUntil: '2030-01-01T12:05:00.000Z' });
      expect((await identify(t2, PINS.waiter)).status).toBe(200);
      expect((await counters()).map((row) => row.scope)).toEqual(['session']);
      at(5 * 60_000 - 1000);
      expect((await identify(t1, PINS.waiter)).status).toBe(429);
      at(5 * 60_000);
      expect((await identify(t1, PINS.waiter)).status).toBe(200);
    });

    it('tablet failures leave profile-less authorize untouched', async () => {
      const t1 = await openTerminal(emails.cashier);
      for (let i = 0; i < 6; i++) await identify(t1, String(708090 + i));
      const res = await as(cookies.waiter2).post('/api/auth/authorize', {
        pin: PINS.cashier,
        action: 'void_item',
        targetType: 'order',
        targetId: '60000000-0000-0000-0000-0000000000a1',
      });
      expect(res.status).toBe(201);
    });

    it('a supervisor PIN unlocks only that tablet early; the unlock is logged', async () => {
      const t1 = await openTerminal(emails.cashier);
      const t2 = await openTerminal(emails.cashier);
      for (const t of [t1, t2]) for (let i = 0; i < 5; i++) await identify(t, String(808080 + i));
      expect((await identify(t1, PINS.waiter)).status).toBe(429);
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const res = await unlock(t1, fixtures.adminA.profileId, PINS.admin);
      expect(res.status).toBe(204);
      expect(log.mock.calls.flat().join(' ')).toContain(`Terminal unlocked early by supervisor ${fixtures.adminA.profileId}`);
      expect((await identify(t1, PINS.waiter)).status).toBe(200);
      expect((await identify(t2, PINS.waiter)).status).toBe(429);
    });

    it('unlock refuses a waiter, another restaurant and a wrong PIN alike, and locks that supervisor after 5', async () => {
      const t1 = await openTerminal(emails.cashier);
      for (let i = 0; i < 5; i++) await identify(t1, String(808080 + i));
      for (const [profileId, pin] of [
        [fixtures.waiterA.profileId, PINS.waiter],
        [fixtures.adminB.profileId, PINS.admin],
        [ids.cashier, '640279'],
      ]) {
        const res = await unlock(t1, profileId, pin);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(WRONG);
      }
      for (let i = 0; i < 4; i++) expect((await unlock(t1, ids.cashier, String(530000 + i))).status).toBe(403);
      const lockedSupervisor = await unlock(t1, ids.cashier, PINS.cashier);
      expect(lockedSupervisor.status).toBe(429);
      expect(lockedSupervisor.body.code).toBe('pin_locked');
      // The tablet is still locked; another supervisor can lift it.
      expect((await identify(t1, PINS.waiter)).status).toBe(429);
      expect((await unlock(t1, fixtures.adminA.profileId, PINS.admin)).status).toBe(204);
      expect((await identify(t1, PINS.waiter)).status).toBe(200);
    });

    it('unlock is a terminal action only and validates its body', async () => {
      const res = await as(cookies.adminA).post('/api/auth/terminal/unlock', { profileId: fixtures.adminA.profileId, pin: PINS.admin });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(MESSAGES.terminalOnly);
      const t1 = await openTerminal(emails.cashier);
      expect((await as(t1).post('/api/auth/terminal/unlock', { pin: PINS.admin })).status).toBe(422);
      expect(await counters()).toEqual([]);
    });
  });
});
