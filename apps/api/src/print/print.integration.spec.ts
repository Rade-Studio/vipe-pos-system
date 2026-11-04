import { Controller, type INestApplication, Post, Query } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../db/unit-of-work';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

interface PrintJobEvent {
  id: string;
  kind: 'invoice' | 'command';
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

const COMMAND = {
  items: [{ name: 'Ajiaco', quantity: 2, comments: 'sin alcaparras' }],
  waiter: 'Waiter A',
  table: 4,
};

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

describe('printing bridge (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
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

      const res = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(COMMAND);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ kind: 'command' });
      const jobId = (res.body as { id: string }).id;

      await eventually(() => printerA.jobs.length >= 1);
      await settle();
      expect(printerA.jobs).toEqual([
        { id: jobId, kind: 'command', payload: { invoiceNumber: jobId, ...COMMAND }, createdAt: (res.body as { createdAt: string }).createdAt },
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
      const body = { items: [{ name: 'Ajiaco', quantity: 1 }], waiter: 'Domicilios', table: null, delivery };
      const res = await http().post('/api/print/commands').set(as(fixtures.adminA.email)).send(body);
      expect(res.status).toBe(201);
      await eventually(() => printer.jobs.length >= 1);
      expect(printer.jobs[0].payload).toEqual({ invoiceNumber: (res.body as { id: string }).id, ...body });
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

  describe('print jobs', () => {
    it('keeps jobs created while offline pending for the restaurant, and ack is idempotent', async () => {
      const printerA = await createPrinter(fixtures.adminA.email, 'Offline A');
      const printerB = await createPrinter(fixtures.adminB.email, 'Offline B');
      const created = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(COMMAND);
      const jobId = (created.body as { id: string }).id;

      const pendingA = await http().get('/api/print/jobs/pending').set(bearer(printerA.token));
      expect(pendingA.status).toBe(200);
      const job = (pendingA.body as PrintJobEvent[]).find((pending) => pending.id === jobId);
      expect(job).toMatchObject({ id: jobId, kind: 'command', payload: { invoiceNumber: jobId, ...COMMAND } });
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
        ids.push(((await http().post('/api/print/commands').set(as(fixtures.adminB.email)).send(COMMAND)).body as { id: string }).id);
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

    it('stores waiter and item text verbatim (validation does not trim)', async () => {
      const body = { items: [{ name: ' Ajiaco ', quantity: 1 }], waiter: ' Ana ', table: 2 };
      const res = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(body);
      expect(res.status).toBe(201);
      const [row] = await superuserQuery<{ payload: Record<string, unknown> }>(
        database.superuserUrl,
        'SELECT payload FROM public.print_jobs WHERE id = $1',
        [(res.body as { id: string }).id],
      );
      expect(row.payload).toEqual({ invoiceNumber: (res.body as { id: string }).id, ...body });
      expect((await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send({ ...body, waiter: '   ' })).status).toBe(422);
    });

    it('printer routes need a bearer token and refuse the web cookie', async () => {
      expect((await http().get('/api/print/jobs/pending')).status).toBe(401);
      expect((await http().get('/api/print/jobs/pending').set(bearer('vpt_unknown'))).status).toBe(401);
      expect((await http().get('/api/print/jobs/pending').set(as(fixtures.adminA.email))).status).toBe(401);
      const printer = await createPrinter(fixtures.adminA.email, 'Bad id');
      expect((await http().post('/api/print/jobs/not-a-uuid/ack').set(bearer(printer.token))).status).toBe(422);
    });

    it('needs a session to enqueue and validates the payloads', async () => {
      expect((await http().post('/api/print/commands').send(COMMAND)).status).toBe(401);
      const send = (path: string, body: unknown) => http().post(path).set(as(fixtures.waiterA.email)).send(body as object);
      expect((await send('/api/print/commands', { ...COMMAND, items: [] })).status).toBe(422);
      expect((await send('/api/print/commands', { ...COMMAND, waiter: '' })).status).toBe(422);
      expect((await send('/api/print/commands', { ...COMMAND, invoiceNumber: '1234' })).status).toBe(422);
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
