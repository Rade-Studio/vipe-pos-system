import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTrustProxy } from './configure-app';

/** req.ip as the API sees it for a request carrying `forwardedFor`, with `hops` trusted proxies. */
async function ipSeen(hops: number, forwardedFor?: string): Promise<string> {
  const app = new ExpressAdapter().getInstance<Express>();
  applyTrustProxy(app, hops);
  app.get('/ip', (req, res) => {
    res.send(req.ip);
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/ip`, { headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} });
  return res.text();
}

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('applyTrustProxy', () => {
  it('ignores X-Forwarded-For when no proxy is trusted (default)', async () => {
    expect(await ipSeen(0, '203.0.113.7')).toBe('127.0.0.1');
  });

  it('with one trusted proxy uses the address that proxy appended, never a spoofed left entry', async () => {
    // The proxy appends the real client (198.51.100.4) after whatever the client sent.
    expect(await ipSeen(1, '203.0.113.7, 198.51.100.4')).toBe('198.51.100.4');
    expect(await ipSeen(1, '198.51.100.4')).toBe('198.51.100.4');
  });
});
