import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const s = {
  arepa: '77000000-0000-0000-0000-000000000001',
  jugo: '77000000-0000-0000-0000-000000000002',
  torta: '77000000-0000-0000-0000-000000000003',
  dishB: '77000000-0000-0000-0000-0000000000b1',
  order: '77000000-0000-0000-0000-000000000011',
  orderItem: '77000000-0000-0000-0000-000000000012',
  itemB: '77000000-0000-0000-0000-0000000000b2',
  supplierB: '77000000-0000-0000-0000-0000000000b3',
} as const;

const ITEM_KEYS = [
  'barcode', 'categoryId', 'categoryName', 'cost', 'defaultSupplierId', 'description', 'id', 'isActive', 'kind', 'maxStock',
  'minStock', 'name', 'purchaseFactor', 'purchaseUnit', 'shelfLifeDays', 'sku', 'stock', 'trackLots', 'unit',
];
const LOT_KEYS = ['expiresOn', 'id', 'itemId', 'locationId', 'locationName', 'lotCode', 'quantity', 'receivedAt', 'unitCost'];
const MOVEMENT_KEYS = [
  'createdAt', 'createdBy', 'id', 'itemId', 'itemName', 'locationId', 'locationName', 'lotId', 'movementType', 'notes',
  'quantity', 'reason', 'referenceId', 'referenceType', 'sku', 'totalCost', 'unit', 'unitCost',
];
const PO_KEYS = [
  'createdAt', 'expectedOn', 'id', 'lines', 'locationId', 'locationName', 'notes', 'number', 'orderedAt', 'paymentStatus',
  'receivedAt', 'status', 'supplierId', 'supplierName', 'total',
];
const PO_LINE_KEYS = ['id', 'itemId', 'itemName', 'pendingQuantity', 'quantity', 'receivedQuantity', 'sku', 'total', 'unit', 'unitCost'];
const COUNT_KEYS = ['appliedAt', 'createdAt', 'id', 'locationId', 'locationName', 'notes', 'number', 'status'];
const COUNT_LINE_KEYS = ['countedQuantity', 'expectedQuantity', 'id', 'itemId', 'itemName', 'notes', 'sku', 'unit'];
const BATCH_KEYS = [
  'createdAt', 'expiresOn', 'id', 'itemId', 'itemName', 'locationId', 'locationName', 'lotCode', 'lotId', 'notes', 'quantity',
  'totalCost', 'unit', 'unitCost',
];
const FORMULA_KEYS = ['lines', 'notes', 'recipeId', 'targetId', 'targetType', 'unitCost', 'yieldQuantity'];
const SUPPLIER_KEYS = ['contactName', 'email', 'id', 'isActive', 'leadTimeDays', 'name', 'notes', 'phone', 'taxId'];

describe('inventory endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  /** Ids created through the API as the spec goes. */
  const ids: Record<string, string> = {};
  let defaultLocation = '';
  let defaultLocationB = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedInventory(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    const locations = await db<{ id: string; restaurant_id: string }>(
      'SELECT id, restaurant_id FROM inventory_locations WHERE is_default',
    );
    defaultLocation = locations.find((l) => l.restaurant_id === fixtures.restaurantA)!.id;
    defaultLocationB = locations.find((l) => l.restaurant_id === fixtures.restaurantB)!.id;
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const setControl = (enabled: boolean) =>
    db(
      `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'inventory_control_enabled', $2)
       ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
      [fixtures.restaurantA, String(enabled)],
    );
  const keys = (value: object) => Object.keys(value).sort();

  describe('items and categories', () => {
    it('creates an item with opening stock at the default location in the same transaction', async () => {
      const res = await adminA().post('/api/inventory/items', {
        name: ' Harina ',
        unit: 'kg',
        minStock: 1,
        openingStock: { quantity: 10, unitCost: 2000 },
      });
      expect(res.status).toBe(201);
      expect(keys(res.body)).toEqual(ITEM_KEYS);
      expect(res.body).toMatchObject({
        name: 'Harina', sku: 'MP-0001', kind: 'raw', unit: 'kg', stock: 10, cost: 2000, minStock: 1, maxStock: null,
        purchaseFactor: 1, isActive: true, categoryName: null,
      });
      ids.harina = res.body.id;
      const [movement] = await db<{ movement_type: string; location_id: string; reason: string; quantity: string; unit_cost: string }>(
        'SELECT movement_type, location_id, reason, quantity, unit_cost FROM inventory_movements WHERE ingredient_id = $1',
        [ids.harina],
      );
      expect(movement).toEqual({
        movement_type: 'opening', location_id: defaultLocation, reason: 'Stock inicial', quantity: '10.000', unit_cost: '2000.0000',
      });
    });

    it('creates items without opening stock and a preparation with a server SKU', async () => {
      const queso = await adminA().post('/api/inventory/items', { name: 'Queso', unit: 'kg', openingStock: { quantity: 4, unitCost: 1000 } });
      const sal = await adminA().post('/api/inventory/items', { name: 'Sal', unit: 'kg', sku: ' sal-1 ' });
      const masa = await adminA().post('/api/inventory/items/preparations', { name: 'Masa', unit: 'kg', yieldQuantity: 2 });
      const salsa = await adminA().post('/api/inventory/items/preparations', { name: 'Salsa', unit: 'l' });
      expect([queso.status, sal.status, masa.status, salsa.status]).toEqual([201, 201, 201, 201]);
      expect(sal.body).toMatchObject({ sku: 'SAL-1', stock: 0, cost: 0 });
      expect(masa.body).toMatchObject({ kind: 'prep', sku: 'PR-0001', stock: 0 });
      ids.queso = queso.body.id;
      ids.sal = sal.body.id;
      ids.masa = masa.body.id;
      ids.salsa = salsa.body.id;
      expect(await db('SELECT 1 FROM inventory_movements WHERE ingredient_id = $1', [ids.sal])).toHaveLength(0);
    });

    it('rolls the item back when the opening stock fails', async () => {
      const res = await adminA().post('/api/inventory/items', {
        name: 'Fantasma',
        unit: 'kg',
        openingStock: { locationId: defaultLocationB, quantity: 1, unitCost: 1 },
      });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'P0002', message: 'Not found' });
      expect(await db("SELECT 1 FROM ingredients WHERE name = 'Fantasma'")).toHaveLength(0);
    });

    it('refuses writes from a waiter and unknown fields', async () => {
      const waiter = await waiterA().post('/api/inventory/items', { name: 'X', unit: 'kg' });
      expect(waiter.status).toBe(403);
      const unknown = await adminA().post('/api/inventory/items', { name: 'X', unit: 'kg', stock: 5 });
      expect(unknown.status).toBe(422);
      expect(await db("SELECT 1 FROM ingredients WHERE name = 'X'")).toHaveLength(0);
    });

    it('lists, filters, reads and patches items, any role reads', async () => {
      const all = await waiterA().get('/api/inventory/items');
      expect(all.status).toBe(200);
      expect(all.body.map((i: { name: string }) => i.name)).toEqual(['Harina', 'Masa', 'Queso', 'Sal', 'Salsa']);
      const preps = await adminA().get('/api/inventory/items?kind=prep');
      expect(preps.body.map((i: { name: string }) => i.name)).toEqual(['Masa', 'Salsa']);
      await db('UPDATE ingredients SET is_active = false WHERE id = $1', [ids.salsa]);
      const active = await adminA().get('/api/inventory/items?includeInactive=false');
      expect(active.body.map((i: { name: string }) => i.name)).not.toContain('Salsa');
      await db('UPDATE ingredients SET is_active = true WHERE id = $1', [ids.salsa]);

      const patched = await adminA().patch(`/api/inventory/items/${ids.sal}`, { minStock: 2, description: 'fina', barcode: null });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ id: ids.sal, minStock: 2, description: 'fina', name: 'Sal' });
      const one = await adminA().get(`/api/inventory/items/${ids.harina}`);
      expect(one.body).toMatchObject({ name: 'Harina', stock: 10 });
    });

    it('isolates items between tenants', async () => {
      const list = await adminB().get('/api/inventory/items');
      expect(list.body.map((i: { id: string }) => i.id)).toEqual([s.itemB]);
      expect((await adminB().get(`/api/inventory/items/${ids.harina}`)).status).toBe(404);
      expect((await adminB().patch(`/api/inventory/items/${ids.harina}`, { name: 'Robada' })).status).toBe(404);
    });

    it('manages item categories per tenant', async () => {
      const created = await adminA().post('/api/inventory/item-categories', { name: ' Secos ', description: 'Harinas' });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ id: created.body.id, name: 'Secos', description: 'Harinas' });
      const patched = await adminA().patch(`/api/inventory/item-categories/${created.body.id}`, { description: null });
      expect(patched.body).toEqual({ id: created.body.id, name: 'Secos', description: null });
      await adminA().patch(`/api/inventory/items/${ids.harina}`, { categoryId: created.body.id });
      expect((await adminA().get(`/api/inventory/items/${ids.harina}`)).body.categoryName).toBe('Secos');
      expect((await adminB().get('/api/inventory/item-categories')).body).toEqual([]);
      expect((await waiterA().get('/api/inventory/item-categories')).body).toHaveLength(1);
      expect((await adminB().delete(`/api/inventory/item-categories/${created.body.id}`)).status).toBe(404);
      expect((await adminA().delete(`/api/inventory/item-categories/${created.body.id}`)).status).toBe(204);
      expect((await adminA().get(`/api/inventory/items/${ids.harina}`)).body.categoryId).toBeNull();
    });
  });

  describe('locations and suppliers', () => {
    it('creates, lists (default first) and patches locations', async () => {
      const bar = await adminA().post('/api/inventory/locations', { name: 'Barra', code: ' bar ' });
      expect(bar.status).toBe(201);
      expect(bar.body).toEqual({ id: bar.body.id, name: 'Barra', code: 'BAR', isDefault: false, isActive: true });
      ids.bar = bar.body.id;
      const list = await waiterA().get('/api/inventory/locations');
      expect(list.body[0]).toMatchObject({ id: defaultLocation, isDefault: true });
      expect(list.body).toHaveLength(2);
      const patched = await adminA().patch(`/api/inventory/locations/${ids.bar}`, { name: 'Bar' });
      expect(patched.body.name).toBe('Bar');
      expect((await adminB().get('/api/inventory/locations')).body.map((l: { id: string }) => l.id)).toEqual([defaultLocationB]);
      const dup = await adminA().post('/api/inventory/locations', { name: 'Otra', code: 'BAR' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('23505');
    });

    it('creates, lists and patches suppliers', async () => {
      const created = await adminA().post('/api/inventory/suppliers', {
        name: ' Molino ', taxId: '900', contactName: null, phone: '300', email: null, leadTimeDays: 2, notes: null,
      });
      expect(created.status).toBe(201);
      expect(keys(created.body)).toEqual(SUPPLIER_KEYS);
      expect(created.body).toMatchObject({ name: 'Molino', taxId: '900', leadTimeDays: 2, isActive: true });
      ids.supplier = created.body.id;
      const patched = await adminA().patch(`/api/inventory/suppliers/${ids.supplier}`, { isActive: false });
      expect(patched.body.isActive).toBe(false);
      await adminA().patch(`/api/inventory/suppliers/${ids.supplier}`, { isActive: true });
      expect((await adminA().get('/api/inventory/suppliers')).body.map((x: { id: string }) => x.id)).toEqual([ids.supplier]);
      expect((await adminB().get('/api/inventory/suppliers')).body.map((x: { id: string }) => x.id)).toEqual([s.supplierB]);
    });
  });

  describe('stock', () => {
    it('adjusts stock mapping every argument', async () => {
      const res = await adminA().post('/api/inventory/movements/adjust', {
        itemId: ids.harina, locationId: defaultLocation, movementType: 'adjustment', quantity: -3, reason: 'Conteo', notes: 'n1',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        itemId: ids.harina, locationId: defaultLocation, movementType: 'adjustment', quantity: -3, totalCost: -6000, stock: 7,
      });
      const [movement] = await db<{ reason: string; notes: string }>(
        "SELECT reason, notes FROM inventory_movements WHERE ingredient_id = $1 AND movement_type = 'adjustment'",
        [ids.harina],
      );
      expect(movement).toEqual({ reason: 'Conteo', notes: 'n1' });
    });

    it('omitted unitCost falls back to the item cost; lot code and expiry reach the lot', async () => {
      const res = await adminA().post('/api/inventory/movements/adjust', {
        itemId: ids.harina, locationId: defaultLocation, movementType: 'opening', quantity: 2, lotCode: 'L1', expiresOn: '2030-01-01',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ quantity: 2, totalCost: 4000, stock: 9 });
      const [lot] = await db<{ unit_cost: string; expires_on: string }>(
        "SELECT unit_cost::text, expires_on::text FROM inventory_lots WHERE ingredient_id = $1 AND lot_code = 'L1'",
        [ids.harina],
      );
      expect(lot).toEqual({ unit_cost: '2000.0000', expires_on: '2030-01-01' });
    });

    it('transfers between locations', async () => {
      const res = await adminA().post('/api/inventory/movements/transfer', {
        itemId: ids.harina, fromLocationId: defaultLocation, toLocationId: ids.bar, quantity: 1, notes: 'a barra',
      });
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['fromLocationId', 'itemId', 'quantity', 'toLocationId', 'totalCost', 'transferId']);
      expect(res.body).toMatchObject({ itemId: ids.harina, fromLocationId: defaultLocation, toLocationId: ids.bar, quantity: 1 });
      const notes = await db<{ movement_type: string; notes: string }>(
        "SELECT movement_type, notes FROM inventory_movements WHERE reference_type = 'transfer' ORDER BY movement_type",
      );
      expect(notes).toEqual([
        { movement_type: 'transfer_in', notes: 'a barra' },
        { movement_type: 'transfer_out', notes: 'a barra' },
      ]);
    });

    it('lists lots in FEFO order', async () => {
      const res = await adminA().get(`/api/inventory/items/${ids.harina}/lots`);
      expect(res.status).toBe(200);
      expect(keys(res.body[0])).toEqual(LOT_KEYS);
      // The transfer moved one unit of L1 (FEFO keeps the lot code), so L1 exists in both locations.
      expect(res.body.map((l: { lotCode: string | null; expiresOn: string | null; quantity: number }) => [l.lotCode, l.expiresOn, l.quantity])).toEqual([
        ['L1', '2030-01-01', 1],
        ['L1', '2030-01-01', 1],
        [null, null, 7],
      ]);
    });

    it('pages movements with the exact total and expands `to` to the end of the day', async () => {
      const [{ today, yesterday }] = await db<{ today: string; yesterday: string }>(
        "SELECT (now() AT TIME ZONE 'America/Bogota')::date::text AS today, ((now() AT TIME ZONE 'America/Bogota')::date - 1)::text AS yesterday",
      );
      const page = await adminA().get(`/api/inventory/movements?itemId=${ids.harina}&page=1&pageSize=2`);
      expect(page.status).toBe(200);
      expect(keys(page.body)).toEqual(['rows', 'total']);
      expect(page.body.total).toBe(5);
      expect(page.body.rows).toHaveLength(2);
      expect(keys(page.body.rows[0])).toEqual(MOVEMENT_KEYS);
      expect(page.body.rows[0]).toMatchObject({ itemName: 'Harina', sku: 'MP-0001', unit: 'kg' });
      const third = await adminA().get(`/api/inventory/movements?itemId=${ids.harina}&page=3&pageSize=2`);
      expect(third.body).toMatchObject({ total: 5 });
      expect(third.body.rows).toHaveLength(1);
      const untilToday = await adminA().get(`/api/inventory/movements?itemId=${ids.harina}&from=${today}&to=${today}`);
      expect(untilToday.body.total).toBe(5);
      const untilYesterday = await adminA().get(`/api/inventory/movements?itemId=${ids.harina}&to=${yesterday}`);
      expect(untilYesterday.body).toEqual({ rows: [], total: 0 });
      const typed = await adminA().get(`/api/inventory/movements?types=transfer_in,transfer_out&locationId=${ids.bar}`);
      expect(typed.body.rows.map((m: { movementType: string }) => m.movementType)).toEqual(['transfer_in']);
      expect((await adminA().get('/api/inventory/movements?types=bogus')).status).toBe(422);
      expect((await adminB().get('/api/inventory/movements')).body).toEqual({ rows: [], total: 0 });
    });
  });

  describe('purchase orders', () => {
    it('creates a draft with its lines and server totals', async () => {
      const res = await adminA().post('/api/inventory/purchase-orders', {
        supplierId: ids.supplier,
        locationId: defaultLocation,
        expectedOn: '2026-12-01',
        notes: 'semanal',
        lines: [
          { itemId: ids.harina, quantity: 10, unitCost: 2100 },
          { itemId: ids.queso, quantity: 4, unitCost: 1050.5 },
        ],
      });
      expect(res.status).toBe(201);
      expect(keys(res.body)).toEqual(PO_KEYS);
      expect(keys(res.body.lines[0])).toEqual(PO_LINE_KEYS);
      expect(res.body).toMatchObject({
        number: 1, status: 'draft', paymentStatus: 'pending', supplierName: 'Molino', locationName: 'Bodega principal',
        expectedOn: '2026-12-01', notes: 'semanal', orderedAt: null, total: 25202,
      });
      expect(res.body.lines.map((l: { itemName: string; total: number; pendingQuantity: number }) => [l.itemName, l.total, l.pendingQuantity])).toEqual([
        ['Harina', 21000, 10],
        ['Queso', 4202, 4],
      ]);
      ids.po = res.body.id;
      ids.poHarina = res.body.lines[0].id;
      ids.poQueso = res.body.lines[1].id;
    });

    it('leaves no draft when a line fails', async () => {
      const before = await db('SELECT id FROM purchase_orders');
      const res = await adminA().post('/api/inventory/purchase-orders', {
        supplierId: ids.supplier,
        locationId: defaultLocation,
        lines: [{ itemId: ids.harina, quantity: 1, unitCost: 1 }, { itemId: s.itemB, quantity: 1, unitCost: 1 }],
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('P0002');
      expect(await db('SELECT id FROM purchase_orders')).toEqual(before);
    });

    it('applies the line diff on PUT atomically', async () => {
      const failed = await adminA().put(`/api/inventory/purchase-orders/${ids.po}`, {
        supplierId: ids.supplier,
        locationId: defaultLocation,
        notes: 'cambiada',
        lines: [{ lineId: ids.poHarina, itemId: ids.harina, quantity: 12, unitCost: 2100 }, { itemId: s.itemB, quantity: 1, unitCost: 1 }],
      });
      expect(failed.status).toBe(404);
      const unchanged = await adminA().get(`/api/inventory/purchase-orders/${ids.po}`);
      expect(unchanged.body.notes).toBe('semanal');
      expect(unchanged.body.lines.map((l: { id: string; quantity: number }) => [l.id, l.quantity])).toEqual([
        [ids.poHarina, 10],
        [ids.poQueso, 4],
      ]);

      const res = await adminA().put(`/api/inventory/purchase-orders/${ids.po}`, {
        supplierId: ids.supplier,
        locationId: defaultLocation,
        expectedOn: null,
        notes: 'cambiada',
        lines: [{ lineId: ids.poHarina, itemId: ids.harina, quantity: 12, unitCost: 2100 }, { itemId: ids.sal, quantity: 3, unitCost: 500 }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ notes: 'cambiada', expectedOn: null, total: 26700 });
      expect(res.body.lines.map((l: { id: string; itemName: string; quantity: number }) => [l.itemName, l.quantity])).toEqual([
        ['Harina', 12],
        ['Sal', 3],
      ]);
      expect(res.body.lines[0].id).toBe(ids.poHarina);
      expect(await db('SELECT 1 FROM purchase_order_lines WHERE id = $1', [ids.poQueso])).toHaveLength(0);

      const foreignLine = await adminA().put(`/api/inventory/purchase-orders/${ids.po}`, {
        supplierId: ids.supplier, locationId: defaultLocation, lines: [{ lineId: s.order, itemId: ids.sal, quantity: 1, unitCost: 1 }],
      });
      expect(foreignLine.status).toBe(422);
    });

    it('refuses receiving a draft with the status in the message', async () => {
      const res = await adminA().post(`/api/inventory/purchase-orders/${ids.po}/receive`, {
        lines: [{ lineId: ids.poHarina, quantity: 1 }],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'P0001', message: 'receive_purchase_order: purchase order 1 is draft' });
    });

    it('orders, then receives with the payment status in the same transaction', async () => {
      const ordered = await adminA().post(`/api/inventory/purchase-orders/${ids.po}/status`, { status: 'ordered' });
      expect(ordered.status).toBe(200);
      expect(ordered.body.status).toBe('ordered');
      expect(ordered.body.orderedAt).toEqual(expect.any(String));

      const res = await adminA().post(`/api/inventory/purchase-orders/${ids.po}/receive`, {
        lines: [{ lineId: ids.poHarina, quantity: 5, lotCode: 'R1' }],
        paymentStatus: 'paid',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ purchaseOrderId: ids.po, status: 'partially_received', receivedLines: 1, totalCost: 10500 });
      const [lot] = await db<{ unit_cost: string; expires_on: string | null }>(
        "SELECT unit_cost::text, expires_on FROM inventory_lots WHERE lot_code = 'R1'",
      );
      expect(lot).toEqual({ unit_cost: '2100.0000', expires_on: null });
      const order = await adminA().get(`/api/inventory/purchase-orders/${ids.po}`);
      expect(order.body).toMatchObject({ status: 'partially_received', paymentStatus: 'paid' });
      expect(order.body.lines[0]).toMatchObject({ receivedQuantity: 5, pendingQuantity: 7 });
    });

    it('over-receipt is refused with the RPC message and the payment status is not applied', async () => {
      const res = await adminA().post(`/api/inventory/purchase-orders/${ids.po}/receive`, {
        lines: [{ lineId: ids.poHarina, quantity: 8 }],
        paymentStatus: 'pending',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('P0001');
      expect(res.body.message).toMatch(/^receive_purchase_order: receiving 8 exceeds the pending quantity/);
      expect((await adminA().get(`/api/inventory/purchase-orders/${ids.po}`)).body.paymentStatus).toBe('paid');
    });

    it('keeps the trigger messages the UI matches', async () => {
      const lines = await adminA().put(`/api/inventory/purchase-orders/${ids.po}`, {
        supplierId: ids.supplier, locationId: defaultLocation, lines: [{ lineId: ids.poHarina, itemId: ids.harina, quantity: 12, unitCost: 2100 }],
      });
      expect(lines.status).toBe(422);
      expect(lines.body.message).toMatch(/can only change while/);
      const del = await adminA().delete(`/api/inventory/purchase-orders/${ids.po}`);
      expect(del.status).toBe(422);
      expect(del.body).toMatchObject({ code: 'P0001', message: 'only draft purchase orders can be deleted' });
    });

    it('sets the payment status, filters, isolates and deletes drafts', async () => {
      const paid = await adminA().post(`/api/inventory/purchase-orders/${ids.po}/payment-status`, { paymentStatus: 'pending' });
      expect(paid.status).toBe(200);
      expect(paid.body.paymentStatus).toBe('pending');
      const draft = await adminA().post('/api/inventory/purchase-orders', {
        supplierId: ids.supplier, locationId: defaultLocation, lines: [],
      });
      expect(draft.body).toMatchObject({ number: 2, lines: [], total: 0 });
      const drafts = await adminA().get('/api/inventory/purchase-orders?status=draft');
      expect(drafts.body.map((o: { id: string }) => o.id)).toEqual([draft.body.id]);
      const all = await adminA().get(`/api/inventory/purchase-orders?supplierId=${ids.supplier}`);
      expect(all.body.map((o: { number: number }) => o.number)).toEqual([2, 1]);
      expect((await adminB().get('/api/inventory/purchase-orders')).body).toEqual([]);
      expect((await adminB().get(`/api/inventory/purchase-orders/${ids.po}`)).status).toBe(404);
      expect((await adminA().delete(`/api/inventory/purchase-orders/${draft.body.id}`)).status).toBe(204);
      expect(await db('SELECT 1 FROM purchase_orders WHERE id = $1', [draft.body.id])).toHaveLength(0);
    });
  });

  describe('formulas', () => {
    it('saves a formula and returns the save_formula unit cost on read', async () => {
      const res = await adminA().put('/api/inventory/formulas', {
        targetType: 'prep',
        targetId: ids.masa,
        yieldQuantity: 2,
        lines: [{ ingredientId: ids.harina, quantity: 1 }, { ingredientId: ids.queso, quantity: 0.5 }],
        notes: 'base',
      });
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['linesCount', 'recipeId', 'targetId', 'targetType', 'totalCost', 'unitCost', 'yieldQuantity']);
      const [{ expected }] = await db<{ expected: string }>(
        `SELECT round((h.cost * 1 + q.cost * 0.5) / 2, 4)::text AS expected FROM ingredients h, ingredients q WHERE h.id = $1 AND q.id = $2`,
        [ids.harina, ids.queso],
      );
      expect(res.body).toMatchObject({ targetType: 'prep', targetId: ids.masa, yieldQuantity: 2, linesCount: 2, unitCost: Number(expected) });

      const dish = await adminA().put('/api/inventory/formulas', {
        targetType: 'dish', targetId: s.arepa, yieldQuantity: 1, lines: [{ ingredientId: ids.masa, quantity: 0.5 }],
      });
      expect(dish.status).toBe(200);
      const torta = await adminA().put('/api/inventory/formulas', {
        targetType: 'dish', targetId: s.torta, yieldQuantity: 1, lines: [{ ingredientId: ids.queso, quantity: 1000 }],
      });
      expect(torta.status).toBe(200);

      const index = await waiterA().get('/api/inventory/formulas');
      expect(index.status).toBe(200);
      expect(keys(index.body)).toEqual(['byDish', 'byPrep']);
      const masa = index.body.byPrep[ids.masa];
      expect(keys(masa)).toEqual(FORMULA_KEYS);
      expect(masa).toMatchObject({
        targetType: 'prep', targetId: ids.masa, yieldQuantity: 2, notes: 'base', unitCost: Number(expected),
        lines: [{ ingredientId: ids.harina, quantity: 1 }, { ingredientId: ids.queso, quantity: 0.5 }],
      });
      expect(index.body.byDish[s.arepa]).toMatchObject({ targetType: 'dish', notes: null, unitCost: dish.body.unitCost });
      expect((await adminB().get('/api/inventory/formulas')).body).toEqual({ byDish: {}, byPrep: {} });
    });

    it('passes the 22023 messages the UI matches through verbatim', async () => {
      const twice = await adminA().put('/api/inventory/formulas', {
        targetType: 'prep', targetId: ids.masa, yieldQuantity: 1,
        lines: [{ ingredientId: ids.harina, quantity: 1 }, { ingredientId: ids.harina, quantity: 2 }],
      });
      expect(twice.status).toBe(422);
      expect(twice.body.code).toBe('22023');
      expect(twice.body.message).toBe(`save_formula: ingredient ${ids.harina} appears twice`);

      const itself = await adminA().put('/api/inventory/formulas', {
        targetType: 'prep', targetId: ids.masa, yieldQuantity: 1, lines: [{ ingredientId: ids.masa, quantity: 1 }],
      });
      expect(itself.body).toMatchObject({ code: '22023', message: 'save_formula: a preparation cannot use itself' });

      const salsa = await adminA().put('/api/inventory/formulas', {
        targetType: 'prep', targetId: ids.salsa, yieldQuantity: 1, lines: [{ ingredientId: ids.masa, quantity: 1 }],
      });
      expect(salsa.status).toBe(200);
      const cycle = await adminA().put('/api/inventory/formulas', {
        targetType: 'prep', targetId: ids.masa, yieldQuantity: 1, lines: [{ ingredientId: ids.salsa, quantity: 1 }],
      });
      expect(cycle.status).toBe(422);
      expect(cycle.body.code).toBe('22023');
      expect(cycle.body.message).toMatch(/formula cycle/);
      expect((await waiterA().put('/api/inventory/formulas', { targetType: 'prep', targetId: ids.masa, yieldQuantity: 1, lines: [] })).status).toBe(403);
    });
  });

  describe('production', () => {
    it('refuses a preparation without formula', async () => {
      const prep = await adminA().post('/api/inventory/items/preparations', { name: 'Vacia', unit: 'kg' });
      const res = await adminA().post('/api/inventory/production', { itemId: prep.body.id, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'P0001', message: 'produce_preparation: Vacia has no formula' });
    });

    it('passes the shortage details through verbatim and writes nothing', async () => {
      const res = await adminA().post('/api/inventory/production', { itemId: ids.masa, quantity: 1000 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('P0001');
      expect(res.body.message).toMatch(/^produce_preparation: insufficient stock: /);
      const details = JSON.parse(res.body.details);
      expect(details.map((d: { ingredient_id: string }) => d.ingredient_id).sort()).toEqual([ids.harina, ids.queso].sort());
      expect(details[0]).toEqual(expect.objectContaining({ name: 'Harina', unit: 'kg', required: 500, missing: expect.any(Number) }));
      expect(await db('SELECT 1 FROM production_batches')).toHaveLength(0);
    });

    it('produces at the default location with a generated lot code when optionals are omitted', async () => {
      const res = await adminA().post('/api/inventory/production', { itemId: ids.masa, quantity: 2, notes: 'turno' });
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual([
        'batchId', 'consumed', 'expiresOn', 'itemId', 'locationId', 'lotCode', 'lotId', 'quantity', 'totalCost', 'unitCost',
      ]);
      expect(res.body).toMatchObject({ itemId: ids.masa, locationId: defaultLocation, quantity: 2, expiresOn: null });
      expect(res.body.lotCode).toMatch(/^PB-\d{8}-\d{6}$/);
      expect(res.body.consumed.map((c: { name: string; quantity: number }) => [c.name, c.quantity]).sort()).toEqual([
        ['Harina', 1],
        ['Queso', 0.5],
      ]);
      expect(keys(res.body.consumed[0])).toEqual(['itemId', 'name', 'quantity', 'totalCost']);

      const batches = await adminA().get(`/api/inventory/batches?itemId=${ids.masa}&limit=1`);
      expect(batches.status).toBe(200);
      expect(keys(batches.body[0])).toEqual(BATCH_KEYS);
      expect(batches.body[0]).toMatchObject({ id: res.body.batchId, lotCode: res.body.lotCode, notes: 'turno', itemName: 'Masa' });
      expect((await adminB().get('/api/inventory/batches')).body).toEqual([]);
    });
  });

  describe('counts', () => {
    it('opens a count at the default location for the given items, sorted lines', async () => {
      const res = await adminA().post('/api/inventory/counts', { itemIds: [ids.queso, ids.harina], notes: 'c1' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ countId: res.body.countId, number: 1, locationId: defaultLocation, status: 'open', linesCount: 2 });
      ids.count = res.body.countId;
      const detail = await adminA().get(`/api/inventory/counts/${ids.count}`);
      expect(keys(detail.body)).toEqual([...COUNT_KEYS, 'lines'].sort());
      expect(keys(detail.body.lines[0])).toEqual(COUNT_LINE_KEYS);
      expect(detail.body.lines.map((l: { itemName: string; countedQuantity: null }) => [l.itemName, l.countedQuantity])).toEqual([
        ['Harina', null],
        ['Queso', null],
      ]);
      expect(detail.body).toMatchObject({ notes: 'c1', locationName: 'Bodega principal', status: 'open' });
      ids.countLine = detail.body.lines[0].id;
    });

    it('opens a count of every active item when itemIds is omitted', async () => {
      const res = await adminA().post('/api/inventory/counts', {});
      expect(res.status).toBe(201);
      const [{ n }] = await db<{ n: number }>('SELECT count(*)::int AS n FROM ingredients WHERE restaurant_id = $1 AND is_active', [
        fixtures.restaurantA,
      ]);
      expect(res.body.linesCount).toBe(n);
      const cancelled = await adminA().post(`/api/inventory/counts/${res.body.countId}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('cancelled');
    });

    it('sets counted quantities and applies the count once', async () => {
      const line = await adminA().patch(`/api/inventory/counts/${ids.count}/lines/${ids.countLine}`, { countedQuantity: 3 });
      expect(line.status).toBe(200);
      expect(line.body).toMatchObject({ id: ids.countLine, itemName: 'Harina', countedQuantity: 3 });
      const applied = await adminA().post(`/api/inventory/counts/${ids.count}/apply`);
      expect(applied.status).toBe(200);
      expect(applied.body).toMatchObject({ countId: ids.count, status: 'applied', adjustedLines: 1 });
      const again = await adminA().post(`/api/inventory/counts/${ids.count}/apply`);
      expect(again.status).toBe(422);
      expect(again.body).toMatchObject({ code: 'P0001', message: 'apply_inventory_count: count 1 is applied' });
      const late = await adminA().patch(`/api/inventory/counts/${ids.count}/lines/${ids.countLine}`, { countedQuantity: null });
      expect(late.status).toBe(422);
      expect(late.body.message).toMatch(/can only change while/);
      const list = await adminA().get('/api/inventory/counts');
      expect(list.body.map((c: { number: number; status: string }) => [c.number, c.status])).toEqual([
        [2, 'cancelled'],
        [1, 'applied'],
      ]);
      expect((await adminB().get('/api/inventory/counts')).body).toEqual([]);
      expect((await adminB().get(`/api/inventory/counts/${ids.count}`)).status).toBe(404);
    });
  });

  describe('overview', () => {
    it('returns the camelCase overview and the RPC range error verbatim', async () => {
      const res = await adminA().get('/api/inventory/overview?days=7');
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['days', 'generatedAt', 'kpis', 'series', 'topConsumed', 'valueByCategory']);
      expect(res.body.days).toBe(7);
      expect(keys(res.body.kpis)).toEqual([
        'activeItems', 'consumptionValue', 'expiredCount', 'expiringSoonCount', 'itemsCount', 'lowStockCount', 'openPurchaseOrders',
        'outOfStockCount', 'purchasesValue', 'totalValue', 'wasteValue',
      ]);
      expect(res.body.kpis.itemsCount).toBe(6);
      const out = await adminA().get('/api/inventory/overview?days=400');
      expect(out.status).toBe(422);
      expect(out.body).toMatchObject({ code: '22023', message: 'inventory_overview: p_days must be between 1 and 365' });
    });
  });

  describe('sales and availability', () => {
    it('lets a waiter check stock and consume an order', async () => {
      await setControl(true);
      const ok = await waiterA().post('/api/inventory/check-stock', { items: [{ dishId: s.arepa, quantity: 1 }] });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ok: true, enabled: true, shortages: [] });
      const short = await waiterA().post('/api/inventory/check-stock', { items: [{ dishId: s.torta, quantity: 1 }] });
      expect(short.body.ok).toBe(false);
      expect(keys(short.body.shortages[0])).toEqual(['available', 'itemId', 'missing', 'name', 'required', 'unit']);
      expect(short.body.shortages[0]).toMatchObject({ itemId: ids.queso, name: 'Queso', required: 1000 });

      const consumed = await waiterA().post('/api/inventory/consume', { orderId: s.order });
      expect(consumed.status).toBe(200);
      expect(consumed.body).toMatchObject({ orderId: s.order, enabled: true, consumedItems: 1, shortages: [] });
      expect(keys(consumed.body)).toEqual(['consumedItems', 'enabled', 'orderId', 'shortages', 'totalCost']);
    });

    it('answers availability with the check_dishes_stock rule', async () => {
      const res = await waiterA().post('/api/inventory/dish-availability', { dishIds: [s.arepa, s.jugo, s.torta, s.dishB] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ [s.arepa]: true, [s.jugo]: true, [s.torta]: false });

      // A shortage at the default location counts even when another location has stock.
      await adminA().post('/api/inventory/movements/transfer', {
        itemId: ids.masa, fromLocationId: defaultLocation, toLocationId: ids.bar, quantity: 1.5,
      });
      const moved = await waiterA().post('/api/inventory/dish-availability', { dishIds: [s.arepa] });
      expect(moved.body).toEqual({ [s.arepa]: false });

      await setControl(false);
      const off = await waiterA().post('/api/inventory/dish-availability', { dishIds: [s.arepa, s.torta] });
      expect(off.body).toEqual({ [s.arepa]: true, [s.torta]: true });
      const offCheck = await waiterA().post('/api/inventory/check-stock', { items: [{ dishId: s.torta, quantity: 1 }] });
      expect(offCheck.body).toEqual({ ok: true, enabled: false, shortages: [] });
    });

    it('refuses invalid sales input', async () => {
      expect((await waiterA().post('/api/inventory/dish-availability', { dishIds: ['nope'] })).status).toBe(422);
      expect((await waiterA().post('/api/inventory/check-stock', { items: [{ dishId: s.arepa, quantity: 0 }] })).status).toBe(422);
      const foreign = await waiterA().post('/api/inventory/check-stock', { items: [{ dishId: s.dishB, quantity: 1 }] });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('P0002');
    });
  });
  describe('correction batch', () => {
    it('opening stock without cost falls back to the item cost', async () => {
      const res = await adminA().post('/api/inventory/items', {
        name: 'Aceite', unit: 'l', openingStock: { quantity: 3, unitCost: null },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ stock: 3, cost: 0 });
      const [movement] = await db<{ unit_cost: string }>(
        "SELECT unit_cost::text FROM inventory_movements WHERE ingredient_id = $1 AND movement_type = 'opening'", [res.body.id],
      );
      expect(movement.unit_cost).toBe('0.0000');
    });

    it('refuses impossible from/to dates with 422', async () => {
      expect((await adminA().get('/api/inventory/movements?from=2026-02-30')).status).toBe(422);
      expect((await adminA().get('/api/inventory/movements?to=2026-01-01T25:00')).status).toBe(422);
    });

    it('expands bare from/to dates in the restaurant timezone', async () => {
      const item = await adminA().post('/api/inventory/items', { name: 'Tarde', unit: 'kg' });
      // 2026-03-10 23:30 in Bogota is 2026-03-11 04:30 UTC.
      await db(
        `INSERT INTO inventory_movements (restaurant_id, ingredient_id, location_id, movement_type, quantity, unit_cost, total_cost, created_at)
         VALUES ($1, $2, $3, 'adjustment', 1, 0, 0, '2026-03-11T04:30:00Z')`,
        [fixtures.restaurantA, item.body.id, defaultLocation],
      );
      const day = await adminA().get(`/api/inventory/movements?itemId=${item.body.id}&from=2026-03-10&to=2026-03-10`);
      expect(day.body.total).toBe(1);
      const next = await adminA().get(`/api/inventory/movements?itemId=${item.body.id}&from=2026-03-11&to=2026-03-11`);
      expect(next.body.total).toBe(0);
    });

    it('maps receive unitCost and expiresOn', async () => {
      const po = await adminA().post('/api/inventory/purchase-orders', {
        supplierId: ids.supplier, locationId: defaultLocation, lines: [{ itemId: ids.harina, quantity: 2, unitCost: 100 }],
      });
      await adminA().post(`/api/inventory/purchase-orders/${po.body.id}/status`, { status: 'ordered' });
      const res = await adminA().post(`/api/inventory/purchase-orders/${po.body.id}/receive`, {
        lines: [{ lineId: po.body.lines[0].id, quantity: 1, unitCost: 150, expiresOn: '2031-05-05', lotCode: 'R2' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.totalCost).toBe(150);
      const [lot] = await db<{ unit_cost: string; expires_on: string; location_id: string }>(
        "SELECT unit_cost::text, expires_on::text, location_id FROM inventory_lots WHERE lot_code = 'R2'",
      );
      expect(lot).toEqual({ unit_cost: '150.0000', expires_on: '2031-05-05', location_id: defaultLocation });
    });

    it('maps produce locationId and lotCode', async () => {
      await adminA().post('/api/inventory/movements/transfer', {
        itemId: ids.queso, fromLocationId: defaultLocation, toLocationId: ids.bar, quantity: 0.5,
      });
      const res = await adminA().post('/api/inventory/production', { itemId: ids.masa, quantity: 0.2, locationId: ids.bar, lotCode: 'PX' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ locationId: ids.bar, lotCode: 'PX' });
      const [lot] = await db<{ location_id: string }>("SELECT location_id FROM inventory_lots WHERE lot_code = 'PX'");
      expect(lot.location_id).toBe(ids.bar);
    });

    it('maps open count locationId', async () => {
      const res = await adminA().post('/api/inventory/counts', { locationId: ids.bar, itemIds: [ids.harina] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ locationId: ids.bar, linesCount: 1 });
      await adminA().post(`/api/inventory/counts/${res.body.countId}/cancel`);
    });

    it('records waste from a given lot', async () => {
      await adminA().post('/api/inventory/movements/adjust', {
        itemId: ids.harina, locationId: defaultLocation, movementType: 'opening', quantity: 2, lotCode: 'LX',
      });
      const [lot] = await db<{ id: string }>("SELECT id FROM inventory_lots WHERE lot_code = 'LX'");
      const res = await adminA().post('/api/inventory/movements/adjust', {
        itemId: ids.harina, locationId: defaultLocation, movementType: 'waste', quantity: 1, lotId: lot.id,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ movementType: 'waste', quantity: -1 });
      const [after] = await db<{ quantity: string }>('SELECT quantity::text FROM inventory_lots WHERE id = $1', [lot.id]);
      expect(after.quantity).toBe('1.000');
      const [movement] = await db<{ quantity: string }>(
        "SELECT quantity::text FROM inventory_movements WHERE lot_id = $1 AND movement_type = 'waste'", [lot.id],
      );
      expect(movement.quantity).toBe('-1.000');
    });

    it('refuses every inventory write from a waiter', async () => {
      const x = ids.harina;
      const writes: [string, string][] = [
        ['post', '/api/inventory/movements/adjust'], ['post', '/api/inventory/movements/transfer'],
        ['post', '/api/inventory/purchase-orders'], ['put', `/api/inventory/purchase-orders/${x}`],
        ['post', `/api/inventory/purchase-orders/${x}/status`], ['post', `/api/inventory/purchase-orders/${x}/payment-status`],
        ['delete', `/api/inventory/purchase-orders/${x}`], ['post', `/api/inventory/purchase-orders/${x}/receive`],
        ['post', '/api/inventory/counts'], ['patch', `/api/inventory/counts/${x}/lines/${x}`],
        ['post', `/api/inventory/counts/${x}/apply`], ['post', `/api/inventory/counts/${x}/cancel`],
        ['post', '/api/inventory/production'], ['post', '/api/inventory/items/preparations'],
        ['patch', `/api/inventory/items/${x}`], ['post', '/api/inventory/item-categories'],
        ['patch', `/api/inventory/item-categories/${x}`], ['delete', `/api/inventory/item-categories/${x}`],
        ['post', '/api/inventory/locations'], ['patch', `/api/inventory/locations/${x}`],
        ['post', '/api/inventory/suppliers'], ['patch', `/api/inventory/suppliers/${x}`], ['put', '/api/inventory/formulas'],
      ];
      for (const [method, url] of writes) {
        const waiter = waiterA() as unknown as Record<string, (u: string, b?: object) => Promise<{ status: number }>>;
        const res = await waiter[method](url, {});
        expect(res.status, `${method} ${url}`).toBe(403);
      }
    });

    it('isolates lots and overview, and non-admins read empty lists', async () => {
      expect((await adminB().get(`/api/inventory/items/${ids.harina}/lots`)).body).toEqual([]);
      const overview = await adminB().get('/api/inventory/overview');
      expect(overview.body.kpis.itemsCount).toBe(1);
      expect((await waiterA().get('/api/inventory/movements')).body).toEqual({ rows: [], total: 0 });
      expect((await waiterA().get('/api/inventory/purchase-orders')).body).toEqual([]);
    });
  });
});

async function seedInventory(url: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  await superuserQuery(
    url,
    `INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES
       ($1, 'Arepa', 5000, true, $5), ($2, 'Jugo', 3000, true, $5), ($3, 'Torta', 9000, true, $5), ($4, 'Plato B', 1000, true, $6)`,
    [s.arepa, s.jugo, s.torta, s.dishB, A, B],
  );
  await superuserQuery(url, `INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Harina B', 'kg', $2)`, [s.itemB, B]);
  await superuserQuery(url, `INSERT INTO suppliers (id, name, restaurant_id) VALUES ($1, 'Proveedor B', $2)`, [s.supplierB, B]);
  await superuserQuery(
    url,
    `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'active', 5000, 0, 0, 5000, $2)`,
    [s.order, A],
  );
  await superuserQuery(
    url,
    `INSERT INTO order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id)
     VALUES ($1, $2, $3, 'Arepa', 5000, 1, 'kitchen', $4)`,
    [s.orderItem, s.order, s.arepa, A],
  );
}
