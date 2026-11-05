import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication, Post, Query } from '@nestjs/common';
import { throwError } from 'rxjs';
import { eq, schema, sql } from '@vipe/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles } from '../auth/roles.decorator';
import { TokensService } from '../auth/tokens.service';
import { UnitOfWork } from '../db/unit-of-work';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Probe routes registered only in this spec (never in AppModule). */
@Controller('_test')
class TenancyProbeController {
  constructor(private readonly uow: UnitOfWork) {}

  @Get('orders-count')
  async ordersCount(@Query('restaurantId') restaurantId: string) {
    const [row] = await this.uow.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(eq(schema.orders.restaurantId, restaurantId));
    return { count: row.count };
  }

  @Get('admin-only')
  @Roles('admin')
  adminOnly() {
    return { ok: true };
  }

  @Post('write-then-fail')
  async writeThenFail() {
    await this.uow.db.insert(schema.businessConfig).values({ key: 't5-rollback-probe', value: '1' });
    throw new Error('boom after write');
  }

  @Post('write-then-late-error')
  async writeThenLateError() {
    await this.uow.db.insert(schema.businessConfig).values({ key: 't5-late-error-probe', value: '1' });
    return throwError(() => new Error('late'));
  }

  @Get('timeouts')
  async timeouts() {
    const result = await this.uow.db.execute<{ statement: string; idle: string }>(
      sql`SELECT current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    return result.rows[0];
  }

  @Post('write-ok')
  async writeOk() {
    await this.uow.db.insert(schema.businessConfig).values({ key: 't5-commit-probe', value: '1' });
    const [row] = await this.uow.db
      .select({ restaurantId: schema.businessConfig.restaurantId })
      .from(schema.businessConfig)
      .where(eq(schema.businessConfig.key, 't5-commit-probe'));
    return row;
  }
}

describe('unit of work and guards (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl, [TenancyProbeController]);
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const http = () => request(app.getHttpServer());
  const accessFor = async (email: string) =>
    cookiePair(setCookies(await http().post('/api/auth/login').send({ email, password: PASSWORD })).vipe_access);

  it("sees restaurant A's orders as A's user and none of them as B's user", async () => {
    const asACookie = await accessFor(fixtures.adminA.email);
    const asA = await http()
      .get('/api/_test/orders-count')
      .query({ restaurantId: fixtures.restaurantA })
      .set('Cookie', asACookie);
    expect(asA.status).toBe(200);
    expect(asA.body).toEqual({ count: fixtures.ordersInA });

    const asBCookie = await accessFor(fixtures.adminB.email);
    const asB = await http()
      .get('/api/_test/orders-count')
      .query({ restaurantId: fixtures.restaurantA })
      .set('Cookie', asBCookie);
    expect(asB.status).toBe(200);
    expect(asB.body).toEqual({ count: 0 });
  });

  it('answers 401 on a probe route without an access cookie', async () => {
    const res = await http().get('/api/_test/orders-count').query({ restaurantId: fixtures.restaurantA });
    expect(res.status).toBe(401);
  });

  it('answers 403 on a @Roles("admin") route for the waiter and 200 for the admin', async () => {
    const waiterCookie = await accessFor(fixtures.waiterA.email);
    const waiter = await http().get('/api/_test/admin-only').set('Cookie', waiterCookie);
    expect(waiter.status).toBe(403);
    expect(waiter.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Insufficient role' });

    const adminCookie = await accessFor(fixtures.adminA.email);
    const admin = await http().get('/api/_test/admin-only').set('Cookie', adminCookie);
    expect(admin.status).toBe(200);
    expect(admin.body).toEqual({ ok: true });
  });

  it('answers 403 for a valid token whose user has no profile', async () => {
    // A live session, so the request reaches the profile check.
    const [session] = await superuserQuery<{ id: string }>(
      database.superuserUrl,
      "INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id",
      [fixtures.noProfile.userId, randomUUID()],
    );
    const token = await app.get(TokensService).signAccess(fixtures.noProfile.userId, session.id);
    const res = await http()
      .get('/api/_test/orders-count')
      .query({ restaurantId: fixtures.restaurantA })
      .set('Cookie', `vipe_access=${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'No active profile for this account' });
  });

  it('rolls the request transaction back when the handler throws, without leaking the driver message', async () => {
    const cookie = await accessFor(fixtures.adminA.email);
    const res = await http().post('/api/_test/write-then-fail').set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' });
    const rows = await superuserQuery(database.superuserUrl, "SELECT 1 FROM public.business_config WHERE key = 't5-rollback-probe'");
    expect(rows).toHaveLength(0);
  });

  it("commits on success, with the row stamped with the caller's tenant", async () => {
    const cookie = await accessFor(fixtures.adminA.email);
    const res = await http().post('/api/_test/write-ok').set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ restaurantId: fixtures.restaurantA });
    const rows = await superuserQuery<{ restaurant_id: string }>(
      database.superuserUrl,
      "SELECT restaurant_id FROM public.business_config WHERE key = 't5-commit-probe'",
    );
    expect(rows).toEqual([{ restaurant_id: fixtures.restaurantA }]);
  });

  it('maps a Postgres permission error raised under RLS to 403', async () => {
    // The waiter is not admin, so the business_config INSERT policy rejects the row (42501).
    const cookie = await accessFor(fixtures.waiterA.email);
    const res = await http().post('/api/_test/write-ok').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Permission denied', code: '42501' });
  });

  it('rolls back when the handler returns an Observable that errors after the write', async () => {
    const cookie = await accessFor(fixtures.adminA.email);
    const res = await http().post('/api/_test/write-then-late-error').set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' });
    const rows = await superuserQuery(database.superuserUrl, "SELECT 1 FROM public.business_config WHERE key = 't5-late-error-probe'");
    expect(rows).toHaveLength(0);
  });

  it('runs request transactions with statement and idle-in-transaction timeouts', async () => {
    const cookie = await accessFor(fixtures.adminA.email);
    const res = await http().get('/api/_test/timeouts').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ statement: '30s', idle: '15s' });
  });

  it('survives Postgres terminating the idle vipe_api connections', async () => {
    const cookie = await accessFor(fixtures.adminA.email);
    const killed = await superuserQuery<{ n: number }>(
      database.superuserUrl,
      "SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity WHERE usename = 'vipe_api' AND state = 'idle'",
    );
    expect(killed[0].n).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = await http().get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(fixtures.adminA.userId);
  });
});
