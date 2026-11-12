import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** promociones T3 (S1–S6, S8): promotions CRUD, sending at list price, discounts, combos, voids, delivery, preview. */
const A = fixtures.restaurantA;
const ids = {
  cocteles: 'c3000000-0000-0000-0000-000000000001',
  platos: 'c3000000-0000-0000-0000-000000000002',
  margarita: 'd3000000-0000-0000-0000-000000000001',
  mojito: 'd3000000-0000-0000-0000-000000000002',
  sopa: 'd3000000-0000-0000-0000-000000000003',
  bandeja: 'd3000000-0000-0000-0000-000000000004',
  jugo: 'd3000000-0000-0000-0000-000000000005',
  crema: 'd3000000-0000-0000-0000-000000000006',
  adicion: 'e3000000-0000-0000-0000-000000000001',
  huevo: 'e3000000-0000-0000-0000-000000000002',
  tables: Array.from({ length: 40 }, (_, i) => `f3000000-0000-0000-0000-0000000000${String(i + 10)}`),
} as const;
const PINS: Record<string, string> = { [fixtures.adminA.profileId]: '9157', [fixtures.bcryptUser.profileId]: '582046' };

/** Tuesday 2026-11-10 at HH:MM in America/Bogota (UTC-5). */
const bogota = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 10, h + 5, m));
};

describe('promotions in orders (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const promo: Record<string, string> = {};
  let tableIndex = 0;

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(url).set('Cookie', cookies[email]),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookies[email]).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookies[email]).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookies[email]).send(body),
    };
  };
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const at = (hhmm: string) => vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota(hhmm));
  const line = (dishId: string, quantity: number, unitPrice?: number) => ({ dishId, quantity, ...(unitPrice === undefined ? {} : { unitPrice }) });
  const send = (body: object) => waiter().post('/api/orders', { tableId: ids.tables[tableIndex++], ...body });
  const discountsOf = (orderId: string) =>
    db<{ kind: string; label: string; amount: string; order_item_id: string | null; combo_id: string | null }>(
      'SELECT kind, label, amount::int::text AS amount, order_item_id, combo_id FROM order_discounts WHERE order_id = $1 ORDER BY kind, amount',
      [orderId],
    );
  const authorize = async (supervisor: string, orderId: string, caller = waiter(), action = 'void_item') => {
    const res = await caller.post('/api/auth/authorize', { pin: PINS[supervisor], action, profileId: supervisor, targetType: 'order', targetId: orderId });
    expect(res.status).toBe(201);
    return res.body.authorizationId as string;
  };
  const voidItems = async (orderId: string, items: { itemId: string; quantity: number }[]) =>
    waiter().post(`/api/orders/${orderId}/items/void`, {
      items,
      reason: 'waiter_error',
      authorizationId: await authorize(fixtures.adminA.profileId, orderId),
    });
  type Line = { id: string; dishId: string; promotionId: string | null; discounts: unknown[] };
  const itemOf = (order: { items: Line[] }, dishId: string) => order.items.find((item) => item.dishId === dishId)!;

  const createPromotion = async (body: object) => {
    const res = await admin().post('/api/catalog/promotions', { startDate: '2026-01-01', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string } & Record<string, unknown>;
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const [profileId, pin] of Object.entries(PINS)) {
      expect((await admin().put(`/api/staff/${profileId}/pin`, { pin })).status).toBe(204);
    }
    at('12:00');
    promo.hh = (
      await createPromotion({
        name: 'Happy hour 2x1',
        kind: 'buy_x_pay_y',
        buyQuantity: 2,
        payQuantity: 1,
        timeWindows: [{ from: '17:00', to: '19:00' }],
        channels: ['dine_in'],
        targets: { dishIds: [], categoryIds: [ids.cocteles], subcategoryIds: [] },
      })
    ).id;
    promo.menu = (
      await createPromotion({
        name: 'Menú ejecutivo',
        kind: 'combo',
        comboPrice: 24000,
        channels: ['dine_in'],
        comboGroups: [
          { name: 'Sopa', dishIds: [ids.sopa, ids.crema] },
          { name: 'Plato', dishIds: [ids.bandeja] },
          { name: 'Bebida', dishIds: [ids.jugo] },
        ],
      })
    ).id;
    promo.dom = (
      await createPromotion({
        name: '10% domicilio (tope $15.000)',
        kind: 'bill_discount',
        discountType: 'percentage',
        discountValue: 10,
        minSubtotal: 80000,
        maxDiscount: 15000,
        channels: ['delivery'],
      })
    ).id;
  });

  beforeEach(() => {
    at('18:00');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await database?.stop();
  });

  describe('promotions CRUD', () => {
    it('reads the full S1 shape with targets, groups, stats, schedule, sentence and badge', async () => {
      const res = await admin().get('/api/catalog/promotions');
      expect(res.status).toBe(200);
      const hh = res.body.find((p: { id: string }) => p.id === promo.hh);
      expect(hh).toMatchObject({
        kind: 'buy_x_pay_y',
        mode: 'automatic',
        buyQuantity: 2,
        payQuantity: 1,
        restDiscountPercent: 100,
        discountType: null,
        discountValue: null,
        comboPrice: null,
        comboGroups: [],
        endDate: null,
        daysOfWeek: [],
        timeWindows: [{ from: '17:00', to: '19:00' }],
        channels: ['dine_in'],
        maxUsesPerOrder: null,
        active: true,
        targets: { dishIds: [], categoryIds: [ids.cocteles], subcategoryIds: [] },
        schedule: { activeNow: true, reason: 'active', endsAt: '19:00', nextStartToday: null },
        sentence: 'Lleva 2 cócteles y paga 1; sale gratis el más económico.',
        badge: '2x1',
      });
      // Whatever the other tests sent: the stats are the stored 2x1 discounts of live orders and lines.
      const [stats] = await db<{ uses: number; amount: number }>(
        `SELECT count(DISTINCT od.order_id)::int AS uses, coalesce(sum(od.amount), 0)::int AS amount
           FROM order_discounts od JOIN orders o ON o.id = od.order_id LEFT JOIN order_items oi ON oi.id = od.order_item_id
          WHERE od.promotion_id = $1 AND o.status <> 'cancelled' AND (od.order_item_id IS NULL OR oi.status IS DISTINCT FROM 'cancelled')`,
        [promo.hh],
      );
      expect(hh.stats).toEqual({ usesLast30Days: stats.uses, discountLast30Days: stats.amount });
      // startDate YYYY-MM-DD is local midnight (Bogotá = 05:00Z).
      expect(hh.startDate).toBe('2026-01-01T05:00:00.000Z');
      const menu = res.body.find((p: { id: string }) => p.id === promo.menu);
      expect(menu.comboGroups.map((g: { name: string; dishIds: string[] }) => [g.name, g.dishIds])).toEqual([
        ['Sopa', [ids.sopa, ids.crema].sort()],
        ['Plato', [ids.bandeja]],
        ['Bebida', [ids.jugo]],
      ]);
      expect(menu).toMatchObject({ comboPrice: 24000, badge: 'Combo', sentence: '1 sopa + 1 plato + 1 bebida por $24.000.' });
      const dom = res.body.find((p: { id: string }) => p.id === promo.dom);
      expect(dom).toMatchObject({ minSubtotal: 80000, maxDiscount: 15000, badge: '10%', sentence: '10% en cuentas desde $80.000, con tope de $15.000.' });
    });

    it('answers 422 with a machine code per kind and stores nothing', async () => {
      const count = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM promotions'))[0].n;
      const before = await count();
      const cases: [object, string][] = [
        [{ name: 'X', kind: 'product_discount' }, 'discount_required'],
        [{ name: 'X', discountType: 'percentage', discountValue: 120 }, 'discount_percentage_range'],
        [{ name: 'X', kind: 'buy_x_pay_y', buyQuantity: 1, payQuantity: 1 }, 'buy_quantity_invalid'],
        [{ name: 'X', kind: 'buy_x_pay_y', buyQuantity: 2, payQuantity: 2 }, 'pay_quantity_invalid'],
        [{ name: 'X', kind: 'buy_x_pay_y', buyQuantity: 2, payQuantity: 1, restDiscountPercent: 0 }, 'rest_discount_invalid'],
        [{ name: 'X', kind: 'combo', comboPrice: 0, comboGroups: [{ name: 'A', dishIds: [ids.sopa] }] }, 'combo_price_invalid'],
        [{ name: 'X', kind: 'combo', comboPrice: 1000, comboGroups: [] }, 'combo_groups_count'],
        [{ name: 'X', kind: 'combo', comboPrice: 1000, comboGroups: [{ name: 'A', dishIds: [] }] }, 'combo_group_empty'],
        [{ name: 'X', kind: 'bill_discount', discountType: 'fixed_amount', discountValue: 1000, maxDiscount: 0 }, 'max_discount_invalid'],
        [{ name: 'X', discountType: 'percentage', discountValue: 10, timeWindows: [{ from: '19:00', to: '17:00' }] }, 'time_window_invalid'],
        [{ name: 'X', discountType: 'percentage', discountValue: 10, daysOfWeek: [8] }, 'days_of_week_invalid'],
        [{ name: 'X', discountType: 'percentage', discountValue: 10, channels: ['moon'] }, 'channels_invalid'],
        [{ name: 'X', discountType: 'percentage', discountValue: 10, maxUsesPerOrder: 0 }, 'max_uses_invalid'],
        [{ name: 'X', discountType: 'percentage', discountValue: 10, endDate: '2025-01-01' }, 'end_before_start'],
        [
          { name: 'X', discountType: 'percentage', discountValue: 10, targets: { dishIds: [ids.margarita, 'd3000000-0000-0000-0000-0000000000ff'], categoryIds: [], subcategoryIds: [] } },
          'unknown_target',
        ],
      ];
      for (const [body, code] of cases) {
        const res = await admin().post('/api/catalog/promotions', { startDate: '2026-01-01', ...body });
        expect([res.status, res.body.code], JSON.stringify(body)).toEqual([422, code]);
      }
      expect(await count()).toBe(before);
      expect(await db('SELECT 1 FROM promotion_dishes pd JOIN promotions p ON p.id = pd.promotion_id WHERE p.name = $1', ['X'])).toHaveLength(0);
    });

    it('validates a PATCH merged and keeps the row when rejected; the legacy form still works', async () => {
      const legacy = await createPromotion({ name: 'Legacy', discountType: 'fixed_amount', discountValue: 1500, endDate: '2026-12-31T23:59:59.000Z' });
      onTestFinished(async () => {
        await admin().patch(`/api/catalog/promotions/${legacy.id}`, { active: false });
      });
      expect(legacy).toMatchObject({ kind: 'product_discount', mode: 'automatic', badge: '-$1.500', endDate: '2026-12-31T23:59:59.000Z' });
      const bad = await admin().patch(`/api/catalog/promotions/${legacy.id}`, { kind: 'buy_x_pay_y' });
      expect([bad.status, bad.body.code]).toEqual([422, 'buy_quantity_invalid']);
      expect(await db('SELECT kind, discount_value::int AS v FROM promotions WHERE id = $1', [legacy.id])).toEqual([{ kind: 'product_discount', v: 1500 }]);
      expect((await admin().put(`/api/catalog/promotions/${legacy.id}/dishes`, { dishIds: [ids.jugo] })).status).toBe(200);
      const paused = await admin().patch(`/api/catalog/promotions/${legacy.id}`, { active: false });
      expect(paused.body).toMatchObject({ active: false, targets: { dishIds: [ids.jugo] }, schedule: { reason: 'paused' } });
      expect((await waiter().post('/api/catalog/promotions', { name: 'W', discountType: 'percentage', discountValue: 5 })).status).toBe(403);
    });
  });

  describe('GET /catalog/promotions/today', () => {
    it('groups by now, later today and the others for a channel', async () => {
      const monday = await createPromotion({ name: 'Lunes', discountType: 'percentage', discountValue: 5, daysOfWeek: [1] });
      const paused = await createPromotion({ name: 'Pausada', discountType: 'percentage', discountValue: 5 });
      onTestFinished(async () => {
        await admin().patch(`/api/catalog/promotions/${monday.id}`, { active: false });
      });
      expect((await admin().patch(`/api/catalog/promotions/${paused.id}`, { active: false })).status).toBe(200);
      at('16:00');
      const before = await waiter().get('/api/catalog/promotions/today');
      expect(before.status).toBe(200);
      expect(before.body).toMatchObject({ localTime: '16:00', channel: 'dine_in' });
      expect(before.body.laterToday.map((x: { promotion: { id: string }; startsAt: string; sentence: string }) => [x.promotion.id, x.startsAt, x.sentence])).toEqual([
        [promo.hh, '17:00', 'Lleva 2 cócteles y paga 1; sale gratis el más económico.'],
      ]);
      at('18:00');
      const now = await waiter().get('/api/catalog/promotions/today?channel=dine_in');
      // Only the promotions seeded in beforeAll: another test's promotion never changes this list.
      const seeded = new Set(Object.values(promo));
      const active = now.body.active.filter((x: { promotion: { id: string } }) => seeded.has(x.promotion.id)).map((x: { promotion: { id: string }; endsAt: string | null; minutesLeft: number | null; badge: string }) => [x.promotion.id, x.endsAt, x.minutesLeft, x.badge]);
      expect(active).toEqual([
        [promo.hh, '19:00', 60, '2x1'],
        [promo.menu, null, null, 'Combo'],
      ]);
      const others = new Map(now.body.others.map((x: { promotion: { id: string }; reason: string }) => [x.promotion.id, x.reason]));
      expect(others.get(promo.dom)).toBe('other_channel');
      expect(others.get(monday.id)).toBe('other_day');
      // Paused promotions are not offered.
      expect(JSON.stringify(now.body)).not.toContain(paused.id);
      const delivery = await waiter().get('/api/catalog/promotions/today?channel=delivery');
      expect(delivery.body.active.map((x: { promotion: { id: string } }) => x.promotion.id)).toContain(promo.dom);
      expect((await waiter().get('/api/catalog/promotions/today?channel=moon')).status).toBe(422);
    });
  });

  describe('dishes with pricing=promotions', () => {
    it('keep the list price and carry the promotion a line would get now', async () => {
      const res = await waiter().get('/api/catalog/dishes?pricing=promotions');
      const mojito = res.body.find((dish: { id: string }) => dish.id === ids.mojito);
      expect(mojito).toMatchObject({ price: 24000, promotionId: promo.hh, promotionName: 'Happy hour 2x1', promotionBadge: '2x1', promotionEndsAt: '19:00' });
      expect(mojito).not.toHaveProperty('promoPrice');
      expect(mojito).not.toHaveProperty('originalPrice');
      at('20:00');
      const later = await waiter().get('/api/catalog/dishes?pricing=promotions');
      expect(later.body.find((dish: { id: string }) => dish.id === ids.mojito)).not.toHaveProperty('promotionId');
    });
  });

  describe('sending', () => {
    it('stores the list price and answers 409 when unitPrice is not the list price', async () => {
      const conflict = await send({ items: [line(ids.mojito, 1, 12000)] });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ message: 'Price changed', prices: [{ dishId: ids.mojito, price: 24000 }] });
      const ok = await send({ items: [line(ids.mojito, 1, 24000)] });
      expect(ok.status).toBe(201);
      expect(ok.body.items[0]).toMatchObject({ price: 24000, promotionId: promo.hh, promotionName: 'Happy hour 2x1', comboId: null, discounts: [] });
    });

    it('2x1: Margarita + Mojito → Mojito −24.000, net subtotal', async () => {
      const res = await send({ items: [line(ids.margarita, 1, 26000), line(ids.mojito, 1, 24000)] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ grossSubtotal: 50000, totalDiscounts: 24000, subtotal: 26000 });
      expect(res.body.total).toBe(res.body.subtotal + res.body.tax + res.body.tip);
      const mojito = itemOf(res.body, ids.mojito);
      expect(mojito.discounts).toEqual([
        expect.objectContaining({ kind: 'promotion_item', source: 'automatic', label: 'Happy hour 2x1', amount: 24000, promotionId: promo.hh, orderItemId: mojito.id, reason: null, authorizedBy: null }),
      ]);
      expect(res.body.discounts).toHaveLength(1);
      expect(itemOf(res.body, ids.margarita).discounts).toEqual([]);
      // The mapper's grossSubtotal (subtotal + total_discounts) equals the lines at list price, and totalDiscounts the order_discounts rows.
      const [stored] = await db<{ gross: number; discounts: number }>(
        `SELECT (SELECT sum(price * quantity)::int FROM order_items WHERE order_id = $1) AS gross,
                (SELECT sum(amount)::int FROM order_discounts WHERE order_id = $1) AS discounts`,
        [res.body.id],
      );
      expect({ grossSubtotal: res.body.grossSubtotal, totalDiscounts: res.body.totalDiscounts }).toEqual({ grossSubtotal: stored.gross, totalDiscounts: stored.discounts });
    });

    it('fixes the promotion at send: later items get none and pausing changes nothing sent', async () => {
      const first = await send({ items: [line(ids.mojito, 2, 24000)] });
      expect(first.body.totalDiscounts).toBe(24000);
      at('19:30');
      const later = await waiter().post(`/api/orders/${first.body.id}/items`, { items: [line(ids.margarita, 1, 26000)] });
      expect(later.status).toBe(201);
      expect(itemOf(later.body, ids.margarita).promotionId).toBeNull();
      expect(later.body).toMatchObject({ grossSubtotal: 74000, totalDiscounts: 24000, subtotal: 50000 });
      expect(later.body.items.filter((item: { promotionId: string | null }) => item.promotionId === promo.hh)).toHaveLength(1);
      expect((await admin().patch(`/api/catalog/promotions/${promo.hh}`, { active: false })).status).toBe(200);
      try {
        const again = await waiter().post(`/api/orders/${first.body.id}/items`, { items: [line(ids.jugo, 1, 7000)] });
        expect(again.body).toMatchObject({ grossSubtotal: 81000, totalDiscounts: 24000 });
      } finally {
        await admin().patch(`/api/catalog/promotions/${promo.hh}`, { active: true });
      }
    });

    it('S6: voiding 1 of 2 Mojitos sent with a Margarita keeps −24.000', async () => {
      const res = await send({ items: [line(ids.mojito, 2, 24000), line(ids.margarita, 1, 26000)] });
      // Pairs by price: Margarita + Mojito (Mojito free), Mojito alone.
      expect(res.body).toMatchObject({ grossSubtotal: 74000, totalDiscounts: 24000 });
      const voided = await voidItems(res.body.id, [{ itemId: itemOf(res.body, ids.mojito).id, quantity: 1 }]);
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(voided.body).toMatchObject({ grossSubtotal: 50000, totalDiscounts: 24000, subtotal: 26000 });
      const voidAgain = await voidItems(res.body.id, [{ itemId: itemOf(res.body, ids.mojito).id, quantity: 1 }]);
      expect(voidAgain.body).toMatchObject({ grossSubtotal: 26000, totalDiscounts: 0, discounts: [] });
      expect(await discountsOf(res.body.id)).toEqual([]);
    });
  });

  describe('combos', () => {
    const combo = (soup: string = ids.sopa) => ({
      comboPromotionId: promo.menu,
      choices: [
        { groupId: '', dishId: soup },
        { groupId: '', dishId: ids.bandeja },
        { groupId: '', dishId: ids.jugo },
      ],
    });
    let groups: string[] = [];
    const withGroups = (c: ReturnType<typeof combo>) => ({ ...c, choices: c.choices.map((choice, i) => ({ ...choice, groupId: groups[i] })) });

    beforeAll(async () => {
      const res = await admin().get('/api/catalog/promotions');
      groups = res.body.find((p: { id: string }) => p.id === promo.menu).comboGroups.map((g: { id: string }) => g.id);
    });

    it('creates 3 component lines and one combo discount −9.000', async () => {
      const res = await send({ combos: [withGroups(combo())] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.items.map((item: { name: string; price: number; promotionId: string }) => [item.name, item.price, item.promotionId])).toEqual([
        ['Sopa', 9000, promo.menu],
        ['Bandeja', 17000, promo.menu],
        ['Jugo', 7000, promo.menu],
      ]);
      const comboIds = new Set(res.body.items.map((item: { comboId: string }) => item.comboId));
      expect(comboIds.size).toBe(1);
      expect(res.body).toMatchObject({ grossSubtotal: 33000, totalDiscounts: 9000, subtotal: 24000 });
      expect(res.body.discounts).toEqual([expect.objectContaining({ kind: 'combo', label: 'Menú ejecutivo', amount: 9000, comboId: [...comboIds][0] })]);
    });

    it('answers 422 with the engine code and stores nothing for an invalid choice', async () => {
      const orders = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM orders'))[0].n;
      const before = await orders();
      const wrong = withGroups(combo());
      wrong.choices[0].dishId = ids.margarita;
      const res = await send({ combos: [wrong] });
      expect([res.status, res.body.code]).toEqual([422, 'combo_choice_invalid']);
      const missing = withGroups(combo());
      missing.choices.pop();
      expect((await send({ combos: [missing] })).body.code).toBe('combo_group_missing');
      const unknown = { ...withGroups(combo()), comboPromotionId: promo.hh };
      expect((await send({ combos: [unknown] })).body.code).toBe('combo_unknown');
      vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(Date.UTC(2025, 0, 1)));
      expect((await send({ combos: [withGroups(combo())] })).body.code).toBe('combo_inactive');
      expect(await orders()).toBe(before);
    });

    it('voiding one component voids the whole combo', async () => {
      const res = await send({ items: [line(ids.margarita, 1, 26000)], combos: [withGroups(combo(ids.crema))] });
      expect(res.status).toBe(201);
      const voided = await voidItems(res.body.id, [{ itemId: itemOf(res.body, ids.bandeja).id, quantity: 1 }]);
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(voided.body.items.map((item: { name: string }) => item.name)).toEqual(['Margarita']);
      expect(voided.body).toMatchObject({ grossSubtotal: 26000, totalDiscounts: 0 });
      expect(await db('SELECT status FROM order_items WHERE order_id = $1 AND combo_id IS NOT NULL', [res.body.id])).toEqual([
        { status: 'cancelled' },
        { status: 'cancelled' },
        { status: 'cancelled' },
      ]);
    });

    it('charges the options of a component on top of the combo price', async () => {
      const withEgg = withGroups(combo());
      const choices = withEgg.choices.map((choice) => (choice.dishId === ids.bandeja ? { ...choice, modifiers: [{ optionId: ids.huevo }] } : choice));
      const res = await send({ combos: [{ ...withEgg, choices }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(itemOf(res.body, ids.bandeja)).toMatchObject({ price: 20000, modifiers: [expect.objectContaining({ name: 'Huevo', price: 3000 })] });
      // Combo discount = 9.000 + 17.000 + 7.000 (list prices without options) − 24.000; the egg is paid on top.
      expect(res.body).toMatchObject({ grossSubtotal: 36000, totalDiscounts: 9000, subtotal: 27000 });
      expect(res.body.discounts).toEqual([expect.objectContaining({ kind: 'combo', amount: 9000 })]);
      // A recompute (another line added later) keeps the same rule.
      const more = await waiter().post(`/api/orders/${res.body.id}/items`, { items: [line(ids.jugo, 1, 7000)] });
      expect(more.body).toMatchObject({ grossSubtotal: 43000, totalDiscounts: 9000, subtotal: 34000 });
    });

    it('adds a combo to an open order with POST /orders/:id/items', async () => {
      const first = await send({ items: [line(ids.margarita, 1, 26000)] });
      expect(first.status).toBe(201);
      const res = await waiter().post(`/api/orders/${first.body.id}/items`, { combos: [withGroups(combo(ids.crema))] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.items.map((item: { name: string; promotionId: string | null }) => [item.name, item.promotionId])).toEqual([
        ['Margarita', promo.hh],
        ['Crema', promo.menu],
        ['Bandeja', promo.menu],
        ['Jugo', promo.menu],
      ]);
      const comboIds = new Set(res.body.items.filter((item: { comboId: string | null }) => item.comboId).map((item: { comboId: string }) => item.comboId));
      expect(comboIds.size).toBe(1);
      expect(res.body).toMatchObject({ status: 'kitchen', grossSubtotal: 59000, totalDiscounts: 9000, subtotal: 50000 });
      expect(res.body.discounts).toEqual([expect.objectContaining({ kind: 'combo', amount: 9000, comboId: [...comboIds][0] })]);
    });

    it('answers 422 with a Spanish message when an order brings no lines', async () => {
      const empty = await send({});
      expect(empty.status).toBe(422);
      expect([empty.body.message].flat()).toEqual(['Agrega al menos un producto o un combo (máximo 100 líneas)']);
      const order = await send({ items: [line(ids.jugo, 1, 7000)] });
      const add = await waiter().post(`/api/orders/${order.body.id}/items`, { items: [], combos: [] });
      expect(add.status).toBe(422);
      expect([add.body.message].flat()).toEqual(['Agrega al menos un producto o un combo (máximo 100 líneas)']);
    });

    it('previews a combo line: one draft line per choice and the combo discount on the first', async () => {
      const res = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: [line(ids.mojito, 1), withGroups(combo())] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        res.body.lines.map((l: { name: string; draftIndex: number; comboId: string | null; unitPrice: number; discounts: { kind: string; amount: number }[] }) => [
          l.name,
          l.draftIndex,
          l.comboId,
          l.unitPrice,
          l.discounts.map((d) => [d.kind, d.amount]),
        ]),
      ).toEqual([
        ['Mojito', 0, null, 24000, []],
        ['Sopa', 1, 'draft-combo-0', 9000, [['combo', 9000]]],
        ['Bandeja', 1, 'draft-combo-0', 17000, []],
        ['Jugo', 1, 'draft-combo-0', 7000, []],
      ]);
      expect(res.body).toMatchObject({ grossSubtotal: 57000, totalDiscounts: 9000, netSubtotal: 48000 });
    });

    it('caps the preview at 20 combo lines and 6 choices per combo', async () => {
      const tooMany = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: Array.from({ length: 21 }, () => withGroups(combo())) });
      expect(tooMany.status).toBe(422);
      expect([tooMany.body.message].flat()).toEqual(['lines: Máximo 20 combos por consulta']);
      const twenty = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: Array.from({ length: 20 }, () => withGroups(combo())) });
      expect(twenty.status, JSON.stringify(twenty.body)).toBe(200);
      expect(twenty.body.lines).toHaveLength(60);
      const sevenChoices = withGroups(combo());
      const wide = { ...sevenChoices, choices: [...sevenChoices.choices, ...sevenChoices.choices, sevenChoices.choices[0]] };
      expect((await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: [wide] })).status).toBe(422);
    });
  });

  describe('delivery bill discount', () => {
    const deliver = (items: { dishId: string; quantity: number }[]) =>
      admin().post('/api/delivery/orders', {
        customer: { phone: '3001234567', name: 'Ana' },
        address: { addressLine: 'Calle 1', neighborhood: null, reference: null, label: null, save: false },
        items,
        deliveryFee: 0,
        paymentMode: 'cash_on_delivery',
        cashChangeFor: null,
        notes: null,
      });
    const bill = (orderId: string) =>
      db<{ subtotal: number; total_discounts: number }>('SELECT subtotal::int, total_discounts::int FROM orders WHERE id = $1', [orderId]);

    it('applies from the minimum, capped, and is removed when a void drops below', async () => {
      const small = await deliver([{ dishId: ids.margarita, quantity: 3 }]);
      expect(small.status, JSON.stringify(small.body)).toBe(201);
      expect(await bill(small.body.orderId)).toEqual([{ subtotal: 78000, total_discounts: 0 }]);

      const four = await deliver([{ dishId: ids.margarita, quantity: 4 }]);
      expect(await bill(four.body.orderId)).toEqual([{ subtotal: 93600, total_discounts: 10400 }]);
      // The 2x1 is dine_in only: delivery lines carry no product promotion.
      expect(await db('SELECT promotion_id FROM order_items WHERE order_id = $1', [four.body.orderId])).toEqual([{ promotion_id: null }]);

      const big = await deliver([{ dishId: ids.margarita, quantity: 7 }]);
      expect(await bill(big.body.orderId)).toEqual([{ subtotal: 167000, total_discounts: 15000 }]);
      expect(await discountsOf(big.body.orderId)).toEqual([
        { kind: 'promotion_bill', label: '10% domicilio (tope $15.000)', amount: '15000', order_item_id: null, combo_id: null },
      ]);

      const [item] = await db<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1', [four.body.orderId]);
      const authorizationId = await authorize(fixtures.bcryptUser.profileId, four.body.orderId, admin());
      const voided = await admin().post(`/api/orders/${four.body.orderId}/items/void`, {
        items: [{ itemId: item.id, quantity: 1 }],
        reason: 'waiter_error',
        authorizationId,
      });
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(voided.body).toMatchObject({ grossSubtotal: 78000, totalDiscounts: 0, subtotal: 78000, discounts: [] });
    });
  });

  describe('POST /orders/pricing-preview', () => {
    it('prices the order plus the drafts as if sent now and hints the missing unit', async () => {
      const sent = await send({ items: [line(ids.margarita, 1, 26000)] });
      const res = await waiter().post('/api/orders/pricing-preview', {
        channel: 'dine_in',
        orderId: sent.body.id,
        lines: [line(ids.mojito, 2)],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.lines.map((l: { sent: boolean; name: string; promotionId: string | null; discounts: { amount: number }[] }) => [l.sent, l.name, l.promotionId, l.discounts.map((d) => d.amount)])).toEqual([
        [true, 'Margarita', promo.hh, []],
        [false, 'Mojito', promo.hh, [24000]],
      ]);
      expect(res.body).toMatchObject({ channel: 'dine_in', grossSubtotal: 74000, totalDiscounts: 24000, netSubtotal: 50000, billDiscount: null });
      expect(res.body.hints).toEqual([{ kind: 'missing_units', promotionId: promo.hh, missing: 1, message: 'Falta 1 unidad para otro 2x1.' }]);
      // Nothing was written.
      expect(await db('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1', [sent.body.id])).toEqual([{ n: 1 }]);
      expect(await discountsOf(sent.body.id)).toEqual([]);
    });

    it('warns when the window ends within 10 minutes and shows the delivery minimum', async () => {
      at('18:55');
      const ending = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: [line(ids.mojito, 2)] });
      expect(ending.body.hints).toContainEqual({ kind: 'window_ending', promotionId: promo.hh, minutesLeft: 5, message: 'Envía antes de las 19:00.' });
      const delivery = await waiter().post('/api/orders/pricing-preview', { channel: 'delivery', lines: [line(ids.margarita, 2)] });
      expect(delivery.body.hints).toEqual([
        { kind: 'bill_minimum', promotionId: promo.dom, missing: 28000, message: 'Domicilio: faltan $28.000 para el 10% de descuento.' },
      ]);
      const combo = await waiter().post('/api/orders/pricing-preview', { channel: 'delivery', lines: [{ comboPromotionId: promo.menu, choices: [] }] });
      expect(combo.status).toBe(422);
    });

    it("uses the order's own channel when orderId is given (the body channel is ignored)", async () => {
      const delivery = await admin().post('/api/delivery/orders', {
        customer: { phone: '3007654321', name: 'Beto' },
        address: { addressLine: 'Calle 2', neighborhood: null, reference: null, label: null, save: false },
        items: [{ dishId: ids.margarita, quantity: 4 }],
        deliveryFee: 5000,
        paymentMode: 'cash_on_delivery',
        cashChangeFor: null,
        notes: null,
      });
      expect(delivery.status, JSON.stringify(delivery.body)).toBe(201);
      const res = await admin().post('/api/orders/pricing-preview', { channel: 'dine_in', orderId: delivery.body.orderId, lines: [line(ids.mojito, 1)] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Delivery: the 2x1 (dine_in only) is not offered on the Mojito, the 10% delivery bill discount applies.
      expect(res.body).toMatchObject({ channel: 'delivery', grossSubtotal: 128000, billDiscount: { kind: 'promotion_bill', promotionId: promo.dom, amount: 12800 } });
      expect(res.body.lines.find((l: { sent: boolean }) => !l.sent)).toMatchObject({ name: 'Mojito', promotionId: null, discounts: [] });
      // total is Order.total (no fee); the fee comes apart, as pay_order adds it.
      expect(res.body).toMatchObject({ netSubtotal: 115200, deliveryFee: 5000 });
      expect(res.body.total).toBe(res.body.netSubtotal + res.body.tax + res.body.tip);
      const stored = await admin().post('/api/orders/pricing-preview', { channel: 'dine_in', orderId: delivery.body.orderId, lines: [] });
      const order = await admin().get(`/api/orders/${delivery.body.orderId}`);
      expect([stored.body.netSubtotal, stored.body.tax, stored.body.tip, stored.body.total]).toEqual([order.body.subtotal, order.body.tax, order.body.tip, order.body.total]);
      // A waiter cannot read order_deliveries (RLS): the fee is unknown, not 0.
      const asWaiter = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', orderId: delivery.body.orderId, lines: [] });
      expect(asWaiter.body).toMatchObject({ channel: 'delivery', deliveryFee: null, total: stored.body.total });
      const plain = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: [line(ids.mojito, 1)] });
      expect(plain.body.lines[0]).toMatchObject({ promotionId: promo.hh });
      expect(plain.body).toMatchObject({ tax: null, tip: null, total: null, deliveryFee: null });
    });

    it('rejects unknown fields on draft lines and on combo choices with 422', async () => {
      const preview = (lines: object[]) => waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines });
      expect((await preview([{ ...line(ids.mojito, 1), unitPrice: 1 }])).status).toBe(422);
      expect((await preview([{ ...line(ids.mojito, 1), comments: 'sin hielo' }])).status).toBe(422);
      expect((await preview([{ ...line(ids.mojito, 1), extra: true }])).status).toBe(422);
      expect((await preview([{ comboPromotionId: promo.menu, choices: [{ groupId: ids.sopa, dishId: ids.sopa }], extra: true }])).status).toBe(422);
      expect((await preview([line(ids.mojito, 1)])).status).toBe(200);
    });
  });

  describe('POST /orders/pricing-preview with voids (S1)', () => {
    const preview = (orderId: string | undefined, voids: { orderItemId: string; quantity: number }[], lines: object[] = []) =>
      waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', ...(orderId ? { orderId } : {}), lines, voids });
    type Bill = { grossSubtotal: number; totalDiscounts: number; subtotal: number; tax: number; tip: number; total: number };
    type PreviewBody = { grossSubtotal: number; totalDiscounts: number; netSubtotal: number; tax: number; tip: number; total: number };
    const previewBill = (body: PreviewBody): Bill => ({
      grossSubtotal: body.grossSubtotal,
      totalDiscounts: body.totalDiscounts,
      subtotal: body.netSubtotal,
      tax: body.tax,
      tip: body.tip,
      total: body.total,
    });
    const orderBill = (body: Bill): Bill => ({
      grossSubtotal: body.grossSubtotal,
      totalDiscounts: body.totalDiscounts,
      subtotal: body.subtotal,
      tax: body.tax,
      tip: body.tip,
      total: body.total,
    });
    const previewLines = (body: { lines: { orderItemId: string; quantity: number; discounts: { kind: string; amount: number }[] }[] }) =>
      body.lines.map((l) => [l.orderItemId, l.quantity, l.discounts.map((d) => [d.kind, d.amount])]);
    const orderLines = (body: { items: { id: string; quantity: number; discounts: { kind: string; amount: number }[] }[] }) =>
      body.items.map((item) => [item.id, item.quantity, item.discounts.map((d) => [d.kind, d.amount])]);
    let menu: object;

    beforeAll(async () => {
      const groups = (await admin().get('/api/catalog/promotions')).body.find((p: { id: string }) => p.id === promo.menu).comboGroups.map((g: { id: string }) => g.id);
      menu = { comboPromotionId: promo.menu, choices: [ids.sopa, ids.bandeja, ids.jugo].map((dishId, i) => ({ groupId: groups[i], dishId })) };
    });
    const snapshot = async (orderId: string) => ({
      items: await db('SELECT id, quantity, status FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]),
      discounts: await db('SELECT id, kind, amount::int AS amount, line_quantity FROM order_discounts WHERE order_id = $1 ORDER BY id', [orderId]),
      bill: await db('SELECT subtotal::int, total_discounts::int, tax::int, tip::int, total::int FROM orders WHERE id = $1', [orderId]),
    });

    it('2 Mojitos + Margarita, void 1 Mojito: the preview equals the order after the real void, and writes nothing', async () => {
      const order = await send({ items: [line(ids.mojito, 2, 24000), line(ids.margarita, 1, 26000)] });
      expect(order.status).toBe(201);
      const mojito = itemOf(order.body, ids.mojito).id;
      const before = await snapshot(order.body.id);
      const res = await preview(order.body.id, [{ orderItemId: mojito, quantity: 1 }]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ grossSubtotal: 50000, totalDiscounts: 24000, netSubtotal: 26000 });
      expect(res.body.total).toBe(res.body.netSubtotal + res.body.tax + res.body.tip);
      expect(res.body.deliveryFee).toBe(0);
      expect(await snapshot(order.body.id)).toEqual(before);

      const voided = await voidItems(order.body.id, [{ itemId: mojito, quantity: 1 }]);
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(previewBill(res.body)).toEqual(orderBill(voided.body));
      expect(previewLines(res.body)).toEqual(orderLines(voided.body));
    });

    it('voiding a combo component previews the whole combo voided, like the void endpoint', async () => {
      const order = await send({ items: [line(ids.margarita, 1, 26000)], combos: [menu] });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      const res = await preview(order.body.id, [{ orderItemId: itemOf(order.body, ids.jugo).id, quantity: 1 }]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.lines.map((l: { name: string }) => l.name)).toEqual(['Margarita']);
      expect(res.body).toMatchObject({ grossSubtotal: 26000, totalDiscounts: 0, netSubtotal: 26000 });
      const voided = await voidItems(order.body.id, [{ itemId: itemOf(order.body, ids.jugo).id, quantity: 1 }]);
      expect(previewBill(res.body)).toEqual(orderBill(voided.body));
      expect(previewLines(res.body)).toEqual(orderLines(voided.body));
    });

    it('rescales a manual line discount to the units left, as the recompute does', async () => {
      const order = await send({ items: [line(ids.bandeja, 2, 17000), line(ids.jugo, 1, 7000)] });
      const bandeja = itemOf(order.body, ids.bandeja).id;
      const authorizationId = await authorize(fixtures.bcryptUser.profileId, order.body.id, admin(), 'apply_discount');
      const discount = await admin().post(`/api/orders/${order.body.id}/discounts`, {
        orderItemId: bandeja,
        discountType: 'fixed_amount',
        discountValue: 10000,
        reason: 'Demora en cocina',
        authorizationId,
      });
      expect(discount.status, JSON.stringify(discount.body)).toBe(201);
      const res = await preview(order.body.id, [{ orderItemId: bandeja, quantity: 1 }]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.lines.find((l: { orderItemId: string }) => l.orderItemId === bandeja)).toMatchObject({
        quantity: 1,
        discounts: [expect.objectContaining({ kind: 'manual_item', amount: 5000 })],
      });
      expect(res.body).toMatchObject({ grossSubtotal: 24000, totalDiscounts: 5000, netSubtotal: 19000 });
      const voided = await voidItems(order.body.id, [{ itemId: bandeja, quantity: 1 }]);
      expect(previewBill(res.body)).toEqual(orderBill(voided.body));
      expect(previewLines(res.body)).toEqual(orderLines(voided.body));
    });

    it('prices drafts together with the voids', async () => {
      const order = await send({ items: [line(ids.mojito, 2, 24000)] });
      const res = await preview(order.body.id, [{ orderItemId: itemOf(order.body, ids.mojito).id, quantity: 1 }], [line(ids.margarita, 1)]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // One Mojito left plus a draft Margarita: the 2x1 pairs them again.
      expect(res.body).toMatchObject({ grossSubtotal: 50000, totalDiscounts: 24000, netSubtotal: 26000 });
    });

    it('answers 422 with a machine code for an invalid void and writes nothing', async () => {
      const order = await send({ items: [line(ids.mojito, 2, 24000)] });
      const other = await send({ items: [line(ids.jugo, 1, 7000)] });
      const mojito = itemOf(order.body, ids.mojito).id;
      const before = await snapshot(order.body.id);
      const cases: [string | undefined, { orderItemId: string; quantity: number }[], string][] = [
        [undefined, [{ orderItemId: mojito, quantity: 1 }], 'void_order_required'],
        [order.body.id, [{ orderItemId: itemOf(other.body, ids.jugo).id, quantity: 1 }], 'void_item_unknown'],
        [order.body.id, [{ orderItemId: 'd3000000-0000-0000-0000-0000000000ff', quantity: 1 }], 'void_item_unknown'],
        [order.body.id, [{ orderItemId: mojito, quantity: 3 }], 'void_quantity_invalid'],
      ];
      for (const [orderId, voids, code] of cases) {
        const res = await preview(orderId, voids);
        expect([res.status, res.body.code], code).toEqual([422, code]);
      }
      expect((await preview(order.body.id, [{ orderItemId: mojito, quantity: 0 }])).status).toBe(422);
      expect((await preview(order.body.id, [{ orderItemId: mojito, quantity: 1 }, { orderItemId: mojito, quantity: 1 }])).status).toBe(422);
      expect((await preview(order.body.id, [{ orderItemId: mojito, quantity: 1, extra: 1 } as never])).status).toBe(422);
      // A fully voided line can no longer be voided.
      expect((await voidItems(order.body.id, [{ itemId: mojito, quantity: 2 }])).status).toBe(200);
      const gone = await preview(order.body.id, [{ orderItemId: mojito, quantity: 1 }]);
      expect([gone.status, gone.body.code]).toEqual([422, 'void_item_unknown']);
      expect((await snapshot(order.body.id)).discounts).toEqual([]);
      expect(before.items).toHaveLength(1);
    });
  });
});

async function seed(superuserUrl: string) {
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Cócteles', 'wine', $3), ($2, 'Platos', 'soup', $3)`, [ids.cocteles, ids.platos, A]);
  await q(
    `INSERT INTO dishes (id, name, price, active, category_id, restaurant_id) VALUES
       ($1, 'Margarita', 26000, true, $7, $9), ($2, 'Mojito', 24000, true, $7, $9),
       ($3, 'Sopa', 9000, true, $8, $9), ($4, 'Bandeja', 17000, true, $8, $9), ($5, 'Jugo', 7000, true, $8, $9),
       ($6, 'Crema', 9000, true, $8, $9)`,
    [ids.margarita, ids.mojito, ids.sopa, ids.bandeja, ids.jugo, ids.crema, ids.cocteles, ids.platos, A],
  );
  for (const [index, id] of ids.tables.entries()) {
    await q(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, $2, 'available', $3)`, [id, 300 + index, A]);
  }
  // An optional priced option of the Bandeja (S3: options of a combo component are charged on top).
  await q(`INSERT INTO modifier_groups (id, name, required, min_select, max_select, sort_order, is_active, restaurant_id) VALUES ($1, 'Adición', false, 0, 1, 0, true, $2)`, [ids.adicion, A]);
  await q(`INSERT INTO modifier_options (id, group_id, name, price, sort_order, is_active, restaurant_id) VALUES ($1, $2, 'Huevo', 3000, 0, true, $3)`, [ids.huevo, ids.adicion, A]);
  await q(`INSERT INTO dish_modifier_groups (dish_id, group_id, sort_order, restaurant_id) VALUES ($1, $2, 0, $3)`, [ids.bandeja, ids.adicion, A]);
}
