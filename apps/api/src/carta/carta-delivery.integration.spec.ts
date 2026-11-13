import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const c = {
  mains: 'e1000000-0000-0000-0000-000000000001',
  ajiaco: 'e3000000-0000-0000-0000-000000000001',
  steak: 'e3000000-0000-0000-0000-000000000002',
  off: 'e3000000-0000-0000-0000-000000000003',
  juice: 'e3000000-0000-0000-0000-000000000004',
  dishB: 'e3000000-0000-0000-0000-0000000000b1',
  promo: 'e4000000-0000-0000-0000-000000000001',
  bill: 'e4000000-0000-0000-0000-000000000002',
  doneness: 'e5000000-0000-0000-0000-000000000001',
  wellDone: 'e6000000-0000-0000-0000-000000000001',
  operator: { userId: 'e7000000-0000-0000-0000-000000000001', profileId: 'e8000000-0000-0000-0000-000000000001', email: 'operator@a.test' },
  cashier: { userId: 'e7000000-0000-0000-0000-000000000002', profileId: 'e8000000-0000-0000-0000-000000000002', email: 'cashier@a.test' },
} as const;

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'No encontramos esta carta.' };
const MESSAGES = {
  disabled: 'Este restaurante recibe los domicilios por WhatsApp.',
  soldOut: 'Uno de los platos se acabó por hoy.',
  tooManyPending: 'Ya tienes pedidos pendientes; el restaurante te confirmará en minutos.',
  tooBusy: 'El restaurante está recibiendo muchos pedidos; intenta en unos minutos.',
  rateLimit: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
  notPending: 'Este pedido ya fue confirmado o rechazado.',
};
/** Tuesday 2026-11-10 12:00 in Bogotá. */
const BASE = Date.UTC(2026, 10, 10, 17, 0);

describe('carta delivery (Testcontainers, guest + staff)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let operatorCookie = '';
  let cashierCookie = '';
  let adminCookie = '';
  let waiterCookie = '';
  let minute = 0;
  let phoneSeq = 0;

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const http = () => request(app.getHttpServer());
  /** Each step is a new minute, so every rate-limit window starts empty. */
  const nextMinute = () => {
    minute++;
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(BASE + minute * 61_000));
  };
  const nextPhone = () => String(3100000000 + ++phoneSeq);
  const body = (extra: Record<string, unknown> = {}) => ({
    customer: { name: ' Ana Gómez ', phone: nextPhone(), address: 'Calle 10 # 5-20', neighborhood: 'Centro' },
    items: [{ dishId: c.ajiaco, quantity: 2 }],
    payment: { method: 'cash', cashFrom: 50000 },
    ...extra,
  });
  const submit = (payload: unknown, slug = 'rest-a') => http().post(`/api/carta/${slug}/delivery`).send(payload as object);
  /** A pending request in a fresh minute (the 3/min limit), returned with its id and token. */
  const pending = async (payload: unknown = body()) => {
    nextMinute();
    const res = await submit(payload);
    expect(res.status).toBe(201);
    return res.body as { requestId: string; trackingToken: string };
  };
  const status = (token: string, slug = 'rest-a') => http().get(`/api/carta/${slug}/delivery/${token}`);
  const login = async (email: string) =>
    cookiePair(setCookies(await http().post('/api/auth/login').send({ email, password: PASSWORD })).vipe_access);
  const confirm = (id: string, cookie = operatorCookie) => http().post(`/api/carta-delivery/${id}/confirm`).set('Cookie', cookie);
  const reject = (id: string, reason?: string, cookie = operatorCookie) =>
    http().post(`/api/carta-delivery/${id}/reject`).set('Cookie', cookie).send(reason === undefined ? {} : { reason });

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed();
    app = await createTestApp(database.apiUrl);
    operatorCookie = await login(c.operator.email);
    cashierCookie = await login(c.cashier.email);
    adminCookie = await login(fixtures.adminA.email);
    waiterCookie = await login(fixtures.waiterA.email);
  });

  beforeEach(() => nextMinute());

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('POST /carta/:slug/delivery (S15)', () => {
    it('201 pending with a tracking token; the phone is normalized and nothing reaches the kitchen', async () => {
      const ordersBefore = await db('SELECT id FROM orders');
      const res = await submit(body({ customer: { name: ' Ana Gómez ', phone: '+57 300 123 4567', address: 'Calle 10 # 5-20' }, notes: ' Timbre ' }));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ requestId: expect.any(String), trackingToken: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/), status: 'pending', createdAt: expect.any(String) });
      const [row] = await db('SELECT restaurant_id, customer_name, phone, address, neighborhood, notes, payment_method, cash_from, delivery_fee, items FROM carta_delivery_requests WHERE id = $1', [
        res.body.requestId,
      ]);
      expect(row).toEqual({
        restaurant_id: fixtures.restaurantA,
        customer_name: 'Ana Gómez',
        phone: '3001234567',
        address: 'Calle 10 # 5-20',
        neighborhood: null,
        notes: 'Timbre',
        payment_method: 'cash',
        cash_from: 50000,
        delivery_fee: '5000',
        items: [{ dishId: c.ajiaco, quantity: 2, optionIds: [], note: null }],
      });
      expect(await db('SELECT id FROM orders')).toEqual(ordersBefore);
      await db("UPDATE carta_delivery_requests SET status = 'rejected', decided_at = now() WHERE id = $1", [res.body.requestId]);
    });

    it('a staff cookie of another restaurant changes nothing (S2)', async () => {
      const cookieB = await login(fixtures.adminB.email);
      const res = await submit(body()).set('Cookie', cookieB);
      expect(res.status).toBe(201);
      expect((await db('SELECT restaurant_id FROM carta_delivery_requests WHERE id = $1', [res.body.requestId]))[0]).toEqual({ restaurant_id: fixtures.restaurantA });
    });

    it.each([
      ['a missing name', { customer: { phone: '3001234567', address: 'Calle 10 # 5-20' } }, 'Escribe tu nombre (hasta 120 caracteres).'],
      ['a short phone', { customer: { name: 'Ana', phone: '12345', address: 'Calle 10 # 5-20' } }, 'El celular debe tener entre 7 y 15 dígitos.'],
      ['a short address', { customer: { name: 'Ana', phone: '3001234567', address: 'Cl 1' } }, 'Escribe la dirección completa (entre 6 y 200 caracteres).'],
      ['a long neighborhood', { customer: { name: 'Ana', phone: '3001234567', address: 'Calle 10 # 5-20', neighborhood: 'b'.repeat(81) } }, 'El barrio admite hasta 80 caracteres.'],
      ['an unknown payment', { payment: { method: 'bitcoin' } }, 'Elige cómo pagas: efectivo, datáfono o transferencia.'],
      ['cashFrom with card', { payment: { method: 'card', cashFrom: 1000 } }, 'Elige cómo pagas: efectivo, datáfono o transferencia.'],
      ['no items', { items: [] }, 'Revisa los platos del pedido: entre 1 y 20 líneas de 1 a 20 unidades.'],
      ['long notes', { notes: 'n'.repeat(201) }, 'La nota del pedido admite hasta 200 caracteres.'],
    ])('422 in Spanish on %s, nothing stored', async (_name, extra, message) => {
      const before = await db('SELECT count(*)::int AS n FROM carta_delivery_requests');
      const res = await submit(body(extra));
      expect([res.status, res.body.message]).toEqual([422, message]);
      expect(await db('SELECT count(*)::int AS n FROM carta_delivery_requests')).toEqual(before);
    });

    it('409 when online delivery is off, and on a paused dish', async () => {
      await db('UPDATE carta_settings SET delivery_ordering_enabled = false WHERE restaurant_id = $1', [fixtures.restaurantB]);
      const off = await submit(body({ items: [{ dishId: c.dishB, quantity: 1 }] }), 'rest-b');
      expect([off.status, off.body.message]).toEqual([409, MESSAGES.disabled]);
      await db('UPDATE carta_settings SET delivery_ordering_enabled = true WHERE restaurant_id = $1', [fixtures.restaurantB]);
      const paused = await submit(body({ items: [{ dishId: c.off, quantity: 1 }] }));
      expect([paused.status, paused.body.message]).toEqual([409, MESSAGES.soldOut]);
    });

    it('404 with the carta body for an unknown slug', async () => {
      const res = await submit(body(), 'nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it('429 after two pending requests of one phone, never the raw DB message', async () => {
      const phone = nextPhone();
      const withPhone = () => body({ customer: { name: 'Ana', phone, address: 'Calle 10 # 5-20' } });
      await pending(withPhone());
      await pending(withPhone());
      nextMinute();
      const res = await submit(withPhone());
      expect([res.status, res.body.message]).toEqual([429, MESSAGES.tooManyPending]);
    });

    it('429 when the restaurant has 30 pending requests within the hour', async () => {
      await db(
        `INSERT INTO carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items)
         SELECT $1, private.new_table_qr_token(), 'Cliente', (3200000000 + g)::text, 'Calle 1 # 2-3', 'cash', $2::jsonb FROM generate_series(1, 30) g`,
        [fixtures.restaurantB, JSON.stringify([{ dishId: c.dishB, quantity: 1, optionIds: [], note: null }])],
      );
      const res = await submit(body({ items: [{ dishId: c.dishB, quantity: 1 }] }), 'rest-b');
      expect([res.status, res.body.message]).toEqual([429, MESSAGES.tooBusy]);
      await db('DELETE FROM carta_delivery_requests WHERE restaurant_id = $1', [fixtures.restaurantB]);
    });

    it('3 a minute per IP, then the limiter 429', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await submit({})).status);
      expect(codes).toEqual([422, 422, 422, 429]);
    });
  });

  describe('GET /carta/:slug/delivery/:trackingToken (S15)', () => {
    it('the pending stage, lines and fee, no customer data', async () => {
      const { trackingToken } = await pending(body({ items: [{ dishId: c.ajiaco, quantity: 2 }, { dishId: c.juice, quantity: 1 }], payment: { method: 'transfer' } }));
      const res = await status(trackingToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'pending',
        stage: 'pending',
        rejectReason: null,
        createdAt: expect.any(String),
        lines: [
          { name: 'Ajiaco', quantity: 2 },
          { name: 'Jugo', quantity: 1 },
        ],
        deliveryFee: 5000,
        total: null,
        orderNumber: null,
        paymentMethod: 'transfer',
      });
    });

    it.each([
      ['an unknown token', '/api/carta/rest-a/delivery/AAAAAAAAAAAAAAAAAAAAAAAA'],
      ['an invalid token', '/api/carta/rest-a/delivery/short'],
      ['an unknown slug', '/api/carta/nope/delivery/AAAAAAAAAAAAAAAAAAAAAAAA'],
    ])('404 on %s', async (_name, url) => {
      const res = await http().get(url);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it('404 with the identical body for a token under another slug', async () => {
      const { trackingToken } = await pending();
      const res = await status(trackingToken, 'rest-b');
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('staff /carta-delivery', () => {
    it('401 without a cookie, 403 for a waiter, cashier cannot confirm', async () => {
      const { requestId } = await pending();
      expect((await http().get('/api/carta-delivery')).status).toBe(401);
      expect((await http().get('/api/carta-delivery').set('Cookie', waiterCookie)).status).toBe(403);
      expect((await confirm(requestId, waiterCookie)).status).toBe(403);
      expect((await confirm(requestId, cashierCookie)).status).toBe(403);
      expect((await http().get('/api/carta-delivery').set('Cookie', cashierCookie)).status).toBe(200);
    });

    it('pending requests newest first with lines and the preview total, never another restaurant', async () => {
      await db("UPDATE carta_delivery_requests SET status = 'rejected', decided_at = now() WHERE status = 'pending'");
      const older = await pending(body({ items: [{ dishId: c.juice, quantity: 1 }] }));
      const newer = await pending(body({ items: [{ dishId: c.steak, quantity: 1, optionIds: [c.wellDone], note: 'jugoso' }], payment: { method: 'card' } }));
      const res = await http().get('/api/carta-delivery').set('Cookie', operatorCookie);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).toEqual([newer.requestId, older.requestId]);
      expect(res.body[0]).toEqual({
        id: newer.requestId,
        customerName: 'Ana Gómez',
        registeredName: null,
        phone: expect.stringMatching(/^31/),
        address: 'Calle 10 # 5-20',
        neighborhood: 'Centro',
        notes: null,
        paymentMethod: 'card',
        cashFrom: null,
        deliveryFee: 5000,
        createdAt: expect.any(String),
        lines: [{ dishId: c.steak, name: 'Churrasco', quantity: 1, note: 'jugoso', options: [{ id: c.wellDone, name: 'Bien asado' }] }],
        previewSubtotal: 32000,
        previewTotal: 37000,
      });
      const cookieB = await login(fixtures.adminB.email);
      const foreign = await http().get('/api/carta-delivery').set('Cookie', cookieB);
      expect(foreign.body).toEqual([]);
    });

    it('confirm creates the delivery order through the console path, links it, and the guest follows the stages', async () => {
      const phone = nextPhone();
      const { requestId, trackingToken } = await pending(
        body({
          customer: { name: 'Nuevo Cliente', phone, address: 'Carrera 7 # 1-2', neighborhood: 'Chapinero' },
          items: [{ dishId: c.ajiaco, quantity: 2 }, { dishId: c.steak, quantity: 1, optionIds: [c.wellDone], note: 'jugoso' }],
          payment: { method: 'cash', cashFrom: 100000 },
          notes: 'Portería',
        }),
      );
      const res = await confirm(requestId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ requestId, status: 'confirmed', order: { orderId: expect.any(String), delivery: { deliveryFee: 5000 } } });
      const orderId = res.body.order.orderId as string;
      const [delivery] = await db(
        `SELECT od.customer_name, od.customer_phone, od.address_line, od.neighborhood, od.delivery_fee, od.payment_mode, od.cash_change_for, od.notes,
                od.delivery_status, o.order_type, o.restaurant_id, c.name AS customer
           FROM order_deliveries od JOIN orders o ON o.id = od.order_id JOIN customers c ON c.id = od.customer_id WHERE od.order_id = $1`,
        [orderId],
      );
      expect(delivery).toEqual({
        customer_name: 'Nuevo Cliente',
        customer_phone: phone,
        address_line: 'Carrera 7 # 1-2',
        neighborhood: 'Chapinero',
        delivery_fee: '5000',
        payment_mode: 'cash_on_delivery',
        cash_change_for: '100000',
        notes: 'Portería',
        delivery_status: 'received',
        order_type: 'delivery',
        restaurant_id: fixtures.restaurantA,
        customer: 'Nuevo Cliente',
      });
      const items = await db<{ name: string; quantity: number; comments: string | null; promotion_id: string | null }>(
        'SELECT name, quantity, comments, promotion_id FROM order_items WHERE order_id = $1 ORDER BY name',
        [orderId],
      );
      expect(items).toEqual([
        { name: 'Ajiaco', quantity: 2, comments: null, promotion_id: c.promo },
        { name: 'Churrasco', quantity: 1, comments: 'jugoso', promotion_id: null },
      ]);
      const [linked] = await db('SELECT status, delivery_order_id, decided_by FROM carta_delivery_requests WHERE id = $1', [requestId]);
      expect(linked).toEqual({ status: 'confirmed', delivery_order_id: orderId, decided_by: c.operator.profileId });
      const [order] = await db<{ total: string; order_number: number }>('SELECT total, order_number FROM orders WHERE id = $1', [orderId]);
      const guest = await status(trackingToken);
      expect(guest.body).toMatchObject({ status: 'confirmed', stage: 'received', total: Number(order.total) + 5000, orderNumber: order.order_number });

      const preparing = await http().post(`/api/delivery/orders/${orderId}/status`).set('Cookie', operatorCookie).send({ action: 'start_preparing' });
      expect(preparing.status).toBe(200);
      expect((await status(trackingToken)).body.stage).toBe('preparing');
      await db("UPDATE order_deliveries SET delivery_status = 'out_for_delivery', dispatched_at = now() WHERE order_id = $1", [orderId]);
      expect((await status(trackingToken)).body.stage).toBe('out_for_delivery');
      await db("UPDATE order_deliveries SET delivery_status = 'delivered', delivered_at = now() WHERE order_id = $1", [orderId]);
      expect((await status(trackingToken)).body.stage).toBe('delivered');

      const again = await confirm(requestId);
      expect([again.status, again.body.message]).toEqual([409, MESSAGES.notPending]);
    });

    it('card and transfer reach the operator in the delivery notes', async () => {
      const { requestId } = await pending(body({ payment: { method: 'card' }, notes: 'Casa azul' }));
      const res = await confirm(requestId, adminCookie);
      expect(res.status).toBe(200);
      const [row] = await db('SELECT payment_mode, cash_change_for, notes FROM order_deliveries WHERE order_id = $1', [res.body.order.orderId]);
      expect(row).toEqual({ payment_mode: 'cash_on_delivery', cash_change_for: null, notes: 'Paga con datáfono. Casa azul' });
    });

    it('a failing confirm rolls back: the request stays pending and no order is created', async () => {
      const { requestId } = await pending(body({ items: [{ dishId: c.steak, quantity: 1, optionIds: [c.wellDone] }] }));
      const orders = await db('SELECT count(*)::int AS n FROM orders');
      await db('UPDATE modifier_options SET is_active = false WHERE id = $1', [c.wellDone]);
      const res = await confirm(requestId);
      await db('UPDATE modifier_options SET is_active = true WHERE id = $1', [c.wellDone]);
      expect(res.status).toBe(422);
      expect((await db('SELECT status, delivery_order_id FROM carta_delivery_requests WHERE id = $1', [requestId]))[0]).toEqual({ status: 'pending', delivery_order_id: null });
      expect(await db('SELECT count(*)::int AS n FROM orders')).toEqual(orders);
    });

    it('a double confirm answers one 200 and one 409 and creates one order', async () => {
      const { requestId } = await pending();
      const orders = await db<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE order_type = 'delivery'");
      const statuses = (await Promise.all([confirm(requestId), confirm(requestId)])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect((await db<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE order_type = 'delivery'"))[0].n).toBe(orders[0].n + 1);
    });

    it('confirm against reject: one wins, the other is 409, and a reject leaves no order', async () => {
      const { requestId } = await pending();
      const [a, b] = await Promise.all([confirm(requestId), reject(requestId, 'Sin cobertura')]);
      expect([a.status, b.status].filter((s) => s === 409)).toHaveLength(1);
      const [row] = await db<{ status: string; delivery_order_id: string | null }>('SELECT status, delivery_order_id FROM carta_delivery_requests WHERE id = $1', [requestId]);
      expect(row.status === 'confirmed' ? row.delivery_order_id : null).toEqual(a.status === 200 ? a.body.order.orderId : null);
    });

    it('reject with a reason the guest sees, once; 422 on a long reason; 404 for another restaurant', async () => {
      const { requestId, trackingToken } = await pending();
      expect((await reject(requestId, 'r'.repeat(141))).status).toBe(422);
      const res = await reject(requestId, ' No llegamos a tu barrio ', cashierCookie);
      expect(res.status).toBe(204);
      expect((await status(trackingToken)).body).toMatchObject({ status: 'rejected', stage: 'rejected', rejectReason: 'No llegamos a tu barrio', total: null });
      const again = await reject(requestId);
      expect([again.status, again.body.message]).toEqual([409, MESSAGES.notPending]);
      const foreign = await reject(requestId, undefined, await login(fixtures.adminB.email));
      expect(foreign.status).toBe(404);
      expect((await reject('nope')).status).toBe(422);
    });
  });

  describe('POST /carta/:slug/pricing-preview', () => {
    const items = [
      { dishId: c.ajiaco, quantity: 3 },
      { dishId: c.steak, quantity: 1, optionIds: [c.wellDone] },
    ];
    const staffLines = [
      { dishId: c.ajiaco, quantity: 3 },
      { dishId: c.steak, quantity: 1, modifiers: [{ optionId: c.wellDone }] },
    ];

    it.each(['delivery', 'dine_in', 'takeaway'] as const)('equals the staff pricing preview on %s', async (channel) => {
      const guest = await http().post('/api/carta/rest-a/pricing-preview').send({ channel, items });
      const staff = await http().post('/api/orders/pricing-preview').set('Cookie', adminCookie).send({ channel, lines: staffLines });
      expect([guest.status, staff.status]).toEqual([200, 200]);
      const pick = (line: Record<string, unknown>) => ({
        dishId: line.dishId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        promotionId: line.promotionId,
        promotionName: line.promotionName,
        discounts: line.discounts,
      });
      expect(guest.body.lines).toEqual(staff.body.lines.map(pick));
      expect(guest.body.billDiscount).toEqual(staff.body.billDiscount);
      expect(guest.body).toMatchObject({
        channel,
        grossSubtotal: staff.body.grossSubtotal,
        totalDiscounts: staff.body.totalDiscounts,
        netSubtotal: staff.body.netSubtotal,
      });
      const fee = channel === 'delivery' ? 5000 : 0;
      expect(guest.body).toMatchObject({ deliveryFee: fee, total: staff.body.netSubtotal + fee });
      expect(staff.body.totalDiscounts).toBeGreaterThan(0);
      expect(staff.body.billDiscount).not.toBeNull();
    });

    it('422 on a bad channel and invalid options, 409 on a paused dish, 404 on an unknown slug', async () => {
      const bad = await http().post('/api/carta/rest-a/pricing-preview').send({ channel: 'drone', items });
      expect([bad.status, bad.body.message]).toEqual([422, 'Elige domicilio, para llevar o en la mesa.']);
      const options = await http().post('/api/carta/rest-a/pricing-preview').send({ channel: 'delivery', items: [{ dishId: c.steak, quantity: 1 }] });
      expect([options.status, options.body.message]).toEqual([422, 'Revisa las opciones elegidas para el plato.']);
      const paused = await http().post('/api/carta/rest-a/pricing-preview').send({ channel: 'delivery', items: [{ dishId: c.off, quantity: 1 }] });
      expect([paused.status, paused.body.message]).toEqual([409, MESSAGES.soldOut]);
      const unknown = await http().post('/api/carta/nope/pricing-preview').send({ channel: 'delivery', items });
      expect([unknown.status, unknown.body]).toEqual([404, NOT_FOUND]);
    });

    it('30 a minute per IP, then the limiter 429', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 31; i++) codes.push((await http().post('/api/carta/rest-a/pricing-preview').send({})).status);
      expect(codes).toEqual([...Array(30).fill(422), 429]);
    });
  });

  describe('regressions from the independent verification', () => {
    it('X-Forwarded-For does not bypass the 3/min submit limit (S2)', async () => {
      nextMinute();
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await submit({}).set('X-Forwarded-For', `203.0.113.${i}`)).status);
      expect(codes).toEqual([422, 422, 422, 429]);
    });

    it('a cashier confirm leaves no half state; a foreign admin gets 404 (S2, S15)', async () => {
      const { requestId } = await pending();
      const orders = await db('SELECT count(*)::int AS n FROM orders');
      expect((await confirm(requestId, cashierCookie)).status).toBe(403);
      expect((await confirm(requestId, await login(fixtures.adminB.email))).status).toBe(404);
      expect((await db('SELECT status, decided_at, delivery_order_id FROM carta_delivery_requests WHERE id = $1', [requestId]))[0]).toEqual({
        status: 'pending',
        decided_at: null,
        delivery_order_id: null,
      });
      expect(await db('SELECT count(*)::int AS n FROM orders')).toEqual(orders);
    });

    it('the confirmed tracking body has only guest-safe keys (S2)', async () => {
      const phone = nextPhone();
      const { requestId, trackingToken } = await pending(body({ customer: { name: 'Zeta Privada', phone, address: 'Calle Secreta 123' }, notes: 'NotaPrivada' }));
      expect((await confirm(requestId)).status).toBe(200);
      const res = await status(trackingToken);
      expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'deliveryFee', 'lines', 'orderNumber', 'paymentMethod', 'rejectReason', 'stage', 'status', 'total']);
      for (const s of ['Zeta', phone, 'Secreta', 'NotaPrivada', c.operator.profileId, requestId]) expect(JSON.stringify(res.body)).not.toContain(s);
    });

    it('client restaurantId/status/deliveryFee/trackingToken are ignored (S2)', async () => {
      nextMinute();
      const res = await submit({ ...body(), restaurantId: fixtures.restaurantB, status: 'confirmed', deliveryFee: 0, trackingToken: 'AAAAAAAAAAAAAAAAAAAAAAAA' });
      expect(res.status).toBe(201);
      const [row] = await db<{ restaurant_id: string; status: string; tracking_token: string }>(
        'SELECT restaurant_id, status, tracking_token FROM carta_delivery_requests WHERE id = $1',
        [res.body.requestId],
      );
      expect(row).toMatchObject({ restaurant_id: fixtures.restaurantA, status: 'pending' });
      expect(row.tracking_token).not.toBe('AAAAAAAAAAAAAAAAAAAAAAAA');
    });

    it('three parallel confirms link one order (S15)', async () => {
      const { requestId } = await pending();
      expect((await Promise.all([confirm(requestId), confirm(requestId), confirm(requestId, adminCookie)])).map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    it('a carta order never renames an existing customer; the inbox shows the registered name (A3)', async () => {
      const phone = nextPhone();
      await db("INSERT INTO customers (name, phone, restaurant_id) VALUES ('Cliente Real', $1, $2)", [phone, fixtures.restaurantA]);
      const { requestId } = await pending(body({ customer: { name: 'Impostor', phone, address: 'Calle 10 # 5-20' } }));
      const inbox = await http().get('/api/carta-delivery').set('Cookie', operatorCookie);
      expect(inbox.body.find((r: { id: string }) => r.id === requestId)).toMatchObject({ customerName: 'Impostor', registeredName: 'Cliente Real' });
      expect((await confirm(requestId)).status).toBe(200);
      expect((await db('SELECT name FROM customers WHERE phone = $1 AND restaurant_id = $2', [phone, fixtures.restaurantA]))[0]).toEqual({ name: 'Cliente Real' });
      const [delivery] = await db<{ notes: string | null }>(
        'SELECT od.notes FROM order_deliveries od JOIN carta_delivery_requests r ON r.delivery_order_id = od.order_id WHERE r.id = $1',
        [requestId],
      );
      expect(delivery.notes).toContain('Nombre en la carta: Impostor.');
    });
  });

  async function seed() {
    const A = fixtures.restaurantA;
    const B = fixtures.restaurantB;
    const [{ password_hash: hash }] = await db<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [fixtures.waiterA.email]);
    for (const [user, role, name] of [
      [c.operator, 'delivery_operator', 'Domicilios A'],
      [c.cashier, 'cashier', 'Caja A'],
    ] as const) {
      await db(`INSERT INTO users (id, email, password_hash, password_algo, is_active) VALUES ($1, $2, $3, 'argon2id', true)`, [user.userId, user.email, hash]);
      await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
        user.profileId,
        user.userId,
        name,
        user.email,
        role,
        A,
      ]);
    }
    await db(`INSERT INTO carta_settings (restaurant_id, published, delivery_ordering_enabled) VALUES ($1, true, true), ($2, true, true)`, [A, B]);
    await db(`INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'delivery_default_fee', '5000')`, [A]);
    await db(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Platos', 'utensils', $2)`, [c.mains, A]);
    await db(
      `INSERT INTO dishes (id, name, price, category_id, active, restaurant_id) VALUES
         ($1, 'Ajiaco', 20000, $6, true, $7), ($2, 'Churrasco', 30000, $6, true, $7), ($3, 'Apagado', 1000, $6, false, $7),
         ($4, 'Jugo', 6000, $6, true, $7), ($5, 'Plato B', 9000, NULL, true, $8)`,
      [c.ajiaco, c.steak, c.off, c.juice, c.dishB, c.mains, A, B],
    );
    await db(
      `INSERT INTO promotions (id, name, discount_type, discount_value, start_date, active, restaurant_id) VALUES
         ($1, 'Mediodía', 'percentage', 10, '2026-01-01T00:00:00-05', true, $2)`,
      [c.promo, A],
    );
    await db('INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) VALUES ($1, $2, $3)', [c.promo, c.ajiaco, A]);
    await db(
      `INSERT INTO promotions (id, name, kind, discount_type, discount_value, min_subtotal, start_date, active, restaurant_id) VALUES
         ($1, 'Cuenta grande', 'bill_discount', 'percentage', 5, 50000, '2026-01-01T00:00:00-05', true, $2)`,
      [c.bill, A],
    );
    await db(`INSERT INTO modifier_groups (id, name, required, min_select, max_select, restaurant_id) VALUES ($1, 'Término', true, 1, 1, $2)`, [c.doneness, A]);
    await db(`INSERT INTO modifier_options (id, group_id, name, price, restaurant_id) VALUES ($1, $2, 'Bien asado', 2000, $3)`, [c.wellDone, c.doneness, A]);
    await db('INSERT INTO dish_modifier_groups (dish_id, group_id, restaurant_id) VALUES ($1, $2, $3)', [c.steak, c.doneness, A]);
  }
});
