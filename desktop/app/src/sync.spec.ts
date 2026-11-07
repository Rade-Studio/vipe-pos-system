import { describe, expect, it, vi } from 'vitest';
import { MockApiClient } from './api/mock';
import { createDemoBridge } from './bridge/demo';
import { syncOnce } from './sync';

describe('syncOnce', () => {
  it('sends a heartbeat, queues pending jobs and acks finished ones', async () => {
    const api = new MockApiClient();
    api.jobs = [{ id: 'j1', kind: 'command', station: 'st-cocina', createdAt: new Date().toISOString(), payload: {} }];
    const bridge = createDemoBridge({ scenario: 'ready', storage: null });
    bridge.enqueueJobs = vi.fn(async () => undefined);
    bridge.takeAcks = vi.fn(async () => [{ id: 'j0', status: 'printed' as const }]);
    bridge.markAcked = vi.fn(async () => undefined);

    await syncOnce(api, bridge, await bridge.loadSettings(), '0.1.0');

    expect(api.heartbeats[0]).toMatchObject({ appVersion: '0.1.0', queue: { pending: 2, failed: 0 } });
    expect(bridge.enqueueJobs).toHaveBeenCalledWith(api.jobs);
    expect(api.acks).toEqual([{ id: 'j0', status: 'printed' }]);
    expect(bridge.markAcked).toHaveBeenCalledWith('j0');
  });

  it('does nothing before the computer is linked', async () => {
    const api = new MockApiClient();
    const bridge = createDemoBridge({ scenario: 'fresh', storage: null });
    await syncOnce(api, bridge, await bridge.loadSettings(), '0.1.0');
    expect(api.heartbeats).toEqual([]);
  });

  it('keeps the ack pending when the API is offline', async () => {
    const api = new MockApiClient();
    api.offline = true;
    const bridge = createDemoBridge({ scenario: 'ready', storage: null });
    bridge.markAcked = vi.fn(async () => undefined);
    await expect(syncOnce(api, bridge, await bridge.loadSettings(), '0.1.0')).rejects.toMatchObject({ code: 'offline' });
    expect(bridge.markAcked).not.toHaveBeenCalled();
  });
});
