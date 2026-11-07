// In-memory VipeApiClient used by tests and demo mode. The data is the demo
// restaurant of the designs (Casa Guadua · Sede Laureles, `pnpm db:demo`).
import {
  ApiError,
  type AckStatus,
  type DeviceInfo,
  type DrawerEvent,
  type HeartbeatRequest,
  type PendingJob,
  type PrinterRegistration,
  type Restaurant,
  type Station,
  type VipeApiClient,
} from './contract';

export const DEMO_CODE = '481207';
export const EXPIRED_CODE = '000000';

export const DEMO_RESTAURANT: Restaurant = {
  id: 'rest-casa-guadua',
  name: 'Casa Guadua',
  branch: 'Sede Laureles',
  address: 'Calle 33 #76-20, Medellín',
  initials: 'CG',
};

export const DEMO_STATIONS: Station[] = [
  { id: 'st-caja', name: 'Caja', kind: 'cashier', fixed: true, prints: 'facturas y precuentas', productCount: 0 },
  { id: 'st-barra', name: 'Barra', kind: 'bar', fixed: false, prints: 'Bebidas, Cócteles, Cafés', productCount: 31 },
  { id: 'st-cocina', name: 'Cocina', kind: 'kitchen', fixed: false, prints: 'Entradas, Platos fuertes, Postres', productCount: 48 },
];

export class MockApiClient implements VipeApiClient {
  offline = false;
  savedPrinters: PrinterRegistration[] = [];
  acks: { id: string; status: AckStatus; reason?: string }[] = [];
  drawerEvents: DrawerEvent[] = [];
  heartbeats: HeartbeatRequest[] = [];
  jobs: PendingJob[] = [];
  claimedBy: DeviceInfo | null = null;

  private guard() {
    if (this.offline) return Promise.reject(new ApiError('offline', 'Sin conexión'));
    return Promise.resolve();
  }

  private checkCode(code: string) {
    if (code === EXPIRED_CODE) throw new ApiError('pairing_code_expired', 'El código venció', 410);
    if (code !== DEMO_CODE) throw new ApiError('pairing_code_invalid', 'Ese código no existe', 404);
  }

  async previewPairing(code: string) {
    await this.guard();
    this.checkCode(code);
    return { restaurant: DEMO_RESTAURANT };
  }

  async claimPairing(code: string, device: DeviceInfo) {
    await this.guard();
    this.checkCode(code);
    this.claimedBy = device;
    return { deviceId: 'dev-demo-1', deviceToken: 'vdt_demo_0001', restaurant: DEMO_RESTAURANT, channel: 'stable' as const };
  }

  async heartbeat(body: HeartbeatRequest) {
    await this.guard();
    this.heartbeats.push(body);
    return { serverTime: new Date().toISOString(), channel: 'stable' as const, printingEnabled: true };
  }

  async stations() {
    await this.guard();
    return DEMO_STATIONS.map((s) => ({ ...s }));
  }

  async savePrinters(printers: PrinterRegistration[]) {
    await this.guard();
    this.savedPrinters = printers.map((p) => ({ ...p }));
    return this.savedPrinters;
  }

  async pendingJobs(after?: string) {
    await this.guard();
    const start = after ? this.jobs.findIndex((j) => j.id === after) + 1 : 0;
    const acked = new Set(this.acks.map((a) => a.id));
    return this.jobs.slice(start).filter((j) => !acked.has(j.id));
  }

  async ack(id: string, status: AckStatus, reason?: string) {
    await this.guard();
    this.acks.push(reason ? { id, status, reason } : { id, status });
  }

  async drawerOpened(event: DrawerEvent) {
    await this.guard();
    this.drawerEvents.push(event);
  }
}
