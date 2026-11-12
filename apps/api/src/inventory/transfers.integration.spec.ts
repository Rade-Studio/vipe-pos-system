import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * Transfer documents through the in-transit holding (odd/tasks/inventario-rediseno.md
 * T2, S3): send takes the stock out of the origin at once, the stock in transit
 * is neither available nor counted in either bodega, receive adds the received
 * quantity at the destination and writes the shortfall off with a reason, and
 * cancel before receipt returns everything to the origin.
 */

const s = {
  harina: '78000000-0000-0000-0000-000000000001',
  queso: '78000000-0000-0000-0000-000000000002',
  sal: '78000000-0000-0000-0000-000000000003',
  barra: '78000000-0000-0000-0000-0000000000a2',
  itemB: '78000000-0000-0000-0000-0000000000b1',
  missing: '78000000-0000-0000-0000-0000000000ff',
} as const;

const TRANSFER_KEYS = [
  'cancelledAt', 'cancelledBy', 'cancelledByName', 'createdAt', 'createdBy', 'createdByName', 'fromLocationId', 'fromLocationName',
  'id', 'lines', 'notes', 'number', 'receivedAt', 'receivedBy', 'receivedByName', 'sentAt', 'sentBy', 'sentByName', 'status',
  'toLocationId', 'toLocationName', 'updatedAt',
];
const LINE_KEYS = [
  'id', 'itemId', 'itemName', 'receivedQuantity', 'requestedQuantity', 'shortfallQuantity', 'shortfallReason', 'sku', 'unit',
];

type Line = { id: string; itemId: string };

describe('inventory transfers (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let origin = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    const A = fixtures.restaurantA;
    await db(`INSERT INTO inventory_locations (id, restaurant_id, name, code) VALUES ($1, $2, 'Barra', 'BARRA')`, [s.barra, A]);
    await db(
      `INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES
         ($1, 'Harina', 'kg', $4), ($2, 'Queso', 'kg', $4), ($3, 'Sal', 'kg', $4), ($5, 'Harina B', 'kg', $6)`,
      [s.harina, s.queso, s.sal, A, s.itemB, fixtures.restaurantB],
    );
    [{ id: origin }] = await db<{ id: string }>('SELECT id FROM inventory_locations WHERE is_default AND restaurant_id = $1', [A]);
    // Harina: L1 4 kg (expires first) and L2 6 kg; Queso 5 kg; Sal 2 kg, all at the origin.
    for (const body of [
      { itemId: s.harina, quantity: 4, unitCost: 1000, lotCode: 'L1', expiresOn: '2030-01-10' },
      { itemId: s.harina, quantity: 6, unitCost: 1200, lotCode: 'L2', expiresOn: '2030-02-10' },
      { itemId: s.queso, quantity: 5, unitCost: 500 },
      { itemId: s.sal, quantity: 2, unitCost: 100 },
    ]) {
      const res = await adminA().post('/api/inventory/movements/adjust', { locationId: origin, movementType: 'opening', ...body });
      expect(res.status).toBe(200);
    }
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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const keys = (value: object) => Object.keys(value).sort();
  const lots = async (itemId: string) => {
    const res = await adminA().get(`/api/inventory/items/${itemId}/lots`);
    return (res.body as { locationId: string; lotCode: string | null; quantity: number }[])
      .map((lot) => `${lot.locationId === origin ? 'origin' : 'barra'}:${lot.lotCode ?? 'general'}:${lot.quantity}`)
      .sort();
  };
  const stock = async (itemId: string) => (await adminA().get(`/api/inventory/items/${itemId}`)).body.stock as number;
  const movements = (transferId: string) =>
    db<{ movement_type: string; location_id: string; quantity: string; reason: string | null; notes: string | null }>(
      `SELECT movement_type, location_id, quantity, reason, notes FROM inventory_movements
        WHERE reference_type = 'inventory_transfer' AND reference_id = $1 ORDER BY movement_type, quantity`,
      [transferId],
    );
  const expectedInCount = async (locationId: string, itemId: string) => {
    const opened = await adminA().post('/api/inventory/counts', { locationId, itemIds: [itemId] });
    expect(opened.status).toBe(201);
    const detail = await adminA().get(`/api/inventory/counts/${opened.body.countId}`);
    await adminA().post(`/api/inventory/counts/${opened.body.countId}/cancel`);
    return detail.body.lines[0].expectedQuantity as number;
  };
  const lineOf = (transfer: { lines: Line[] }, itemId: string) => transfer.lines.find((line) => line.itemId === itemId)!.id;

  describe('drafts', () => {
    it('creates a draft with its lines, names and creator', async () => {
      const res = await adminA().post('/api/inventory/transfers', {
        fromLocationId: origin,
        toLocationId: s.barra,
        notes: ' para la barra ',
        lines: [{ itemId: s.harina, quantity: 3 }],
      });
      expect(res.status).toBe(201);
      expect(keys(res.body)).toEqual(TRANSFER_KEYS);
      expect(keys(res.body.lines[0])).toEqual(LINE_KEYS);
      expect(res.body).toMatchObject({
        number: 1, status: 'draft', fromLocationId: origin, fromLocationName: 'Bodega principal', toLocationId: s.barra,
        toLocationName: 'Barra', notes: 'para la barra', createdBy: fixtures.adminA.profileId, sentAt: null, receivedAt: null,
        cancelledAt: null,
      });
      expect(res.body.lines).toEqual([
        expect.objectContaining({
          itemId: s.harina, itemName: 'Harina', unit: 'kg', requestedQuantity: 3, receivedQuantity: null, shortfallQuantity: null,
          shortfallReason: null,
        }),
      ]);
      ids.t1 = res.body.id;
    });

    it('refuses bad lines, equal bodegas and unknown fields with 422', async () => {
      const base = { fromLocationId: origin, toLocationId: s.barra };
      const cases = [
        { ...base, lines: [{ itemId: s.harina, quantity: 0 }] },
        { ...base, lines: [] },
        { ...base, toLocationId: origin, lines: [{ itemId: s.harina, quantity: 1 }] },
        { ...base, lines: [{ itemId: s.harina, quantity: 1 }, { itemId: s.harina, quantity: 2 }] },
        { ...base, lines: [{ itemId: s.harina, quantity: 1 }], extra: true },
      ];
      for (const body of cases) {
        const res = await adminA().post('/api/inventory/transfers', body);
        expect(res.status, JSON.stringify(body)).toBe(422);
      }
      const unknown = await adminA().post('/api/inventory/transfers', { ...base, lines: [{ itemId: s.itemB, quantity: 1 }] });
      expect(unknown.status).toBe(404);
      expect((await db('SELECT 1 FROM inventory_transfers')).length).toBe(1);
    });

    it('refuses more than the origin stock in Spanish, listing the shortages', async () => {
      const res = await adminA().post('/api/inventory/transfers', {
        fromLocationId: origin,
        toLocationId: s.barra,
        lines: [{ itemId: s.harina, quantity: 11 }, { itemId: s.queso, quantity: 1 }],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'P0001',
        message: 'Stock insuficiente en la bodega de origen: Harina (disponible 10.000 kg, solicitado 11.000 kg)',
      });
      expect(JSON.parse(res.body.details).shortages).toEqual([
        { ingredient_id: s.harina, name: 'Harina', unit: 'kg', available: 10, requested: 11 },
      ]);
    });

    it('lets only an admin write transfers', async () => {
      const res = await waiterA().post('/api/inventory/transfers', {
        fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.harina, quantity: 1 }],
      });
      expect(res.status).toBe(403);
      expect((await waiterA().post(`/api/inventory/transfers/${ids.t1}/send`)).status).toBe(403);
    });

    it('replaces the lines and notes of a draft', async () => {
      const res = await adminA().put(`/api/inventory/transfers/${ids.t1}`, {
        fromLocationId: origin,
        toLocationId: s.barra,
        notes: null,
        lines: [{ itemId: s.harina, quantity: 5 }, { itemId: s.queso, quantity: 1 }],
      });
      expect(res.status).toBe(200);
      expect(res.body.notes).toBeNull();
      expect(res.body.lines.map((l: { itemName: string; requestedQuantity: number }) => [l.itemName, l.requestedQuantity])).toEqual([
        ['Harina', 5], ['Queso', 1],
      ]);
    });
  });

  describe('send', () => {
    it('takes the stock out of the origin at once, FEFO, into transit', async () => {
      const res = await adminA().post(`/api/inventory/transfers/${ids.t1}/send`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'in_transit', sentBy: fixtures.adminA.profileId, sentByName: 'Admin A' });
      expect(res.body.sentAt).toEqual(expect.any(String));
      expect(await lots(s.harina)).toEqual(['origin:L1:0', 'origin:L2:5']);
      expect(await lots(s.queso)).toEqual(['origin:general:4']);
      expect((await movements(ids.t1)).map((m) => `${m.movement_type}:${m.quantity}`)).toEqual([
        'transfer_out:-4.000', 'transfer_out:-1.000', 'transfer_out:-1.000',
      ]);
    });

    it('keeps the stock in transit out of availability, consumption and both counts', async () => {
      expect(await stock(s.harina)).toBe(5);
      const consume = await adminA().post('/api/inventory/movements/adjust', {
        itemId: s.harina, locationId: origin, movementType: 'waste', quantity: 6,
      });
      expect(consume.status).toBe(422);
      const atDestination = await adminA().post('/api/inventory/movements/adjust', {
        itemId: s.harina, locationId: s.barra, movementType: 'waste', quantity: 1,
      });
      expect(atDestination.status).toBe(422);
      expect(await expectedInCount(origin, s.harina)).toBe(5);
      expect(await expectedInCount(s.barra, s.harina)).toBe(0);
    });

    it('sends once and locks the draft', async () => {
      const again = await adminA().post(`/api/inventory/transfers/${ids.t1}/send`);
      expect(again.status).toBe(422);
      expect(again.body.message).toBe('Solo se puede enviar una transferencia en borrador');
      const edit = await adminA().put(`/api/inventory/transfers/${ids.t1}`, {
        fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.harina, quantity: 1 }],
      });
      expect(edit.status).toBe(422);
      expect(await lots(s.harina)).toEqual(['origin:L1:0', 'origin:L2:5']);
    });

    it('refuses a send above the stock left, all or nothing, in Spanish', async () => {
      const draft = await adminA().post('/api/inventory/transfers', {
        fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.sal, quantity: 1 }, { itemId: s.queso, quantity: 2 }],
      });
      expect(draft.status).toBe(201);
      await adminA().post('/api/inventory/movements/adjust', { itemId: s.sal, locationId: origin, movementType: 'waste', quantity: 1.5 });
      const res = await adminA().post(`/api/inventory/transfers/${draft.body.id}/send`);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Stock insuficiente en la bodega de origen: Sal (disponible 0.500 kg, solicitado 1.000 kg)');
      expect((await adminA().get(`/api/inventory/transfers/${draft.body.id}`)).body.status).toBe('draft');
      expect(await lots(s.queso)).toEqual(['origin:general:4']);
      expect(await movements(draft.body.id)).toEqual([]);
      ids.short = draft.body.id;
    });
  });

  describe('receive', () => {
    it('requires a reason for a shortfall and refuses more than was sent', async () => {
      const t1 = (await adminA().get(`/api/inventory/transfers/${ids.t1}`)).body;
      const noReason = await adminA().post(`/api/inventory/transfers/${ids.t1}/receive`, {
        lines: [{ lineId: lineOf(t1, s.harina), receivedQuantity: 4 }, { lineId: lineOf(t1, s.queso), receivedQuantity: 1 }],
      });
      expect(noReason.status).toBe(422);
      expect(noReason.body.message).toBe('Indica el motivo del faltante de Harina');
      const tooMuch = await adminA().post(`/api/inventory/transfers/${ids.t1}/receive`, {
        lines: [{ lineId: lineOf(t1, s.harina), receivedQuantity: 6 }, { lineId: lineOf(t1, s.queso), receivedQuantity: 1 }],
      });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.message).toBe('No se puede recibir más de lo enviado de Harina (enviado 5.000 kg)');
      const partial = await adminA().post(`/api/inventory/transfers/${ids.t1}/receive`, {
        lines: [{ lineId: lineOf(t1, s.harina), receivedQuantity: 5 }],
      });
      expect(partial.status).toBe(422);
      expect(await lots(s.harina)).toEqual(['origin:L1:0', 'origin:L2:5']);
    });

    it('adds the received quantity at the destination and writes the shortfall off as merma en tránsito', async () => {
      const t1 = (await adminA().get(`/api/inventory/transfers/${ids.t1}`)).body;
      const res = await adminA().post(`/api/inventory/transfers/${ids.t1}/receive`, {
        lines: [
          { lineId: lineOf(t1, s.harina), receivedQuantity: 4, shortfallReason: 'Bolsa rota' },
          { lineId: lineOf(t1, s.queso), receivedQuantity: 1 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'received_short', receivedBy: fixtures.adminA.profileId, receivedByName: 'Admin A' });
      expect(res.body.lines).toEqual([
        expect.objectContaining({ itemName: 'Harina', requestedQuantity: 5, receivedQuantity: 4, shortfallQuantity: 1, shortfallReason: 'Bolsa rota' }),
        expect.objectContaining({ itemName: 'Queso', requestedQuantity: 1, receivedQuantity: 1, shortfallQuantity: 0, shortfallReason: null }),
      ]);
      expect(await lots(s.harina)).toEqual(['barra:L1:4', 'barra:L2:0', 'origin:L1:0', 'origin:L2:5']);
      expect(await stock(s.harina)).toBe(9);
      expect(await stock(s.queso)).toBe(5);
      const waste = (await movements(ids.t1)).filter((m) => m.movement_type === 'waste');
      expect(waste).toEqual([
        { movement_type: 'waste', location_id: s.barra, quantity: '-1.000', reason: 'Bolsa rota', notes: 'Merma en tránsito' },
      ]);
      expect(await expectedInCount(s.barra, s.harina)).toBe(4);

      const ledger = await adminA().get(`/api/inventory/movements?itemId=${s.harina}&types=transfer_in,waste`);
      const label = `TR-${String(t1.number).padStart(4, '0')}`;
      const ofT1 = ledger.body.rows.filter((m: { referenceId: string }) => m.referenceId === ids.t1);
      const sum = (type: string) =>
        ofT1.filter((m: { movementType: string }) => m.movementType === type).reduce((a: number, m: { quantity: number }) => a + m.quantity, 0);
      expect([sum('transfer_in'), sum('waste')]).toEqual([5, -1]);
      for (const m of ofT1) {
        expect(m).toMatchObject({ documentKind: 'inventory_transfer', documentId: ids.t1, documentLabel: label, createdByName: 'Admin A' });
      }
    });

    it('is idempotent: receiving again returns the stored transfer and moves nothing', async () => {
      const before = (await movements(ids.t1)).length;
      const t1 = (await adminA().get(`/api/inventory/transfers/${ids.t1}`)).body;
      const res = await adminA().post(`/api/inventory/transfers/${ids.t1}/receive`, {
        lines: [{ lineId: lineOf(t1, s.harina), receivedQuantity: 5 }, { lineId: lineOf(t1, s.queso), receivedQuantity: 1 }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(t1);
      expect((await movements(ids.t1)).length).toBe(before);
      expect(await stock(s.harina)).toBe(9);
    });

    it('ends a full receipt as received', async () => {
      const draft = await adminA().post('/api/inventory/transfers', {
        fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.queso, quantity: 2 }],
      });
      await adminA().post(`/api/inventory/transfers/${draft.body.id}/send`);
      const res = await adminA().post(`/api/inventory/transfers/${draft.body.id}/receive`, {
        lines: [{ lineId: draft.body.lines[0].id, receivedQuantity: 2 }],
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
      expect(await lots(s.queso)).toEqual(['barra:general:3', 'origin:general:2']);
      ids.full = draft.body.id;
    });
  });

  describe('cancel', () => {
    it('returns an in-transit transfer to the origin', async () => {
      const draft = await adminA().post('/api/inventory/transfers', {
        fromLocationId: origin, toLocationId: s.barra, lines: [{ itemId: s.harina, quantity: 2 }],
      });
      await adminA().post(`/api/inventory/transfers/${draft.body.id}/send`);
      expect(await stock(s.harina)).toBe(7);
      const res = await adminA().post(`/api/inventory/transfers/${draft.body.id}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancelledBy: fixtures.adminA.profileId, cancelledByName: 'Admin A' });
      expect(await lots(s.harina)).toEqual(['barra:L1:4', 'barra:L2:0', 'origin:L1:0', 'origin:L2:5']);
      expect(await stock(s.harina)).toBe(9);
      expect((await movements(draft.body.id)).map((m) => `${m.movement_type}:${m.quantity}`)).toEqual([
        'transfer_in:2.000', 'transfer_out:-2.000',
      ]);
      ids.cancelled = draft.body.id;
    });

    it('cancels a draft and refuses received or cancelled transfers', async () => {
      const draft = await adminA().post(`/api/inventory/transfers/${ids.short}/cancel`);
      expect(draft.status).toBe(200);
      expect(draft.body.status).toBe('cancelled');
      for (const id of [ids.t1, ids.cancelled]) {
        const res = await adminA().post(`/api/inventory/transfers/${id}/cancel`);
        expect(res.status).toBe(422);
        expect(res.body.message).toBe('Solo se puede anular una transferencia en borrador o en tránsito');
      }
      const receive = await adminA().post(`/api/inventory/transfers/${ids.cancelled}/receive`, { lines: [] });
      expect(receive.status).toBe(422);
    });
  });

  describe('reads and isolation', () => {
    it('lists newest first with status, bodega and date filters', async () => {
      const all = await adminA().get('/api/inventory/transfers');
      expect(all.status).toBe(200);
      expect(all.body.map((t: { number: number }) => t.number)).toEqual([4, 3, 2, 1]);
      const cancelled = await adminA().get('/api/inventory/transfers?status=cancelled,received');
      expect(cancelled.body.map((t: { number: number }) => t.number)).toEqual([4, 3, 2]);
      const atBarra = await adminA().get(`/api/inventory/transfers?locationId=${s.barra}&status=received_short`);
      expect(atBarra.body.map((t: { id: string }) => t.id)).toEqual([ids.t1]);
      expect((await adminA().get(`/api/inventory/transfers?locationId=${s.missing}`)).body).toEqual([]);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      expect((await adminA().get(`/api/inventory/transfers?from=${today}&to=${today}`)).body).toHaveLength(4);
      expect((await adminA().get('/api/inventory/transfers?to=2020-01-01')).body).toEqual([]);
      expect((await adminA().get('/api/inventory/transfers?status=lost')).status).toBe(422);
    });

    it('gets one transfer and answers 404 for unknown ids', async () => {
      const res = await adminA().get(`/api/inventory/transfers/${ids.full}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ids.full, status: 'received' });
      expect((await adminA().get(`/api/inventory/transfers/${s.missing}`)).status).toBe(404);
    });

    it('hides the transfers of another restaurant', async () => {
      expect((await adminB().get('/api/inventory/transfers')).body).toEqual([]);
      expect((await adminB().get(`/api/inventory/transfers/${ids.t1}`)).status).toBe(404);
      expect((await adminB().post(`/api/inventory/transfers/${ids.full}/cancel`)).status).toBe(404);
      expect((await waiterA().get('/api/inventory/transfers')).body).toEqual([]);
    });
  });

  describe('single-item transfer', () => {
    it('still moves one item instantly between two bodegas', async () => {
      const res = await adminA().post('/api/inventory/movements/transfer', {
        itemId: s.queso, fromLocationId: origin, toLocationId: s.barra, quantity: 1, notes: 'directo',
      });
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['fromLocationId', 'itemId', 'quantity', 'toLocationId', 'totalCost', 'transferId']);
      expect(await lots(s.queso)).toEqual(['barra:general:4', 'origin:general:1']);
      const [{ count }] = await db<{ count: string }>(
        `SELECT count(*) FROM inventory_movements WHERE reference_type = 'transfer' AND reference_id = $1`,
        [res.body.transferId],
      );
      expect(count).toBe('2');
    });
  });
});
