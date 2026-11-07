import type { INestApplication } from '@nestjs/common';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const INVALID_CREDENTIALS = { statusCode: 401, error: 'Unauthorized', message: 'Invalid credentials' };

describe('auth endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });

  describe('POST /api/auth/login', () => {
    it('returns the user and profile and sets both auth cookies', async () => {
      const res = await login(fixtures.adminA.email);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { id: fixtures.adminA.userId, email: fixtures.adminA.email },
        profile: { id: fixtures.adminA.profileId, name: 'Admin A', role: 'admin', restaurantId: fixtures.restaurantA },
        sessionKind: 'user',
      });
      const cookies = setCookies(res);
      expect(cookies.vipe_access).toMatch(/^vipe_access=[^;]+; Max-Age=900; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
      expect(cookies.vipe_refresh).toMatch(
        /^vipe_refresh=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/api\/auth; Expires=[^;]+; HttpOnly; SameSite=Lax$/,
      );
    });

    it('matches the email case-insensitively', async () => {
      const res = await login('ADMIN@A.test');
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: fixtures.adminA.userId, email: fixtures.adminA.email });
    });

    it.each([
      ['a wrong password', fixtures.adminA.email, 'not the password'],
      ['an unknown email', 'nobody@a.test', PASSWORD],
      ['an inactive user', fixtures.inactive.email, PASSWORD],
    ])('answers 401 Invalid credentials for %s and sets no cookie', async (_case, email, password) => {
      const res = await login(email, password);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_CREDENTIALS);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('answers 400 for a body without email or password', async () => {
      const res = await http().post('/api/auth/login').send({ email: fixtures.adminA.email });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });

    it('answers 403 for valid credentials without a profile and opens no session', async () => {
      const res = await login(fixtures.noProfile.email);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'No active profile for this account' });
      expect(res.headers['set-cookie']).toBeUndefined();
      const sessions = await superuserQuery(database.superuserUrl, 'SELECT 1 FROM public.auth_sessions WHERE user_id = $1', [
        fixtures.noProfile.userId,
      ]);
      expect(sessions).toHaveLength(0);
    });

    it('accepts a bcrypt hash and re-hashes it to argon2id on that login', async () => {
      const res = await login(fixtures.bcryptUser.email);
      expect(res.status).toBe(200);
      const [row] = await superuserQuery<{ password_algo: string; password_hash: string }>(
        database.superuserUrl,
        'SELECT password_algo, password_hash FROM public.users WHERE id = $1',
        [fixtures.bcryptUser.userId],
      );
      expect(row.password_algo).toBe('argon2id');
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect((await login(fixtures.bcryptUser.email)).status).toBe(200);
    });
  });

  describe('GET /api/auth/me', () => {
    it('answers 401 without an access cookie', async () => {
      const res = await http().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    });

    it('answers 401 for a tampered access token', async () => {
      const access = cookiePair(setCookies(await login(fixtures.adminA.email)).vipe_access);
      const res = await http().get('/api/auth/me').set('Cookie', `${access.slice(0, -2)}xx`);
      expect(res.status).toBe(401);
    });

    it('answers 401 for a malformed percent-encoded access cookie', async () => {
      const res = await http().get('/api/auth/me').set('Cookie', 'vipe_access=%E0%A4%A');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    });

    it('issues an access JWT whose payload keys are exactly exp, iat, sid, sub', async () => {
      const access = cookiePair(setCookies(await login(fixtures.adminA.email)).vipe_access);
      const payload = decodeJwt(access.slice('vipe_access='.length));
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
      expect(payload.sub).toBe(fixtures.adminA.userId);
    });

    it('answers 200 with the login body for a valid access cookie', async () => {
      const loginRes = await login(fixtures.waiterA.email);
      const res = await http().get('/api/auth/me').set('Cookie', cookiePair(setCookies(loginRes).vipe_access));
      expect(res.status).toBe(200);
      expect(res.body).toEqual(loginRes.body);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates both cookies and rejects the previous refresh token', async () => {
      const first = setCookies(await login(fixtures.adminA.email));
      const oldRefresh = cookiePair(first.vipe_refresh);

      const rotated = await http().post('/api/auth/refresh').set('Cookie', oldRefresh);
      expect(rotated.status).toBe(204);
      const next = setCookies(rotated);
      expect(cookiePair(next.vipe_refresh)).not.toBe(oldRefresh);
      expect(next.vipe_access).toMatch(/^vipe_access=[^;]+; Max-Age=900; Path=\/;/);

      const me = await http().get('/api/auth/me').set('Cookie', cookiePair(next.vipe_access));
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(fixtures.adminA.userId);

      const reused = await http().post('/api/auth/refresh').set('Cookie', oldRefresh);
      expect(reused.status).toBe(401);
      expect(reused.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' });

      const again = await http().post('/api/auth/refresh').set('Cookie', cookiePair(next.vipe_refresh));
      expect(again.status).toBe(204);
    });

    it('answers 401 for a malformed percent-encoded refresh cookie', async () => {
      const res = await http().post('/api/auth/refresh').set('Cookie', 'vipe_refresh=%E0%A4%A');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' });
    });

    it('answers 401 without a refresh cookie', async () => {
      const res = await http().post('/api/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the session, clears both cookies, and a later refresh is 401', async () => {
      const cookies = setCookies(await login(fixtures.adminA.email));
      const refresh = cookiePair(cookies.vipe_refresh);

      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', [cookiePair(cookies.vipe_access), refresh].join('; '));
      expect(res.status).toBe(204);
      const cleared = setCookies(res);
      expect(cleared.vipe_access).toMatch(/^vipe_access=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/);
      expect(cleared.vipe_refresh).toMatch(
        /^vipe_refresh=; Path=\/api\/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/,
      );

      const later = await http().post('/api/auth/refresh').set('Cookie', refresh);
      expect(later.status).toBe(401);
    });

    it('rejects the old access cookie after logout', async () => {
      const cookies = setCookies(await login(fixtures.adminA.email));
      const access = cookiePair(cookies.vipe_access);
      expect((await http().get('/api/auth/me').set('Cookie', access)).status).toBe(200);

      const out = await http().post('/api/auth/logout').set('Cookie', [access, cookiePair(cookies.vipe_refresh)].join('; '));
      expect(out.status).toBe(204);

      const me = await http().get('/api/auth/me').set('Cookie', access);
      expect(me.status).toBe(401);
      expect(me.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Session revoked or expired' });
    });

    it('revokes the session by the access token sid when the refresh cookie is absent', async () => {
      const cookies = setCookies(await login(fixtures.adminA.email));
      const out = await http().post('/api/auth/logout').set('Cookie', cookiePair(cookies.vipe_access));
      expect(out.status).toBe(204);

      const later = await http().post('/api/auth/refresh').set('Cookie', cookiePair(cookies.vipe_refresh));
      expect(later.status).toBe(401);
    });
  });
  describe('Cache-Control on /api/auth/*', () => {
    it('answers no-store on login, me, refresh and logout', async () => {
      const signedIn = await login(fixtures.adminA.email);
      expect(signedIn.status).toBe(200);
      expect(signedIn.headers['cache-control']).toBe('no-store');
      const cookies = setCookies(signedIn);

      const me = await http().get('/api/auth/me').set('Cookie', cookiePair(cookies.vipe_access));
      expect(me.status).toBe(200);
      expect(me.headers['cache-control']).toBe('no-store');

      const refreshed = await http().post('/api/auth/refresh').set('Cookie', cookiePair(cookies.vipe_refresh));
      expect(refreshed.status).toBe(204);
      expect(refreshed.headers['cache-control']).toBe('no-store');
      const next = setCookies(refreshed);

      const out = await http().post('/api/auth/logout').set('Cookie', cookiePair(next.vipe_refresh));
      expect(out.status).toBe(204);
      expect(out.headers['cache-control']).toBe('no-store');
    });
  });
});
