import { type INestApplication, Logger } from '@nestjs/common';
import { createDb } from '@vipe/db';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { PinsService } from './pins.service';
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
  tooMany: 'Hay demasiado personal con PIN para identificarse solo con el PIN; pide al administrador que revise el personal',
  checkUnavailable: 'No se pudo comprobar que el PIN sea único: hay demasiado personal con PIN; pide al administrador que revise el personal',
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

    it('pin_taken probes stay bounded even when a free PIN is set in between', async () => {
      let current = PINS.waiter2;
      for (let i = 0; i < 4; i++) expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: current, pin: PINS.waiter })).body).toEqual(TAKEN);
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: current, pin: '640271' })).status).toBe(204);
      current = '640271';
      const fifth = await as(cookies.waiter2).put('/api/auth/pin', { currentPin: current, pin: PINS.waiter });
      expect(fifth.status).toBe(429);
      await db('DELETE FROM private.pin_attempts');
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
    });

    it('an own change and an admin reset of the same member never deadlock (advisory lock first, B2)', async () => {
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
      // Precondition (verifier P3c): an earlier wrong own attempt left a committed counter row.
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: '110371', pin: '640299' })).status).toBe(403);
      const service = app.get(PinsService) as unknown as { matches: (...args: unknown[]) => Promise<boolean> };
      const original = service.matches.bind(service);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let paused!: () => void;
      const reached = new Promise<void>((resolve) => (paused = resolve));
      let first = true;
      vi.spyOn(service, 'matches').mockImplementation(async (...args: unknown[]) => {
        if (first) {
          first = false;
          paused();
          await gate;
        }
        return original(...args);
      });
      const own = as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '640273' }).then((r) => r);
      await reached;
      const reset = setPin(ids.waiter2, '640275').then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      const [ownRes, resetRes] = await Promise.all([own, reset]);
      expect([ownRes.status, resetRes.status]).toEqual([204, 204]);
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
    }, 30_000);
  });

  describe('verifier round 2 (P3d, stale hash, P1b)', () => {
    /** Pause the first call of a PinsService method until `release()`; `reached` resolves when it is paused. */
    const pauseFirst = (method: string) => {
      const service = app.get(PinsService) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const original = service[method].bind(service);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let paused!: () => void;
      const reached = new Promise<void>((resolve) => (paused = resolve));
      let first = true;
      vi.spyOn(service, method as never).mockImplementation((async (...args: unknown[]) => {
        if (first) {
          first = false;
          paused();
          await gate;
        }
        return original(...args);
      }) as never);
      return { reached, release };
    };
    const terminalSession = async (email: string) =>
      (await db<{ id: string }>(
        `SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1 AND s.kind = 'terminal' ORDER BY s.created_at DESC LIMIT 1`,
        [email],
      ))[0].id;

    it('P3d: a PIN-only identify and an unlock on the same tablet never deadlock', async () => {
      const t = await openTerminal(emails.cashier);
      expect((await identify(t, '808080')).status).toBe(403);
      expect((await unlock(t, fixtures.adminA.profileId, '530000')).status).toBe(403);
      const { reached, release } = pauseFirst('matches');
      const who = identify(t, PINS.admin).then((r) => r);
      await reached;
      const lift = unlock(t, fixtures.adminA.profileId, PINS.admin).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      const [whoRes, liftRes] = await Promise.all([who, lift]);
      expect([whoRes.status, liftRes.status]).toEqual([200, 204]);
    }, 30_000);

    it('P3d at the SQL level: both paths take the terminal lock first, so no 40P01', async () => {
      const t = await openTerminal(emails.cashier);
      expect((await identify(t, '808080')).status).toBe(403);
      expect((await unlock(t, fixtures.adminA.profileId, '530000')).status).toBe(403);
      const sess = await terminalSession(emails.cashier);
      const { pool } = createDb(database.apiUrl, { max: 2 });
      const a = await pool.connect();
      const b = await pool.connect();
      const terminalLock = `SELECT pg_advisory_xact_lock(hashtextextended('vipe.terminal_pin:' || $1::text, 0))`;
      const settle = (q: Promise<unknown>, name: string) => q.then(() => `${name} ok`, (e: { code?: string }) => `${name} ${e.code}`);
      const timeout = () => new Promise<string>((resolve) => setTimeout(() => resolve('still waiting after 3 s'), 3000));
      const res: string[] = [];
      try {
        for (const x of [a, b]) {
          await x.query('BEGIN');
          await x.query("SELECT set_config('app.user_id', $1, true)", [ids.cashierUser]);
        }
        await a.query(terminalLock, [sess]);
        await a.query("SELECT private.claim_pin_attempt($1::uuid, NULL, ARRAY['session']::text[], now())", [sess]);
        const bAll = settle(
          b.query(terminalLock, [sess]).then(async () => {
            await b.query("SELECT private.claim_pin_attempt($1::uuid, $2::uuid, ARRAY['profile']::text[], now())", [sess, fixtures.adminA.profileId]);
            await b.query("SELECT private.clear_pin_attempts($1::uuid, NULL, ARRAY['session']::text[])", [sess]);
          }),
          'unlock',
        );
        const aNext = settle(
          a.query("SELECT private.claim_pin_attempt($1::uuid, $2::uuid, ARRAY['profile']::text[], now())", [sess, fixtures.adminA.profileId]).then(() => a.query('COMMIT')),
          'identify',
        );
        res.push(await Promise.race([aNext, timeout()]), await Promise.race([bAll, timeout()]));
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        await b.query('ROLLBACK').catch(() => undefined);
        a.release();
        b.release();
        await pool.end();
      }
      expect(res).toEqual(['identify ok', 'unlock ok']);
    }, 30_000);

    it('changing one own PIN rereads the PIN after the write lock: an admin reset in between wins', async () => {
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
      const { reached, release } = pauseFirst('lockPinWrites');
      const own = as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: '640273' }).then((r) => r);
      await reached;
      vi.restoreAllMocks();
      expect((await setPin(ids.waiter2, '640275')).status).toBe(204);
      release();
      const ownRes = await own;
      expect(ownRes.status).toBe(403);
      expect(ownRes.body.code).toBe('pin_invalid');
      await db('DELETE FROM private.pin_attempts');
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: '640275', pin: PINS.waiter2 })).status).toBe(204);
    }, 30_000);

    it('P1b: a successful profile-less authorize in between does not reset the pin_taken bound', async () => {
      expect((await setPin(ids.waiter2, PINS.waiter2)).status).toBe(204);
      const TAKEN_CODE = 'pin_taken';
      for (let i = 0; i < 4; i++) expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter })).body.code).toBe(TAKEN_CODE);
      const authorized = await as(cookies.waiter2).post('/api/auth/authorize', {
        pin: PINS.cashier,
        action: 'void_item',
        targetType: 'order',
        targetId: '60000000-0000-0000-0000-0000000000a1',
      });
      expect(authorized.status).toBe(201);
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter })).body.code).toBe(TAKEN_CODE);
      expect((await as(cookies.waiter2).put('/api/auth/pin', { currentPin: PINS.waiter2, pin: PINS.waiter })).status).toBe(429);
    });
  });

  describe('verifier fixes (F-b, F-e)', () => {
    it('PIN-only identify refuses a member whose own PIN is locked', async () => {
      for (let i = 0; i < 5; i++) await as(cookies.waiter2).put('/api/auth/pin', { currentPin: String(110370 + i), pin: '640299' });
      const terminal = await openTerminal(emails.cashier);
      const res = await identify(terminal, PINS.waiter2);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('pin_locked');
      expect((await identify(terminal, PINS.waiter)).status).toBe(200);
    });

    it('above the bounds (100 identify, 200 uniqueness) PIN-only identify and PIN writes refuse clearly, without counting an attempt', async () => {
      await db(`INSERT INTO users (id, email, password_hash, password_algo)
                SELECT ('10000000-0000-0000-0000-000000009' || lpad(n::text, 3, '0'))::uuid, 'mass' || n || '@a.test', password_hash, password_algo
                  FROM users, generate_series(1, 200) n WHERE users.id = $1`, [fixtures.adminA.userId]);
      await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id)
                SELECT ('20000000-0000-0000-0000-000000009' || lpad(n::text, 3, '0'))::uuid, ('10000000-0000-0000-0000-000000009' || lpad(n::text, 3, '0'))::uuid,
                       'Mass ' || n, 'mass' || n || '@a.test', 'waiter', $1 FROM generate_series(1, 200) n`, [A]);
      await db(`INSERT INTO staff_pins (profile_id, restaurant_id, pin_hash, pin_pepper_version)
                SELECT ('20000000-0000-0000-0000-000000009' || lpad(n::text, 3, '0'))::uuid, $1, pin_hash, pin_pepper_version
                  FROM staff_pins, generate_series(1, 200) n WHERE profile_id = $2`, [A, ids.cook]);
      try {
        const terminal = await openTerminal(emails.cashier);
        const res = await identify(terminal, PINS.waiter);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'pin_too_many', message: MESSAGES.tooMany });
        expect(await counters()).toEqual([]);
        const write = await setPin(ids.cashier, '640277');
        expect(write.status).toBe(409);
        expect(write.body).toMatchObject({ code: 'pin_check_unavailable', message: MESSAGES.checkUnavailable });
      } finally {
        await db(`DELETE FROM users WHERE email LIKE 'mass%@a.test'`);
      }
    }, 60_000);
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
