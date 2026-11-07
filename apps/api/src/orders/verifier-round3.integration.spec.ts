import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTING_HEADER } from '../auth/terminal-access';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * F1 (odd/tasks/fase3-operacion.md): cancellations and voids are stored,
 * audited events; nothing is deleted. The supervisor authorization comes from
 * the real POST /auth/authorize (F2) with a PIN.
 */
const A = fixtures.restaurantA;
const ids = {
  cashier2User: '10000000-0000-0000-0000-0000000000f2',
  cashier2: '20000000-0000-0000-0000-0000000000f2',
  register: '30000000-0000-0000-0000-0000000000f1',
  dish: '30000000-0000-0000-0000-0000000000f2',
  flour: '30000000-0000-0000-0000-0000000000f3',
  tables: Array.from({ length: 40 }, (_, i) => `40000000-0000-0000-0000-00000000f${(0x100 + i).toString(16)}`),
};
const cashier = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId, name: 'Legacy A' };
const cashier2 = { email: 'cashier2@a.test', profileId: ids.cashier2, name: 'Cajero Dos' };
const PINS: Record<string, string> = {
  [fixtures.adminA.profileId]: '9157',
  [cashier.profileId]: '582046',
  [ids.cashier2]: '73914',
  [fixtures.waiterA.profileId]: '4829',
};

const MESSAGES = {
  required: 'Esta acción necesita la autorización de un supervisor',
  invalid: 'La autorización del supervisor no es válida, expiró o ya fue usada',
  self: 'Otra persona con rol de supervisor debe autorizar esta acción',
};

describe('verifier probes F1 round 3', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cashMethod: string;
  const cookies: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const server = () => request(app.getHttpServer());
  const as = (email: string) => ({
    get: (url: string) => server().get(url).set('Cookie', cookies[email]),
    post: (url: string, body?: object) => server().post(url).set('Cookie', cookies[email]).send(body),
    put: (url: string, body?: object) => server().put(url).set('Cookie', cookies[email]).send(body),
    delete: (url: string, body?: object) => {
      const req = server().delete(url).set('Cookie', cookies[email]);
      return body ? req.send(body) : req;
    },
  });
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const cash = () => as(cashier.email);
  const adminB = () => as(fixtures.adminB.email);
  /** A shared terminal session; with `acting` the request carries the identified staff member's claim. */
  const onTerminal = (cookie: string, acting?: string) => {
    const withClaim = <T extends request.Test>(req: T) => (acting ? req.set(ACTING_HEADER, acting) : req);
    return {
      post: (url: string, body?: object) => withClaim(server().post(url).set('Cookie', cookie)).send(body),
    };
  };

  /** A supervisor authorization from the real PIN flow. */
  /** Bound to one order (cancel_order, void_item) or payment (void_payment); the caller must be the one who then acts. */
  const authorize = async (action: string, supervisor: string, targetId: string, caller: string = fixtures.waiterA.email) => {
    const targetType = action === 'void_payment' ? 'payment' : 'order';
    const res = await as(caller).post('/api/auth/authorize', { pin: PINS[supervisor], action, profileId: supervisor, targetType, targetId });
    expect(res.status).toBe(201);
    return res.body.authorizationId as string;
  };

  let tableIndex = 0;
  /** An order in the kitchen with its lines (all sent: the server only holds sent lines), on a fresh table. */
  const newOrder = async (lines: { name: string; price: number; quantity: number; status?: string }[] = [], restaurant: string = A) => {
    const tableId = ids.tables[tableIndex++];
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    await db(`INSERT INTO tables (id, number, status, waiter_id, restaurant_id) VALUES ($1, $2, 'kitchen', $3, $4)`, [
      tableId,
      200 + tableIndex,
      restaurant === A ? fixtures.waiterA.profileId : null,
      restaurant,
    ]);
    const [order] = await db<{ id: string }>(
      `INSERT INTO orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id)
       VALUES ($1, $2, 'kitchen', $3, 0, 0, $3, $4) RETURNING id`,
      [tableId, restaurant === A ? fixtures.waiterA.profileId : null, subtotal, restaurant],
    );
    const items: string[] = [];
    for (const [index, line] of lines.entries()) {
      const [item] = await db<{ id: string }>(
        `INSERT INTO order_items (order_id, dish_id, name, price, quantity, status, restaurant_id, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8 * interval '1 second') RETURNING id`,
        [order.id, restaurant === A ? ids.dish : null, line.name, line.price, line.quantity, line.status ?? 'kitchen', restaurant, index],
      );
      items.push(item.id);
    }
    return { orderId: order.id, tableId, items };
  };
  const pay = (orderId: string, amount: number, key = crypto.randomUUID()) =>
    cash().post('/api/payments', {
      orderId,
      cashRegisterId: ids.register,
      tipAmount: 0,
      tenders: [{ paymentMethodId: cashMethod, amount, cashReceived: amount }],
      idempotencyKey: key,
    });

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(
      `INSERT INTO users (id, email, password_hash, password_algo)
         SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
      [ids.cashier2User, cashier2.email, fixtures.adminA.email],
    );
    await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cajero Dos', $3, 'cashier', $4)`, [
      ids.cashier2,
      ids.cashier2User,
      cashier2.email,
      A,
    ]);
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [ids.dish, A]);
    await db(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 50000, 'open')`, [
      ids.register,
      A,
    ]);
    [{ id: cashMethod }] = await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, cashier.email, cashier2.email, fixtures.adminB.email]) {
      const res = await server().post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const [profileId, pin] of Object.entries(PINS)) {
      expect((await admin().put(`/api/staff/${profileId}/pin`, { pin })).status).toBe(204);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const voidBody = (itemId: string, quantity: number, authorizationId?: string) => ({ items: [{ itemId, quantity }], reason: 'dish_returned', authorizationId });
  const qty = async (id: string) => (await db<{ quantity: number }>('SELECT quantity FROM order_items WHERE id = $1', [id]))[0].quantity;

  it('PB1/V5: waiter authorization used by admin on a different order, by admin on same order, by waiter on another order; then correct', async () => {
    const a = await newOrder([{ name: 'Lomo', price: 90000, quantity: 3 }]);
    const b = await newOrder([{ name: 'Lomo', price: 90000, quantity: 3 }]);
    const auth = await authorize('void_item', cashier.profileId, a.orderId);
    const r1 = await admin().post(`/api/orders/${b.orderId}/items/void`, voidBody(b.items[0], 3, auth));
    const r2 = await admin().post(`/api/orders/${a.orderId}/items/void`, voidBody(a.items[0], 3, auth));
    const r3 = await waiter().post(`/api/orders/${b.orderId}/items/void`, voidBody(b.items[0], 3, auth));
    console.log('PB1', r1.status, r1.body, r2.status, r2.body.code, r3.status, r3.body.code);
    expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
    expect(r1.body).toMatchObject({ message: MESSAGES.invalid, code: 'authorization_invalid' });
    expect([await qty(a.items[0]), await qty(b.items[0])]).toEqual([3, 3]);
    // cancel_order path too (POST cancel and DELETE)
    const c1 = await authorize('cancel_order', cashier.profileId, a.orderId);
    const d1 = await admin().delete(`/api/orders/${b.orderId}`, { reason: 'customer_left', authorizationId: c1 });
    const d2 = await admin().post(`/api/orders/${a.orderId}/cancel`, { reason: 'customer_left', authorizationId: c1 });
    console.log('PB1-cancel', d1.status, d1.body.code, d2.status, d2.body.code);
    expect([d1.status, d2.status]).toEqual([403, 403]);
    const ok = await waiter().post(`/api/orders/${a.orderId}/items/void`, voidBody(a.items[0], 1, auth));
    expect(ok.status).toBe(200);
    // reuse after consumption
    const again = await waiter().post(`/api/orders/${a.orderId}/items/void`, voidBody(a.items[0], 1, auth));
    console.log('reuse', again.status, again.body);
    expect(again.status).toBe(403);
    expect(await qty(a.items[0])).toBe(2);
    // the unspent cancel authorization still works for its requester and order
    const okc = await waiter().post(`/api/orders/${a.orderId}/cancel`, { reason: 'customer_left', authorizationId: c1 });
    expect(okc.status).toBe(200);
    const [row] = await db<{ actor_profile_id: string; authorized_by_profile_id: string }>(
      `SELECT actor_profile_id, authorized_by_profile_id FROM audit_log WHERE order_id = $1 AND event_type = 'order_cancelled'`, [a.orderId]);
    expect(row).toEqual({ actor_profile_id: fixtures.waiterA.profileId, authorized_by_profile_id: cashier.profileId });
  });

  it('authorization naming an order of another restaurant backs nothing', async () => {
    const foreign = await newOrder([{ name: 'B', price: 1000, quantity: 2 }], fixtures.restaurantB);
    const auth = await authorize('void_item', cashier.profileId, foreign.orderId);
    const byWaiter = await waiter().post(`/api/orders/${foreign.orderId}/items/void`, voidBody(foreign.items[0], 1, auth));
    const byAdminB = await adminB().post(`/api/orders/${foreign.orderId}/items/void`, voidBody(foreign.items[0], 1, auth));
    console.log('foreign', byWaiter.status, byWaiter.body.code, byAdminB.status, byAdminB.body.code);
    expect(byWaiter.status).toBe(404);
    expect(byAdminB.status).toBe(403);
    expect(await qty(foreign.items[0])).toBe(2);
  });

  it('concurrent double use of one authorization: exactly one void', async () => {
    const a = await newOrder([{ name: 'Lomo', price: 90000, quantity: 5 }]);
    const auth = await authorize('void_item', cashier.profileId, a.orderId);
    const statuses = await Promise.all(
      Array.from({ length: 4 }, () => waiter().post(`/api/orders/${a.orderId}/items/void`, voidBody(a.items[0], 1, auth)).then((r) => r.status)),
    );
    console.log('concurrent', statuses);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    expect(await qty(a.items[0])).toBe(4);
    expect(await db('SELECT count(*)::int AS n FROM order_item_voids WHERE order_item_id = $1', [a.items[0]])).toEqual([{ n: 1 }]);
  });

  it('payment void: bound to the payment and to the requester', async () => {
    const o1 = await newOrder([{ name: 'P1', price: 4000, quantity: 1, status: 'served' }]);
    const o2 = await newOrder([{ name: 'P2', price: 4000, quantity: 1, status: 'served' }]);
    const p1 = (await pay(o1.orderId, 4000)).body.paymentId as string;
    const p2 = (await pay(o2.orderId, 4000)).body.paymentId as string;
    const auth = await authorize('void_payment', ids.cashier2, p1, cashier.email);
    const other = await cash().post(`/api/payments/${p2}/void`, { reason: 'duplicate_charge', authorizationId: auth });
    const byAdmin = await admin().post(`/api/payments/${p1}/void`, { reason: 'duplicate_charge', authorizationId: auth });
    console.log('payvoid', other.status, other.body.code, byAdmin.status, byAdmin.body.code);
    expect([other.status, byAdmin.status]).toEqual([403, 403]);
    const ok = await cash().post(`/api/payments/${p1}/void`, { reason: 'duplicate_charge', authorizationId: auth });
    expect(ok.status).toBe(200);
    expect(await db('SELECT (voided_at IS NOT NULL) AS v FROM payments WHERE id = ANY($1) ORDER BY id = $2 DESC', [[p1, p2], p1])).toEqual([{ v: true }, { v: false }]);
  });

  it('A5: a supervisor whose user is deactivated after the PIN cannot back the void', async () => {
    const a = await newOrder([{ name: 'Lomo', price: 90000, quantity: 2 }]);
    const auth = await authorize('void_item', ids.cashier2, a.orderId);
    await db('UPDATE users SET is_active = false WHERE id = $1', [ids.cashier2User]);
    try {
      const r = await waiter().post(`/api/orders/${a.orderId}/items/void`, voidBody(a.items[0], 1, auth));
      console.log('A5', r.status, r.body);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('authorization_invalid');
    } finally {
      await db('UPDATE users SET is_active = true WHERE id = $1', [ids.cashier2User]);
    }
  });

  it('A4 via API: adding items to a cancelled order and a quantity 0 line are refused without 500', async () => {
    const a = await newOrder([]);
    expect((await admin().delete(`/api/orders/${a.orderId}`)).status).toBe(204);
    const add = await waiter().post(`/api/orders/${a.orderId}/items`, { items: [{ dishId: ids.dish, quantity: 1 }] });
    const zero = await waiter().post(`/api/orders/${(await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }])).orderId}/items`, { items: [{ dishId: ids.dish, quantity: 0 }] });
    console.log('A4', add.status, add.body, zero.status, zero.body);
    expect(add.status).toBeLessThan(500);
    expect(add.status).toBeGreaterThanOrEqual(400);
    expect(zero.status).toBe(422);
  });

  it('B2: undo-split refused when the child order had a void after the split; plain undo still works', async () => {
    const a = await newOrder([{ name: 'Arepa', price: 5000, quantity: 4 }, { name: 'Jugo', price: 2000, quantity: 2 }]);
    const split = await cash().post(`/api/orders/${a.orderId}/split`, { items: [{ orderItemId: a.items[1], quantity: 2 }] });
    expect(split.status).toBe(200);
    const child = split.body.childOrderId as string;
    const [childItem] = await db<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1', [child]);
    const auth = await authorize('void_item', ids.cashier2, child, cashier.email);
    expect((await cash().post(`/api/orders/${child}/items/void`, voidBody(childItem.id, 1, auth))).status).toBe(200);
    const undo = await cash().post(`/api/orders/${child}/undo-split`);
    console.log('B2', undo.status, undo.body);
    expect(undo.status).toBe(409);
    expect(undo.body).toMatchObject({ message: 'Esta cuenta dividida tiene productos anulados; no se puede deshacer la división', code: 'split_has_voids' });

    const b = await newOrder([{ name: 'Arepa', price: 5000, quantity: 4 }, { name: 'Jugo', price: 2000, quantity: 2 }]);
    const s2 = await cash().post(`/api/orders/${b.orderId}/split`, { items: [{ orderItemId: b.items[1], quantity: 1 }] });
    const u2 = await cash().post(`/api/orders/${s2.body.childOrderId}/undo-split`);
    expect(u2.status).toBe(200);
  });

  it('B3: a fully voided line is not a popular dish; partial void counts only remaining units', async () => {
    const a = await newOrder([{ name: 'ZZ Voided', price: 1000, quantity: 3 }, { name: 'ZZ Partial', price: 1000, quantity: 5 }, { name: 'ZZ Keep', price: 1000, quantity: 1 }]);
    const auth = await authorize('void_item', cashier.profileId, a.orderId);
    expect((await waiter().post(`/api/orders/${a.orderId}/items/void`, { items: [{ itemId: a.items[0], quantity: 3 }, { itemId: a.items[1], quantity: 2 }], reason: 'dish_returned', authorizationId: auth })).status).toBe(200);
    expect((await pay(a.orderId, 4000)).status).toBe(200);
    const dash = (await admin().get('/api/dashboard/summary')).body;
    const zz = (dash.popularDishes as { name: string; count: number }[]).filter((d) => d.name.startsWith('ZZ'));
    console.log('B3', JSON.stringify(zz));
    expect(zz.find((d) => d.name === 'ZZ Voided')).toBeUndefined();
    expect(zz.find((d) => d.name === 'ZZ Partial')?.count).toBe(3);
  });

  describe('A2 shared terminal', () => {
    let terminal: string;
    beforeAll(async () => {
      expect((await admin().put('/api/config', { waiterAccessMode: 'shared_terminal' })).status).toBe(200);
      const opened = await server().post('/api/auth/terminal/login').send({ email: cashier.email, password: PASSWORD });
      expect(opened.status).toBe(200);
      terminal = cookiePair(setCookies(opened).vipe_access);
    });
    const identify = async (profileId: string) => {
      const r = await onTerminal(terminal).post('/api/auth/identify', { profileId, pin: PINS[profileId] });
      expect(r.status).toBe(200);
      return r.body.token as string;
    };
    const tDelete = (url: string, acting?: string, body?: object) => {
      let req = server().delete(url).set('Cookie', terminal);
      if (acting) req = req.set(ACTING_HEADER, acting);
      return body ? req.send(body) : req;
    };

    it('routes need the claim; actor and requester are the identified waiter; payment void is off terminals', async () => {
      const o = await newOrder([{ name: 'Arepa', price: 5000, quantity: 3 }]);
      const noClaim = await onTerminal(terminal).post('/api/auth/authorize', { pin: PINS[ids.cashier2], action: 'void_item', profileId: ids.cashier2, targetType: 'order', targetId: o.orderId });
      const noClaimVoid = await onTerminal(terminal).post(`/api/orders/${o.orderId}/items/void`, voidBody(o.items[0], 1));
      const noClaimDel = await tDelete(`/api/orders/${o.orderId}`);
      console.log('A2 noclaim', noClaim.status, noClaim.body, noClaimVoid.status, noClaimVoid.body.code, noClaimDel.status, noClaimDel.body.code);
      expect([noClaim.status, noClaimVoid.status, noClaimDel.status]).toEqual([403, 403, 403]);
      expect([noClaim.body.code, noClaimVoid.body.code, noClaimDel.body.code]).toEqual(['acting_required', 'acting_required', 'acting_required']);
      const acting = await identify(fixtures.waiterA.profileId);
      const auth = await onTerminal(terminal, acting).post('/api/auth/authorize', { pin: PINS[ids.cashier2], action: 'void_item', profileId: ids.cashier2, targetType: 'order', targetId: o.orderId });
      expect(auth.status).toBe(201);
      const v = await onTerminal(terminal, acting).post(`/api/orders/${o.orderId}/items/void`, voidBody(o.items[0], 1, auth.body.authorizationId));
      expect(v.status).toBe(200);
      const [ev] = await db<{ actor_profile_id: string; authorized_by_profile_id: string }>(
        `SELECT actor_profile_id, authorized_by_profile_id FROM audit_log WHERE order_id = $1 AND event_type = 'items_voided'`, [o.orderId]);
      expect(ev).toEqual({ actor_profile_id: fixtures.waiterA.profileId, authorized_by_profile_id: ids.cashier2 });
      // An authorization requested by the waiter on the terminal is not usable by the terminal opener (cashier) on their own account
      const auth2 = await onTerminal(terminal, acting).post('/api/auth/authorize', { pin: PINS[ids.cashier2], action: 'cancel_order', profileId: ids.cashier2, targetType: 'order', targetId: o.orderId });
      const asOpener = await cash().post(`/api/orders/${o.orderId}/cancel`, { reason: 'customer_left', authorizationId: auth2.body.authorizationId });
      expect(asOpener.status).toBe(403);
      // DELETE with body on terminal, acting
      const del = await tDelete(`/api/orders/${o.orderId}`, acting, { reason: 'customer_left', authorizationId: auth2.body.authorizationId });
      expect(del.status).toBe(204);
      const [c] = await db<{ actor_profile_id: string }>(`SELECT actor_profile_id FROM audit_log WHERE order_id = $1 AND event_type = 'order_cancelled'`, [o.orderId]);
      expect(c.actor_profile_id).toBe(fixtures.waiterA.profileId);
      // payment void stays off terminals, with or without claim
      const p = await newOrder([{ name: 'Pay', price: 1000, quantity: 1, status: 'served' }]);
      const pid = (await pay(p.orderId, 1000)).body.paymentId as string;
      const pv = await onTerminal(terminal, acting).post(`/api/payments/${pid}/void`, { reason: 'duplicate_charge' });
      const pv2 = await onTerminal(terminal).post(`/api/payments/${pid}/void`, { reason: 'duplicate_charge' });
      console.log('A2 payvoid', pv.status, pv.body.code, pv2.status, pv2.body.code);
      expect([pv.body.code, pv2.body.code]).toEqual(['terminal_route', 'terminal_route']);
    });

    it('lockout on a terminal: re-identifying (or another staff member) does not reset the authorize counters', async () => {
      const o = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const target = { targetType: 'order', targetId: o.orderId };
      // profile-bound guesses on cashier2
      let acting = await identify(fixtures.waiterA.profileId);
      const s1: number[] = [];
      for (let i = 0; i < 5; i++) s1.push((await onTerminal(terminal, acting).post('/api/auth/authorize', { pin: String(250813 + i * 7), action: 'void_item', profileId: ids.cashier2, ...target })).status);
      acting = await identify(fixtures.waiterA.profileId);
      const sameAfterReidentify = await onTerminal(terminal, acting).post('/api/auth/authorize', { pin: PINS[ids.cashier2], action: 'void_item', profileId: ids.cashier2, ...target });
      const adminActing = await identify(fixtures.adminA.profileId);
      const otherStaff = await onTerminal(terminal, adminActing).post('/api/auth/authorize', { pin: PINS[ids.cashier2], action: 'void_item', profileId: ids.cashier2, ...target });
      console.log('lock profile', s1, sameAfterReidentify.status, otherStaff.status);
      expect(s1).toEqual([403, 403, 403, 403, 403]);
      expect(sameAfterReidentify.status).toBe(429);
      expect(otherStaff.status).toBe(429);
      // profile-less guesses: the restaurant's supervisor set locks too
      const s2: number[] = [];
      acting = await identify(ids.cashier2 === fixtures.waiterA.profileId ? '' : cashier.profileId);
      for (let i = 0; i < 5; i++) s2.push((await onTerminal(terminal, acting).post('/api/auth/authorize', { pin: String(360917 + i * 11), action: 'void_item', ...target })).status);
      const again = await identify(cashier.profileId);
      const pl1 = await onTerminal(terminal, again).post('/api/auth/authorize', { pin: PINS[fixtures.adminA.profileId], action: 'void_item', ...target });
      const pl2 = await onTerminal(terminal, adminActing).post('/api/auth/authorize', { pin: PINS[fixtures.adminA.profileId], action: 'void_item', ...target });
      console.log('lock supervisors', s2, pl1.status, pl2.status);
      expect(s2).toEqual([403, 403, 403, 403, 403]);
      expect(pl1.status).toBe(429);
      expect(pl2.status).toBe(429);
    });
  });
});
