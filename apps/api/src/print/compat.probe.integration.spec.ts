import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const dish = 'c0a00000-0000-0000-0000-000000000001';
/** F6 verifier probe: without stations every print response and stored payload is the legacy one. */
describe('print payloads without stations (F6 compat)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cookie = '';
  beforeAll(async () => {
    database = await startTestDatabase();
    await superuserQuery(database.superuserUrl, `INSERT INTO dishes (id, name, price, restaurant_id) VALUES ($1, 'Bandeja', 30000, $2)`, [dish, fixtures.restaurantA]);
    app = await createTestApp(database.apiUrl);
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: fixtures.waiterA.email, password: PASSWORD });
    cookie = cookiePair(setCookies(res).vipe_access);
  });
  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('stores exactly the legacy job and answers {id, kind, createdAt}', async () => {
    const out: unknown[] = [];
    const bodies = [
      ['command', '/api/print/commands', { items: [{ id: `${dish}-1700000000000`, name: 'Bandeja', price: 30000, quantity: 2, comments: 'sin cebolla', categoryId: 'x' }, { id: 'custom-1', name: 'Fuera', price: 1, quantity: 1 }], waiter: 'Waiter A', table: 8 }],
      ['command-delivery', '/api/print/commands', { items: [{ name: 'Jugo', quantity: 2 }], waiter: 'Op', table: null, delivery: { customerName: 'Ana', phone: '300', address: 'Calle 1', paymentMode: 'cash_on_delivery', deliveryFee: 4000 } }],
      ['invoice', '/api/print/invoices', { invoice: { invoiceNumber: 'F-100', table: 8, waiter: 'W', bill: { subtotal: 30000, tax: 0, total: 30000 }, businessInfo: { name: 'R' } }, displayItems: [{ name: 'Bandeja', quantity: 1, price: 30000 }] }],
      ['bad-command', '/api/print/commands', { items: [], waiter: 'W' }],
    ] as const;
    for (const [label, url, body] of bodies) {
      await superuserQuery(database.superuserUrl, 'DELETE FROM print_jobs');
      const res = await request(app.getHttpServer()).post(url).set('Cookie', cookie).send(body);
      const jobs = await superuserQuery<{ id: string; kind: string; payload: Record<string, unknown>; printed_at: unknown }>(
        database.superuserUrl, 'SELECT id, kind, payload, printed_at FROM print_jobs ORDER BY created_at, id');
      const norm = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll(String(res.body.id), '<jobid>'));
      out.push({
        label, status: res.status, keys: Object.keys(res.body).sort(), kind: res.body.kind, idIsUuid: /^[0-9a-f-]{36}$/.test(String(res.body.id)),
        errorBody: res.status >= 400 ? res.body : undefined,
        jobs: jobs.map((j) => ({ idIsResponse: j.id === res.body.id, kind: j.kind, payloadText: JSON.stringify(norm(j.payload)), printed: j.printed_at })),
      });
    }
    const legacy = { keys: ['createdAt', 'id', 'kind'], idIsUuid: true, errorBody: undefined };
    expect(out.map((o) => (o as { label: string }).label)).toEqual(['command', 'command-delivery', 'invoice', 'bad-command']);
    for (const [index, kind] of ['command', 'command', 'invoice'].entries()) {
      const [, , body] = bodies[index];
      const expected = kind === 'command' ? { invoiceNumber: '<jobid>', ...body } : { invoiceNumber: 'F-100', ...body };
      expect(out[index]).toMatchObject({ status: 201, kind, ...legacy, jobs: [{ idIsResponse: true, kind, printed: null }] });
      const [job] = (out[index] as { jobs: { payloadText: string }[] }).jobs;
      expect(JSON.parse(job.payloadText)).toEqual(expected);
    }
    expect(out[3]).toMatchObject({ status: 422, jobs: [] });
  });
});
