import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './contract';
import { HttpApiClient } from './http';

function fakeFetch(status: number, body?: unknown) {
  return vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('HttpApiClient (desktop/API-CONTRACT.md)', () => {
  it('previews a pairing code without a device token', async () => {
    const fetch = fakeFetch(200, { restaurant: { id: 'r1', name: 'Casa Guadua' } });
    const api = new HttpApiClient({ baseUrl: 'https://vipe.test/', token: () => null, fetch });
    const res = await api.previewPairing('481207');
    expect(res.restaurant.name).toBe('Casa Guadua');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vipe.test/api/desktop/pairing/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ code: '481207' });
    expect(new Headers(init.headers).get('authorization')).toBeNull();
  });

  it('sends the device token as Bearer and pages pending jobs after an id', async () => {
    const fetch = fakeFetch(200, []);
    const api = new HttpApiClient({ baseUrl: 'https://vipe.test', token: () => 'vdt_abc', fetch });
    await api.pendingJobs('job-9');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vipe.test/api/desktop/jobs/pending?after=job-9&limit=500');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer vdt_abc');
  });

  it('acks a job with its status', async () => {
    const fetch = fakeFetch(204);
    const api = new HttpApiClient({ baseUrl: 'https://vipe.test', token: () => 'vdt_abc', fetch });
    await api.ack('a b', 'skipped', 'command older than 12 h');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vipe.test/api/desktop/jobs/a%20b/ack');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'skipped', reason: 'command older than 12 h' });
  });

  it('maps API error codes and network failures', async () => {
    const expired = new HttpApiClient({
      baseUrl: 'https://vipe.test',
      token: () => null,
      fetch: fakeFetch(410, { message: 'El código venció', code: 'pairing_code_expired' }),
    });
    await expect(expired.previewPairing('000000')).rejects.toMatchObject({ code: 'pairing_code_expired', status: 410 });

    const offline = new HttpApiClient({
      baseUrl: 'https://vipe.test',
      token: () => null,
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const err = await offline.stations().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('offline');
  });
});
