import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChangeSink, HEARTBEAT_MS, type ListenerConnection, PgListenerService } from './pg-listener.service';

/** In-memory stand-in for the dedicated pg.Client. */
class FakeClient extends EventEmitter {
  connect = vi.fn(async () => undefined);
  query = vi.fn(async (_text: string) => ({ rows: [] }));
  end = vi.fn(async () => {
    this.ended = true;
  });
  ended = false;
}

describe('PgListenerService (fake client, fake timers)', () => {
  let clients: FakeClient[];
  let gateway: { broadcast: ReturnType<typeof vi.fn<ChangeSink['broadcast']>>; resyncAll: ReturnType<typeof vi.fn<ChangeSink['resyncAll']>> };
  let listener: PgListenerService;

  const build = () =>
    new PgListenerService('postgres://unused', { pool: { query: vi.fn() } } as never, gateway, {
      createClient: () => {
        const client = new FakeClient();
        clients.push(client);
        return client as unknown as ListenerConnection;
      },
    });

  beforeEach(() => {
    vi.useFakeTimers();
    clients = [];
    gateway = { broadcast: vi.fn<ChangeSink['broadcast']>(), resyncAll: vi.fn<ChangeSink['resyncAll']>() };
    listener = build();
  });

  afterEach(async () => {
    await listener.onModuleDestroy();
    vi.useRealTimers();
  });

  it('sends SELECT 1 on the listener connection every 30 s', async () => {
    await listener.onModuleInit();
    expect(HEARTBEAT_MS).toBe(30_000);
    const heartbeats = () => clients[0].query.mock.calls.filter(([text]) => text === 'SELECT 1').length;
    expect(heartbeats()).toBe(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(heartbeats()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeats()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeats()).toBe(2);
  });

  it('treats a failed heartbeat as a lost connection: ends it, reconnects, resyncs once', async () => {
    await listener.onModuleInit();
    clients[0].query.mockRejectedValueOnce(new Error('half-open socket'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clients[0].end).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    expect(gateway.resyncAll).toHaveBeenCalledTimes(1);
    // The dead client gets no more heartbeats.
    const before = clients[0].query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients[0].query.mock.calls.length).toBe(before);
  });

  it('ends a client that emits error, so it cannot keep listening beside its replacement', async () => {
    await listener.onModuleInit();
    clients[0].emit('error', new Error('socket hang up'));
    expect(clients[0].end).toHaveBeenCalledTimes(1);
  });

  it('never resyncs on the first connection, even after failed attempts', async () => {
    let failures = 2;
    listener = new PgListenerService('postgres://unused', { pool: { query: vi.fn() } } as never, gateway, {
      createClient: () => {
        const client = new FakeClient();
        if (failures > 0) {
          failures -= 1;
          client.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        }
        clients.push(client);
        return client as unknown as ListenerConnection;
      },
    });
    await listener.onModuleInit();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    expect(clients).toHaveLength(3);
    expect(clients[2].query).toHaveBeenCalledWith('LISTEN pos_changes');
    expect(gateway.resyncAll).not.toHaveBeenCalled();
  });

  it('gives exactly one resync after a reconnect that needed several attempts', async () => {
    await listener.onModuleInit();
    let failures = 2;
    const original = clients.length;
    listener['createClient'] = () => {
      const client = new FakeClient();
      if (failures > 0) {
        failures -= 1;
        client.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      }
      clients.push(client);
      return client as unknown as ListenerConnection;
    };
    clients[0].emit('end');
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    expect(clients.length - original).toBe(3);
    expect(gateway.resyncAll).toHaveBeenCalledTimes(1);
  });
});
