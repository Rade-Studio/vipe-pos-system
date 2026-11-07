// Keeps the local queue in step with the VIPE API (desktop/API-CONTRACT.md):
// heartbeat, pending jobs into the Rust queue, acks back to the API.
import type { VipeApiClient } from './api/contract';
import type { Bridge, StationSettings } from './bridge/types';
import { PENDING_PAGE_SIZE } from './api/http';

export const SYNC_INTERVAL_MS = 15_000;

export async function syncOnce(api: VipeApiClient, bridge: Bridge, settings: StationSettings, appVersion: string) {
  if (!settings.deviceToken) return;
  const status = await bridge.status();
  await api.heartbeat({
    appVersion,
    printers: status.printers.map((p) => ({ id: p.id, status: p.health, error: p.error })),
    queue: {
      pending: status.queue.filter((q) => q.status !== 'failed').length,
      failed: status.queue.filter((q) => q.status === 'failed').length,
    },
  });
  // A full page continues after its last id so old failing jobs cannot hide newer ones.
  let after: string | undefined;
  for (;;) {
    const page = await api.pendingJobs(after);
    if (page.length) await bridge.enqueueJobs(page);
    if (page.length < PENDING_PAGE_SIZE) break;
    after = page[page.length - 1].id;
  }
  for (const ack of await bridge.takeAcks()) {
    await api.ack(ack.id, ack.status, ack.reason);
    await bridge.markAcked(ack.id);
  }
}

export function startSync(api: VipeApiClient, bridge: Bridge, load: () => Promise<StationSettings>, appVersion: string) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await syncOnce(api, bridge, await load(), appVersion);
    } catch {
      // Offline or API error: the panel shows the connection state; retry next tick.
    }
    if (!stopped) setTimeout(() => void tick(), SYNC_INTERVAL_MS);
  };
  void tick();
  return () => {
    stopped = true;
  };
}
