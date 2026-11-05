import { createHash, randomUUID } from 'node:crypto';
import { Controller, type INestApplication, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';
import { PrintService } from './print.service';

/**
 * Probes of the T8c independent verification, kept as a regression spec:
 * P1 token precedence, P2 isolation both ways, P3 rollback after enqueue,
 * P4 a throwing after-commit effect, P5 the pending cap, P6 edge routes.
 */

const COMMAND = { items: [{ name: 'Ajiaco', quantity: 1 }], waiter: 'Probe', table: 1 };

/** Spec-only route: enqueues a command, then fails the request transaction. */
@Controller('probe/enqueue-then-fail')
class EnqueueThenFail {
  constructor(private readonly refs: ModuleRef) {}

  @Post()
  async run(): Promise<void> {
    await this.refs.get(PrintService, { strict: false }).printCommand({ ...COMMAND, waiter: 'rolled back' });
    throw new Error('fail after enqueue');
  }
}

async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

describe('printing bridge verifier probes (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl, [EnqueueThenFail]);
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
  const printerToken = async (email: string) =>
    ((await http().post('/api/devices/printers').set(as(email)).send({ name: 'Probe' })).body as { token: string }).token;

  /** Open a socket and resolve with `ready`'s restaurant or the refusal message. */
  const handshake = (options: Parameters<typeof io>[1]) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, ...options });
    sockets.push(socket);
    const jobs: unknown[] = [];
    socket.on('print_job', (job: unknown) => jobs.push(job));
    const outcome = new Promise<string>((resolve) => {
      socket.once('ready', (data: { restaurantId: string }) => resolve(data.restaurantId));
      socket.once('connect_error', (error: Error) => resolve(error.message));
    });
    return { socket, jobs, outcome };
  };

  it('P1: a token decides the identity; bogus tokens are refused even with a valid cookie', async () => {
    const tokenB = await printerToken(fixtures.adminB.email);
    // Cookie of A plus token of B: the token wins, the socket is B's printer.
    const both = handshake({ auth: { token: tokenB }, extraHeaders: { Cookie: cookies[fixtures.adminA.email] } });
    expect(await both.outcome).toBe(fixtures.restaurantB);
    for (const token of ['vpt_bogus', 'not-a-printer-token', '', 42, { token: 'x' }, 'vpt_'.padEnd(400, 'x')]) {
      const attempt = handshake({ auth: { token }, extraHeaders: { Cookie: cookies[fixtures.adminA.email] } });
      expect(await attempt.outcome, String(token)).toBe('unauthorized');
    }
  });

  it('P2: jobs never cross restaurants, in either direction', async () => {
    const a = handshake({ auth: { token: await printerToken(fixtures.adminA.email) } });
    const b = handshake({ auth: { token: await printerToken(fixtures.adminB.email) } });
    expect(await a.outcome).toBe(fixtures.restaurantA);
    expect(await b.outcome).toBe(fixtures.restaurantB);
    await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(COMMAND).expect(201);
    await http().post('/api/print/commands').set(as(fixtures.adminB.email)).send(COMMAND).expect(201);
    await eventually(() => a.jobs.length >= 1 && b.jobs.length >= 1);
    await settle();
    expect(a.jobs).toHaveLength(1);
    expect(b.jobs).toHaveLength(1);
  });

  it('P3: a request that rolls back after enqueueing stores and emits nothing', async () => {
    const a = handshake({ auth: { token: await printerToken(fixtures.adminA.email) } });
    await a.outcome;
    expect((await http().post('/api/probe/enqueue-then-fail').set(as(fixtures.waiterA.email))).status).toBe(500);
    await settle();
    expect(a.jobs).toEqual([]);
    const rows = await superuserQuery(database.superuserUrl, "SELECT 1 FROM public.print_jobs WHERE payload->>'waiter' = 'rolled back'");
    expect(rows).toEqual([]);
  });

  it('P4: a throwing after-commit emit still answers 201 and keeps the job pending', async () => {
    const gateway = app.get(RealtimeGateway, { strict: false });
    const spy = vi.spyOn(gateway, 'emitPrintJob').mockImplementationOnce(() => {
      throw new Error('socket layer down');
    });
    const res = await http().post('/api/print/commands').set(as(fixtures.waiterA.email)).send(COMMAND);
    spy.mockRestore();
    expect(res.status).toBe(201);
    const pending = await http().get('/api/print/jobs/pending').set(bearer(await printerToken(fixtures.adminA.email)));
    expect((pending.body as { id: string }[]).map((job) => job.id)).toContain((res.body as { id: string }).id);
  });

  it('P5: pending returns at most 500, oldest first, and ?after continues', async () => {
    const restaurant = randomUUID();
    const token = `vpt_${randomUUID()}`;
    await superuserQuery(database.superuserUrl, "INSERT INTO public.restaurants (id, slug, name) VALUES ($1, $2, 'Probe C')", [
      restaurant,
      `probe-${restaurant}`,
    ]);
    await superuserQuery(database.superuserUrl, "INSERT INTO public.printer_tokens (restaurant_id, name, token_hash) VALUES ($1, 'C', $2)", [
      restaurant,
      createHash('sha256').update(token).digest('hex'),
    ]);
    await superuserQuery(
      database.superuserUrl,
      `INSERT INTO public.print_jobs (restaurant_id, kind, payload, created_at)
       SELECT $1, 'command', jsonb_build_object('n', n), now() - interval '1 hour' + n * interval '1 second'
         FROM generate_series(1, 501) AS n`,
      [restaurant],
    );
    const first = (await http().get('/api/print/jobs/pending').set(bearer(token))).body as { id: string; payload: { n: number } }[];
    expect(first).toHaveLength(500);
    expect(first[0].payload.n).toBe(1);
    expect(first[499].payload.n).toBe(500);
    const rest = (await http().get(`/api/print/jobs/pending?after=${first[499].id}`).set(bearer(token))).body as {
      payload: { n: number };
    }[];
    expect(rest.map((job) => job.payload.n)).toEqual([501]);
  });

  it('P6: unknown ack 404, a bearer token cannot enqueue, prune keeps 6 days and deletes 8', async () => {
    const token = await printerToken(fixtures.adminA.email);
    expect((await http().post(`/api/print/jobs/${randomUUID()}/ack`).set(bearer(token))).status).toBe(404);
    expect((await http().post('/api/print/commands').set(bearer(token)).send(COMMAND)).status).toBe(401);
    expect((await http().post('/api/print/invoices').set(bearer(token)).send({ invoice: { invoiceNumber: 'F' }, displayItems: [] })).status).toBe(401);

    const [kept] = await superuserQuery<{ id: string }>(
      database.superuserUrl,
      "INSERT INTO public.print_jobs (restaurant_id, kind, payload, created_at) VALUES ($1, 'command', '{}', now() - interval '6 days') RETURNING id",
      [fixtures.restaurantA],
    );
    const [gone] = await superuserQuery<{ id: string }>(
      database.superuserUrl,
      "INSERT INTO public.print_jobs (restaurant_id, kind, payload, created_at) VALUES ($1, 'command', '{}', now() - interval '8 days') RETURNING id",
      [fixtures.restaurantA],
    );
    const restarted = await createTestApp(database.apiUrl);
    await restarted.close();
    const rows = await superuserQuery<{ id: string }>(database.superuserUrl, 'SELECT id FROM public.print_jobs WHERE id = ANY($1)', [
      [kept.id, gone.id],
    ]);
    expect(rows).toEqual([{ id: kept.id }]);
  });
});
