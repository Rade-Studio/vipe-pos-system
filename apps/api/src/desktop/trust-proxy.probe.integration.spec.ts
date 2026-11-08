import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/test-app';
import { startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * The per-IP pairing limit (F5a, L34/L36) behind a reverse proxy: with one
 * trusted hop each client has its own bucket, keyed by the address the proxy
 * appended, and a client-sent left entry never escapes it; with none, the
 * header is ignored. Supertest connects from loopback, standing in for the proxy.
 */
describe('pairing limit behind a reverse proxy (TRUST_PROXY_HOPS)', () => {
  let database: TestDatabase;
  const db = <T = Record<string, unknown>>(text: string) => superuserQuery<T>(database.superuserUrl, text);
  const ipKey = (ip: string) => `ip:${createHash('sha256').update(ip).digest('hex')}`;
  const preview = (app: INestApplication, forwardedFor: string, i: number) =>
    request(app.getHttpServer()).post('/api/desktop/pairing/preview').set('X-Forwarded-For', forwardedFor).send({ code: `00000${i}` });

  const withHops = async (hops: string, run: (app: INestApplication) => Promise<void>) => {
    process.env.TRUST_PROXY_HOPS = hops;
    const app = await createTestApp(database.apiUrl);
    try {
      await db(`DELETE FROM private.desktop_pairing_attempts`);
      await run(app);
    } finally {
      await app.close();
      delete process.env.TRUST_PROXY_HOPS;
    }
  };

  beforeAll(async () => {
    database = await startTestDatabase();
  });
  afterAll(async () => {
    delete process.env.TRUST_PROXY_HOPS;
    await database?.stop();
  });

  it('one trusted hop: buckets follow the proxy-appended address and a spoofed left entry does not escape', async () => {
    await withHops('1', async (app) => {
      for (let i = 0; i < 5; i += 1) {
        expect((await preview(app, `10.9.9.${i}, 198.51.100.1`, i)).status).toBe(404);
      }
      const spoofed = await preview(app, '198.51.100.2, 198.51.100.1', 5);
      expect([spoofed.status, spoofed.body.code]).toEqual([429, 'pairing_attempts']);
      expect((await preview(app, '198.51.100.1, 198.51.100.2', 6)).status).toBe(404);
      const rows = await db<{ key: string; failures: number }>(
        `SELECT key, failures FROM private.desktop_pairing_attempts WHERE key LIKE 'ip:%' ORDER BY failures DESC`,
      );
      expect(rows.map((r) => [r.key, r.failures])).toEqual([
        [ipKey('198.51.100.1'), 5],
        [ipKey('198.51.100.2'), 1],
      ]);
    });
  });

  it('no trusted hop (default): X-Forwarded-For is ignored, every request shares the peer bucket', async () => {
    await withHops('0', async (app) => {
      for (let i = 0; i < 5; i += 1) {
        expect((await preview(app, `198.51.100.${10 + i}`, i)).status).toBe(404);
      }
      expect((await preview(app, '198.51.100.99', 5)).status).toBe(429);
      const rows = await db<{ key: string }>(`SELECT key FROM private.desktop_pairing_attempts WHERE key LIKE 'ip:%'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].key).not.toBe(ipKey('198.51.100.10'));
    });
  });
});
