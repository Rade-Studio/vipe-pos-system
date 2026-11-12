import { Controller, type INestApplication, Post, Query } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTING_HEADER } from '../auth/terminal-access';
import { UnitOfWork } from '../db/unit-of-work';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

interface PrintJobEvent {
  id: string;
  kind: 'invoice' | 'command' | 'x_report';
  payload: Record<string, unknown>;
  createdAt: string;
}

interface Listener {
  socket: Socket;
  jobs: PrintJobEvent[];
  changes: unknown[];
}

/** Poll until `check` holds or fail after `timeoutMs`. */
async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const effects: string[] = [];

/** Spec-only route: registers an after-commit effect, then commits or throws. */
@Controller('probe/after-commit')
class AfterCommitProbe {
  constructor(private readonly uow: UnitOfWork) {}

  @Post()
  run(@Query('fail') fail?: string): { ok: true } {
    this.uow.afterCommit(() => effects.push(fail ? 'after rollback' : 'after commit'));
    if (fail) {
      throw new Error('boom');
    }
    return { ok: true };
  }
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

interface OrderRef {
  id: string;
  number: number;
}

/** The fixture orders have no table, so the sent table is kept. */
const COMMAND = {
  items: [{ name: 'Ajiaco', quantity: 2, comments: 'sin alcaparras' }],
  waiter: 'Client name',
  table: 4,
};
const { waiter: _clientWaiter, ...COMMAND_LINES } = COMMAND;

const INVOICE = {
  invoice: {
    invoiceNumber: 'F-0001',
    date: '2026-11-04T15:00:00.000Z',
    businessInfo: { name: 'Restaurant A', address: 'Calle 1', phone: '300', nit: '900' },
    items: [{ id: 'd-1', name: 'Ajiaco', price: 28000, quantity: 1 }],
    bill: { subtotal: 28000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 28000, totalDiscounts: 0 },
    waiter: 'Waiter A',
    table: 4,
    paymentMethod: 'cash',
    cashReceived: 30000,
    cashChange: 2000,
  },
  displayItems: [{ id: 'd-1', name: 'Ajiaco', price: 28000, quantity: 1 }],
};

/** informe-x-termico S1: GET /registers/summary as it answered, plus the header and the times. */
const X_REPORT = {
  business: { name: 'Restaurant A', nit: '900', address: 'Calle 1' },
  cashierName: 'Waiter A',
  openedAt: '2026-11-10T07:58:00.000-05:00',
  printedAt: '2026-11-10T13:30:00.000-05:00',
  tax: { type: 'INC', rate: 8 },
  summary: {
    registersCount: 1,
    initialCash: 200000,
    paymentsCount: 39,
    totalBilled: 1604900,
    totalTips: 118700,
    totalSales: 1486200,
    totalChange: 0,
    methods: [
      { paymentMethodId: 'm-1', code: 'cash', name: 'Efectivo', kind: 'cash', sortOrder: 0, isActive: true, total: 584000, tendersCount: 15 },
    ],
    cashDeposits: 50000,
    cashWithdrawals: 45000,
    expectedCash: 789000,
    tipsPayout: 0,
    expectedCashAfterTips: 789000,
    legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
  },
};

describe('printing bridge (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];
  const cookies: Record<string, string> = {};
  let orderA: OrderRef;
  let orderB: OrderRef;
  /** The request body for an order (orderId plus COMMAND). */
  const command = (order: OrderRef) => ({ orderId: order.id, ...COMMAND });
  /** The stored payload: the server's waiter and orderNumber, never the client's waiter. */
  const stored = (id: string, waiter: string, order: OrderRef) => ({ invoiceNumber: id, ...COMMAND_LINES, waiter, orderNumber: order.number });

  beforeAll(async () => {
    database = await startTestDatabase();
    const first = async (restaurantId: string) => {
      const [row] = await superuserQuery<{ id: string; order_number: number }>(
        database.superuserUrl,
        'SELECT id, order_number FROM public.orders WHERE restaurant_id = $1 ORDER BY order_number LIMIT 1',
        [restaurantId],
      );
      return { id: row.id, number: row.order_number };
    };
    orderA = await first(fixtures.restaurantA);
    orderB = await first(fixtures.restaurantB);
    app = await createTestApp(database.apiUrl, [AfterCommitProbe]);
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/realtime`.replace('[::1]', '127.0.0.1');
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app?.close();
    await database?.stop();
  });

  const http = () => request(app.getHttpServer());
  const as = (email: string) => ({ Cookie: cookies[email] });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createPrinter = async (email: string, name: string): Promise<{ id: string; token: string }> => {
    const res = await http().post('/api/devices/printers').set(as(email)).send({ name });
    expect(res.status).toBe(201);
    return res.body as { id: string; token: string };
  };

  const listen = (socket: Socket): Listener => {
    const listener: Listener = { socket, jobs: [], changes: [] };
    socket.on('print_job', (job: PrintJobEvent) => listener.jobs.push(job));
    socket.on('pos_changes', (event: unknown) => listener.changes.push(event));
    sockets.push(socket);
    return listener;
  };

  /** A printing-service socket: `auth: {token}`, no cookie. Resolves on `ready`. */
  const connectPrinter = async (token: string): Promise<Listener & { ready: { restaurantId: string } }> => {
    const listener = listen(io(url, { transports: ['websocket'], reconnection: false, auth: { token } }));
    const ready = await new Promise<{ restaurantId: string }>((resolve, reject) => {
      listener.socket.once('ready', resolve);
      listener.socket.once('connect_error', reject);
    });
    return Object.assign(listener, { ready });
  };

  const connectWeb = async (email: string): Promise<Listener> => {
    const listener = listen(
      io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: cookies[email] } }),
    );
    await new Promise((resolve, reject) => {
      listener.socket.once('ready', resolve);
      listener.socket.once('connect_error', reject);
    });
    return listener;
  };

  const refusal = (socket: Socket) =>
    new Promise<string>((resolve) => {
      socket.once('connect_error', (error: Error) => resolve(error.message));
      socket.once('ready', () => resolve('admitted'));
    });

  describe('devices/printers', () => {
    it('returns the plaintext token once and never lists it', async () => {
      const created = await createPrinter(fixtures.adminA.email, 'Cocina');
      expect(created).toMatchObject({ name: 'Cocina', revokedAt: null, lastSeenAt: null });
      expect(created.token).toMatch(/^vpt_[A-Za-z0-9_-]{43}$/);

      const list = await http().get('/api/devices/printers').set(as(fixtures.adminA.email));
      expect(list.status).toBe(200);
      const listed = (list.body as Record<string, unknown>[]).find((printer) => printer.id === created.id);
      expect(Object.keys(listed!).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'name', 'revokedAt']);

      const other = await http().get('/api/devices/printers').set(as(fixtures.adminB.email));
      expect((other.body as { id: string }[]).map((printer) => printer.id)).not.toContain(created.id);
    });

    it('is admin only and validates the name', async () => {
      const waiter = await http().post('/api/devices/printers').set(as(fixtures.waiterA.email)).send({ name: 'X' });
      expect(waiter.status).toBe(403);
      const list = await http().get('/api/devices/printers').set(as(fixtures.waiterA.email));
      expect(list.status).toBe(403);
      const blank = await http().post('/api/devices/printers').set(as(fixtures.adminA.email)).send({ name: '' });
      expect(blank.status).toBe(422);
      const extra = await http()
        .post('/api/devices/printers')
        .set(as(fixtures.adminA.email))
        .send({ name: 'X', restaurantId: fixtures.restaurantB });
      expect(extra.status).toBe(422);
    });

    it('answers 404 for a printer of another restaurant', async () => {
      const printer = await createPrinter(fixtures.adminB.email, 'Caja B');
      const res = await http().delete(`/api/devices/printers/${printer.id}`).set(as(fixtures.adminA.email));
      expect(res.status).toBe(404);
    });
  });

  describe('printer sockets', () => {
    it('admits a token into its restaurant only and refuses unknown tokens', async () => {
      const printer = await createPrinter(fixtures.adminA.email, 'Barra');
      const socket = await connectPrinter(printer.token);
      expect(socket.ready).toEqual({ restaurantId: fixtures.restaurantA });

      const [row] = await superuserQuery<{ last_seen_at: Date | null }>(
        database.superuserUrl,
        'SELECT last_seen_at FROM public.printer_tokens WHERE id = $1',
        [printer.id],
      );
      expect(row.last_seen_at).not.toBeNull();

      const unknown = io(url, { transports: ['websocket'], reconnection: false, auth: { token: 'vpt_unknown' } });
      sockets.push(unknown);
      expect(await refusal(unknown)).toBe('unauthorized');
      socket.socket.close();
    });

    it('delivers a job of A to A printers only, never to B printers nor to web sockets', async () => {
      const printerA = await connectPrinter((await createPrinter(fixtures.adminA.email, 'Cocina A')).token);
      const printerB = await connectPrinter((await createPrinter(fixtures.adminB.email, 'Cocina B')).token);
      const webA = await connectWeb(fixtures.waiterA.email);

      const res = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(command(orderA));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ kind: 'command' });
      const jobId = (res.body as { id: string }).id;

      await eventually(() => printerA.jobs.length >= 1);
      await settle();
      expect(printerA.jobs).toEqual([
        { id: jobId, kind: 'command', payload: stored(jobId, 'Waiter A', orderA), createdAt: (res.body as { createdAt: string }).createdAt },
      ]);
      expect(printerB.jobs).toEqual([]);
      expect(webA.jobs).toEqual([]);

      // A printer socket is not in the restaurant room: a real table change of A
      // reaches the cookie socket and never the printer.
      await superuserQuery(
        database.superuserUrl,
        "INSERT INTO public.tables (number, status, restaurant_id) VALUES (871, 'available', $1)",
        [fixtures.restaurantA],
      );
      await eventually(() => webA.changes.length >= 1);
      await settle();
      expect(webA.changes).toEqual([expect.objectContaining({ table: 'tables', eventType: 'INSERT' })]);
      expect(printerA.changes).toEqual([]);

      printerA.socket.close();
      printerB.socket.close();
      webA.socket.close();
    });

    it('sends invoices with the broadcast payload shape the renderer reads', async () => {
      const printer = await connectPrinter((await createPrinter(fixtures.adminA.email, 'Facturas')).token);
      const res = await http().post('/api/print/invoices').set(as(fixtures.adminA.email)).send(INVOICE);
      expect(res.status).toBe(201);
      await eventually(() => printer.jobs.length >= 1);
      expect(printer.jobs[0]).toEqual({
        id: (res.body as { id: string }).id,
        kind: 'invoice',
        payload: { invoiceNumber: 'F-0001', ...INVOICE },
        createdAt: (res.body as { createdAt: string }).createdAt,
      });
      printer.socket.close();
    });

    it('a delivery command keeps table null and the delivery block', async () => {
      const printer = await connectPrinter((await createPrinter(fixtures.adminA.email, 'Domicilios')).token);
      const delivery = { customerName: 'Ana', phone: '3001', address: 'Calle 2', paymentMode: 'prepaid', deliveryFee: 5000 };
      const body = { items: [{ name: 'Ajiaco', quantity: 1 }], table: null, delivery };
      const res = await http().post('/api/print/commands').set(as(fixtures.adminA.email)).send({ orderId: orderA.id, ...body });
      expect(res.status).toBe(201);
      await eventually(() => printer.jobs.length >= 1);
      expect(printer.jobs[0].payload).toEqual({ invoiceNumber: (res.body as { id: string }).id, ...body, waiter: 'Admin A', orderNumber: orderA.number });
      printer.socket.close();
    });

    it('a revoked token is refused and its live socket is disconnected', async () => {
      const printer = await createPrinter(fixtures.adminA.email, 'Revocada');
      const live = await connectPrinter(printer.token);
      const disconnected = new Promise<void>((resolve) => live.socket.once('disconnect', () => resolve()));

      const res = await http().delete(`/api/devices/printers/${printer.id}`).set(as(fixtures.adminA.email));
      expect(res.status).toBe(204);
      await disconnected;

      const again = io(url, { transports: ['websocket'], reconnection: false, auth: { token: printer.token } });
      sockets.push(again);
      expect(await refusal(again)).toBe('unauthorized');
      const pending = await http().get('/api/print/jobs/pending').set(bearer(printer.token));
      expect(pending.status).toBe(401);
      const repeat = await http().delete(`/api/devices/printers/${printer.id}`).set(as(fixtures.adminA.email));
      expect(repeat.status).toBe(204);
    });
  });

  it('runs after-commit effects only when the request transaction commits', async () => {
    expect((await http().post('/api/probe/after-commit').set(as(fixtures.waiterA.email))).status).toBe(201);
    expect((await http().post('/api/probe/after-commit?fail=1').set(as(fixtures.waiterA.email))).status).toBe(500);
    expect(effects).toEqual(['after commit']);
  });

  describe('comanda header: server-filled waiter and order number (S1-S3)', () => {
    const jobPayload = async (id: string) =>
      (await superuserQuery<{ payload: Record<string, unknown> }>(database.superuserUrl, 'SELECT payload FROM public.print_jobs WHERE id = $1', [id]))[0]
        .payload;
    const jobCount = async () =>
      Number((await superuserQuery<{ n: string }>(database.superuserUrl, 'SELECT count(*) AS n FROM public.print_jobs'))[0].n);

    it('refuses a missing orderId (422) and an order of another restaurant or unknown (404), queuing nothing', async () => {
      const before = await jobCount();
      const send = (body: object) => http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(body);
      expect((await send(COMMAND)).status).toBe(422);
      expect((await send({ ...COMMAND, orderId: 'nope' })).status).toBe(422);
      const foreign = await send(command(orderB));
      expect(foreign.status).toBe(404);
      expect(foreign.body).toMatchObject({ message: 'Order not found' });
      expect((await send({ ...COMMAND, orderId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
      expect(await jobCount()).toBe(before);
    });

    it("prints the PIN-identified person's name on a shared terminal", async () => {
      expect((await http().put(`/api/staff/${fixtures.waiterA.profileId}/pin`).set(as(fixtures.adminA.email)).send({ pin: '4829' })).status).toBe(204);
      const login = await http().post('/api/auth/terminal/login').send({ email: fixtures.adminA.email, password: PASSWORD });
      const terminal = cookiePair(setCookies(login).vipe_access);
      const identified = await http().post('/api/auth/identify').set('Cookie', terminal).send({ pin: '4829' });
      expect(identified.status).toBe(200);
      const res = await http()
        .post('/api/print/commands')
        .set('Cookie', terminal)
        .set(ACTING_HEADER, identified.body.token as string)
        .send(command(orderA));
      expect(res.status).toBe(201);
      expect(await jobPayload(res.body.id as string)).toEqual(stored(res.body.id as string, 'Waiter A', orderA));
    });

    it("takes the order's table, and falls back to the order's waiter, then Mesero, when the sender has no name", async () => {
      const [table] = await superuserQuery<{ id: string }>(
        database.superuserUrl,
        "INSERT INTO public.tables (number, status, restaurant_id) VALUES (61, 'available', $1) RETURNING id",
        [fixtures.restaurantA],
      );
      const [order] = await superuserQuery<{ id: string; order_number: number }>(
        database.superuserUrl,
        `INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total, restaurant_id, table_id, waiter_id)
         VALUES ('active', 10, 0, 0, 10, $1, $2, $3) RETURNING id, order_number`,
        [fixtures.restaurantA, table.id, fixtures.waiterA.profileId],
      );
      const ref = { id: order.id, number: order.order_number };
      const send = async () => {
        const res = await http().post('/api/print/commands').set(as(fixtures.adminA.email)).send(command(ref));
        expect(res.status).toBe(201);
        return jobPayload(res.body.id as string);
      };
      expect(await send()).toMatchObject({ waiter: 'Admin A', table: 61, orderNumber: order.order_number });
      const rename = (id: string, name: string) =>
        superuserQuery(database.superuserUrl, 'UPDATE public.profiles SET full_name = $2 WHERE id = $1', [id, name]);
      try {
        await rename(fixtures.adminA.profileId, '  ');
        expect(await send()).toMatchObject({ waiter: 'Waiter A', table: 61 });
        await rename(fixtures.waiterA.profileId, ' ');
        expect(await send()).toMatchObject({ waiter: 'Mesero', table: 61 });
      } finally {
        await rename(fixtures.adminA.profileId, 'Admin A');
        await rename(fixtures.waiterA.profileId, 'Waiter A');
      }
    });

    it('still sends one job per station, each with the order number and its station', async () => {
      const q = (text: string, values: unknown[] = []) => superuserQuery<{ id: string }>(database.superuserUrl, text, values);
      const B = fixtures.restaurantB;
      const [cocina] = await q(`INSERT INTO stations (name, sort_order, is_default, restaurant_id) VALUES ('Cocina', 0, true, $1) RETURNING id`, [B]);
      const [bar] = await q(`INSERT INTO stations (name, sort_order, restaurant_id) VALUES ('Bar', 1, $1) RETURNING id`, [B]);
      const [dish] = await q(`INSERT INTO dishes (name, price, station_id, restaurant_id) VALUES ('Gaseosa', 5000, $1, $2) RETURNING id`, [bar.id, B]);
      try {
        const items = [{ id: 'custom-1', name: 'Ajiaco', quantity: 1 }, { id: `${dish.id}-1700000000000`, name: 'Gaseosa', quantity: 2 }];
        const res = await http().post('/api/print/commands').set(as(fixtures.adminB.email)).send({ orderId: orderB.id, items, table: 3 });
        expect(res.status).toBe(201);
        const jobs = res.body.jobs as { id: string }[];
        expect(jobs).toHaveLength(2);
        expect(await jobPayload(jobs[0].id)).toEqual({
          invoiceNumber: jobs[0].id, items: [items[0]], table: 3, waiter: 'Admin B', orderNumber: orderB.number, station: { id: cocina.id, name: 'Cocina' },
        });
        expect(await jobPayload(jobs[1].id)).toEqual({
          invoiceNumber: jobs[1].id, items: [items[1]], table: 3, waiter: 'Admin B', orderNumber: orderB.number, station: { id: bar.id, name: 'Bar' },
        });
      } finally {
        await q('DELETE FROM print_jobs WHERE station_id IS NOT NULL');
        await q('DELETE FROM dishes WHERE id = $1', [dish.id]);
        await q('DELETE FROM stations WHERE restaurant_id = $1', [B]);
      }
    });

    it('a restaurant that turned printing off still answers 409 and queues nothing', async () => {
      const before = await jobCount();
      await superuserQuery(database.superuserUrl, "INSERT INTO business_config (key, value, restaurant_id) VALUES ('printing_enabled', 'false', $1)", [
        fixtures.restaurantA,
      ]);
      try {
        const res = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(command(orderA));
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'printing_disabled' });
        expect(await jobCount()).toBe(before);
      } finally {
        await superuserQuery(database.superuserUrl, "DELETE FROM business_config WHERE key = 'printing_enabled'");
      }
    });
  });

  describe('Informe X (informe-x-termico S1)', () => {
    const jobCount = async () =>
      Number((await superuserQuery<{ n: string }>(database.superuserUrl, 'SELECT count(*) AS n FROM public.print_jobs'))[0].n);

    it('queues an x_report job with the summary exactly as sent, for any session, and validates it', async () => {
      const printer = await connectPrinter((await createPrinter(fixtures.adminA.email, 'Informe X')).token);
      const res = await http().post('/api/print/x-reports').set(as(fixtures.waiterA.email)).send(X_REPORT);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ kind: 'x_report' });
      await eventually(() => printer.jobs.some((job) => job.id === (res.body as { id: string }).id));
      const job = printer.jobs.find((candidate) => candidate.id === (res.body as { id: string }).id);
      expect(job).toEqual({ id: (res.body as { id: string }).id, kind: 'x_report', payload: X_REPORT, createdAt: (res.body as { createdAt: string }).createdAt });
      printer.socket.close();

      const before = await jobCount();
      expect((await http().post('/api/print/x-reports').send(X_REPORT)).status).toBe(401);
      const send = (body: unknown) => http().post('/api/print/x-reports').set(as(fixtures.waiterA.email)).send(body as object);
      expect((await send({ ...X_REPORT, summary: { ...X_REPORT.summary, totalSales: 'mucho' } })).status).toBe(422);
      expect((await send({ ...X_REPORT, printedAt: 'ayer' })).status).toBe(422);
      expect((await send({ ...X_REPORT, tax: { type: 'IVA', rate: 101 } })).status).toBe(422);
      expect((await send({ ...X_REPORT, extra: true })).status).toBe(422);
      expect(await jobCount()).toBe(before);
    });

    it('a restaurant that turned printing off answers 409 and queues nothing', async () => {
      const before = await jobCount();
      await superuserQuery(database.superuserUrl, "INSERT INTO business_config (key, value, restaurant_id) VALUES ('printing_enabled', 'false', $1)", [
        fixtures.restaurantA,
      ]);
      try {
        const res = await http().post('/api/print/x-reports').set(as(fixtures.waiterA.email)).send(X_REPORT);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'printing_disabled' });
        expect(await jobCount()).toBe(before);
      } finally {
        await superuserQuery(database.superuserUrl, "DELETE FROM business_config WHERE key = 'printing_enabled'");
      }
    });
  });

  describe('print jobs', () => {
    it('keeps jobs created while offline pending for the restaurant, and ack is idempotent', async () => {
      const printerA = await createPrinter(fixtures.adminA.email, 'Offline A');
      const printerB = await createPrinter(fixtures.adminB.email, 'Offline B');
      const created = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(command(orderA));
      const jobId = (created.body as { id: string }).id;

      const pendingA = await http().get('/api/print/jobs/pending').set(bearer(printerA.token));
      expect(pendingA.status).toBe(200);
      const job = (pendingA.body as PrintJobEvent[]).find((pending) => pending.id === jobId);
      expect(job).toMatchObject({ id: jobId, kind: 'command', payload: stored(jobId, 'Waiter A', orderA) });
      expect(typeof (job as unknown as { createdAt: string }).createdAt).toBe('string');

      const pendingB = await http().get('/api/print/jobs/pending').set(bearer(printerB.token));
      expect((pendingB.body as PrintJobEvent[]).map((pending) => pending.id)).not.toContain(jobId);

      // B's printer cannot acknowledge A's job.
      const foreign = await http().post(`/api/print/jobs/${jobId}/ack`).set(bearer(printerB.token));
      expect(foreign.status).toBe(404);

      const first = await http().post(`/api/print/jobs/${jobId}/ack`).set(bearer(printerA.token));
      expect(first.status).toBe(204);
      const [{ printed_at: printedAt }] = await superuserQuery<{ printed_at: Date }>(
        database.superuserUrl,
        'SELECT printed_at FROM public.print_jobs WHERE id = $1',
        [jobId],
      );
      const second = await http().post(`/api/print/jobs/${jobId}/ack`).set(bearer(printerA.token));
      expect(second.status).toBe(204);
      const [after] = await superuserQuery<{ printed_at: Date; printer_token_id: string }>(
        database.superuserUrl,
        'SELECT printed_at, printer_token_id FROM public.print_jobs WHERE id = $1',
        [jobId],
      );
      expect(after).toEqual({ printed_at: printedAt, printer_token_id: printerA.id });

      const pendingAfter = await http().get('/api/print/jobs/pending').set(bearer(printerA.token));
      expect((pendingAfter.body as PrintJobEvent[]).map((pending) => pending.id)).not.toContain(jobId);
    });

    it('pages pending jobs with ?after=<job id>', async () => {
      const printer = await createPrinter(fixtures.adminB.email, 'Paging B');
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(((await http().post('/api/print/commands').set(as(fixtures.adminB.email)).send(command(orderB))).body as { id: string }).id);
      }
      const all = (await http().get('/api/print/jobs/pending').set(bearer(printer.token))).body as PrintJobEvent[];
      const start = all.findIndex((job) => job.id === ids[0]);
      expect(all.slice(start).map((job) => job.id)).toEqual(ids);

      const after = await http().get(`/api/print/jobs/pending?after=${ids[0]}`).set(bearer(printer.token));
      expect(after.status).toBe(200);
      expect((after.body as PrintJobEvent[]).map((job) => job.id)).toEqual(ids.slice(1));
      expect((await http().get('/api/print/jobs/pending?after=nope').set(bearer(printer.token))).status).toBe(422);
      expect((await http().get('/api/print/jobs/pending?other=1').set(bearer(printer.token))).status).toBe(422);
    });

    it('stores item text verbatim (validation does not trim) and ignores the sent waiter', async () => {
      const body = { items: [{ name: ' Ajiaco ', quantity: 1 }], table: 2 };
      const res = await http()
        .post('/api/print/commands')
        .set(as(fixtures.waiterA.email))
        .send({ orderId: orderA.id, ...body, waiter: '   ' });
      expect(res.status).toBe(201);
      const [row] = await superuserQuery<{ payload: Record<string, unknown> }>(
        database.superuserUrl,
        'SELECT payload FROM public.print_jobs WHERE id = $1',
        [(res.body as { id: string }).id],
      );
      expect(row.payload).toEqual({ invoiceNumber: (res.body as { id: string }).id, ...body, waiter: 'Waiter A', orderNumber: orderA.number });
    });

    it('printer routes need a bearer token and refuse the web cookie', async () => {
      expect((await http().get('/api/print/jobs/pending')).status).toBe(401);
      expect((await http().get('/api/print/jobs/pending').set(bearer('vpt_unknown'))).status).toBe(401);
      expect((await http().get('/api/print/jobs/pending').set(as(fixtures.adminA.email))).status).toBe(401);
      const printer = await createPrinter(fixtures.adminA.email, 'Bad id');
      expect((await http().post('/api/print/jobs/not-a-uuid/ack').set(bearer(printer.token))).status).toBe(422);
    });

    it('needs a session to enqueue and validates the payloads', async () => {
      expect((await http().post('/api/print/commands').send(command(orderA))).status).toBe(401);
      const send = (path: string, body: unknown) => http().post(path).set(as(fixtures.waiterA.email)).send(body as object);
      expect((await send('/api/print/commands', { ...command(orderA), items: [] })).status).toBe(422);
      expect((await send('/api/print/commands', { ...command(orderA), invoiceNumber: '1234' })).status).toBe(422);
      expect((await send('/api/print/commands', { ...command(orderA), orderNumber: 1 })).status).toBe(422);
      expect((await send('/api/print/invoices', { displayItems: [] })).status).toBe(422);
      expect((await send('/api/print/invoices', { ...INVOICE, invoice: { ...INVOICE.invoice, invoiceNumber: '' } })).status).toBe(422);
      const [{ count }] = await superuserQuery<{ count: string }>(
        database.superuserUrl,
        "SELECT count(*) FROM public.print_jobs WHERE payload->>'waiter' = ''",
      );
      expect(count).toBe('0');
    });

    it('prunes jobs older than 7 days when the API starts', async () => {
      const [old] = await superuserQuery<{ id: string }>(
        database.superuserUrl,
        `INSERT INTO public.print_jobs (restaurant_id, kind, payload, created_at)
         VALUES ($1, 'command', '{}', now() - interval '8 days') RETURNING id`,
        [fixtures.restaurantA],
      );
      const restarted = await createTestApp(database.apiUrl);
      await restarted.close();
      const rows = await superuserQuery(database.superuserUrl, 'SELECT 1 FROM public.print_jobs WHERE id = $1', [old.id]);
      expect(rows).toEqual([]);
    });
  });
});
