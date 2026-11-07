// VipeApiClient over HTTP, per desktop/API-CONTRACT.md. The endpoints are
// built in F5a; until then the app runs with the mock adapter (demo mode).
import {
  ApiError,
  type AckStatus,
  type DeviceInfo,
  type DrawerEvent,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type PairingClaim,
  type PairingPreview,
  type PendingJob,
  type PrinterRegistration,
  type Station,
  type VipeApiClient,
} from './contract';

export const PENDING_PAGE_SIZE = 500;

export interface HttpOptions {
  baseUrl: string;
  token: () => string | null;
  fetch?: typeof fetch;
}

export class HttpApiClient implements VipeApiClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: HttpOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.doFetch = opts.fetch ?? ((...args) => fetch(...args));
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    const token = this.opts.token();
    if (token) headers.set('authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('offline', 'Sin conexión');
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (data && typeof data.code === 'string' && data.code) || 'server_error';
      const message = (data && typeof data.message === 'string' && data.message) || `HTTP ${res.status}`;
      throw new ApiError(code, message, res.status);
    }
    return data as T;
  }

  previewPairing(code: string) {
    return this.call<PairingPreview>('POST', '/api/desktop/pairing/preview', { code });
  }

  claimPairing(code: string, device: DeviceInfo) {
    return this.call<PairingClaim>('POST', '/api/desktop/pairing/claim', { code, device });
  }

  heartbeat(body: HeartbeatRequest) {
    return this.call<HeartbeatResponse>('POST', '/api/desktop/heartbeat', body);
  }

  stations() {
    return this.call<Station[]>('GET', '/api/desktop/stations');
  }

  savePrinters(printers: PrinterRegistration[]) {
    return this.call<PrinterRegistration[]>('PUT', '/api/desktop/printers', printers);
  }

  pendingJobs(after?: string) {
    const q = new URLSearchParams();
    if (after) q.set('after', after);
    q.set('limit', String(PENDING_PAGE_SIZE));
    return this.call<PendingJob[]>('GET', `/api/desktop/jobs/pending?${q}`);
  }

  ack(jobId: string, status: AckStatus, reason?: string) {
    return this.call<void>('POST', `/api/desktop/jobs/${encodeURIComponent(jobId)}/ack`, reason ? { status, reason } : { status });
  }

  drawerOpened(event: DrawerEvent) {
    return this.call<void>('POST', '/api/desktop/drawer-events', event);
  }
}
