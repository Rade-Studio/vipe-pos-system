// Types of desktop/API-CONTRACT.md. Keep both in sync.

export type Channel = 'stable' | 'pilot';

export interface Restaurant {
  id: string;
  name: string;
  branch: string;
  address: string;
  initials: string;
}

export interface DeviceInfo {
  name: string;
  platform: 'windows';
  appVersion: string;
}

export interface PairingPreview {
  restaurant: Restaurant;
}

export interface PairingClaim {
  deviceId: string;
  deviceToken: string;
  restaurant: Restaurant;
  channel: Channel;
}

export type PrinterHealth = 'ready' | 'printing' | 'error' | 'offline';

export interface HeartbeatRequest {
  appVersion: string;
  printers: { id: string; status: PrinterHealth; error?: string }[];
  queue: { pending: number; failed: number };
}

export interface HeartbeatResponse {
  serverTime: string;
  channel: Channel;
  printingEnabled: boolean;
}

export type StationKind = 'cashier' | 'kitchen' | 'bar' | 'other';

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  /** The Caja station (facturas, precuentas, cierre); always exists. */
  fixed: boolean;
  /** Read-only "Qué imprime" text built by the server from the routes. */
  prints: string;
  productCount: number;
}

export type ConnectionKind = 'usb' | 'network' | 'bluetooth';

export interface PrinterRegistration {
  id: string;
  name: string;
  model: string;
  connection: ConnectionKind;
  paperMm: 58 | 80;
  hasDrawer: boolean;
  stationIds: string[];
}

export type JobKind = 'command' | 'invoice';

export interface PendingJob {
  id: string;
  kind: JobKind;
  /** null for restaurants without stations: the job prints on every printer. */
  stationId: string | null;
  /** From F6 the server may add the station itself; the device routes by stationId. */
  station?: { id: string; name: string } | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

export type AckStatus = 'printed' | 'skipped' | 'cancelled';

export interface DrawerEvent {
  printerId: string;
  openedAt: string;
  reason: 'manual' | 'cash_payment';
  profileId?: string;
}

/** Error codes the client maps to user messages. */
export type ApiErrorCode =
  | 'pairing_code_invalid'
  | 'pairing_code_expired'
  | 'pairing_attempts'
  | 'device_revoked'
  | 'offline'
  | 'server_error';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** What the desktop app needs from the VIPE API. */
export interface VipeApiClient {
  previewPairing(code: string): Promise<PairingPreview>;
  claimPairing(code: string, device: DeviceInfo): Promise<PairingClaim>;
  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse>;
  stations(): Promise<Station[]>;
  savePrinters(printers: PrinterRegistration[]): Promise<PrinterRegistration[]>;
  pendingJobs(after?: string): Promise<PendingJob[]>;
  ack(jobId: string, status: AckStatus, reason?: string): Promise<void>;
  drawerOpened(event: DrawerEvent): Promise<void>;
}

/** Spanish text shown for an API error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'pairing_code_invalid':
        return 'Ese código no existe. Revisa los 6 dígitos o genera uno nuevo.';
      case 'pairing_code_expired':
        return 'El código venció. Genera uno nuevo en VIPE → Ajustes → Estación de impresión.';
      case 'pairing_attempts':
        return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
      case 'device_revoked':
        return 'Este computador fue desvinculado. Vincúlalo de nuevo con un código.';
      case 'offline':
        return 'Sin conexión a internet. Revisa el cable o el wifi y vuelve a intentarlo.';
      default:
        return err.message || 'VIPE no respondió. Vuelve a intentarlo en un momento.';
    }
  }
  return 'VIPE no respondió. Vuelve a intentarlo en un momento.';
}
