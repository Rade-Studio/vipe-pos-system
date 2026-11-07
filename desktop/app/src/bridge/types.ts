// What the local pages need from the native side (Rust, src-tauri) or from the
// demo bridge used in tests, `vite dev` and demo mode.
import type { Channel, ConnectionKind, PendingJob, Restaurant } from '../api/contract';
import type { SetupProgress } from '../setup/flow';

export type TestResult = 'ok' | 'garbled' | 'nothing';

export interface LocalPrinter {
  id: string;
  name: string;
  model: string;
  connection: ConnectionKind;
  /** host:port, Windows printer name or COM port. Stays on this computer. */
  address: string;
  paperMm: 58 | 80;
  encoding: 'cp1252' | 'utf-8';
  hasDrawer: boolean;
  cut: boolean;
  stationIds: string[];
  testResult: TestResult | null;
  drawerTested: boolean;
}

export interface DiscoveredPrinter {
  id: string;
  model: string;
  connection: ConnectionKind;
  address: string;
  /** "puerto USB001 · con cajón de dinero" */
  detail: string;
  paperMm: 58 | 80;
  hasDrawer: boolean;
  suggestedName: string;
}

export interface StationSettings {
  webUrl: string;
  deviceId: string | null;
  deviceToken: string | null;
  restaurant: Restaurant | null;
  linkedAt: string | null;
  channel: Channel;
  printers: LocalPrinter[];
  /** The Caja station (`fixed`); invoices without a station print on its printers. */
  cajaStationId?: string | null;
  autostart: boolean;
  autoUpdate: boolean;
  soundOnFailure: boolean;
  setup: SetupProgress;
}

export type PrinterHealth = 'ready' | 'printing' | 'error' | 'offline';

export interface PrinterState {
  id: string;
  health: PrinterHealth;
  /** "Sin papel", "No responde" */
  error?: string;
}

export interface QueueItem {
  id: string;
  title: string;
  detail: string;
  printerName: string;
  status: 'pending' | 'printing' | 'failed';
  attempts: number;
  error?: string;
  at: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  detail: string;
  status: 'printed' | 'cancelled' | 'skipped';
  at: string;
}

export interface StationStatus {
  connection: 'online' | 'reconnecting' | 'offline';
  lastSignalAt: string | null;
  printingEnabled: boolean;
  printers: PrinterState[];
  queue: QueueItem[];
  history: HistoryItem[];
  printedToday: number;
  version: string;
}

export interface TrayItem {
  id: string;
  label: string;
  enabled: boolean;
}

export interface Bridge {
  readonly kind: 'tauri' | 'demo';
  loadSettings(): Promise<StationSettings>;
  saveSettings(settings: StationSettings): Promise<void>;
  discoverPrinters(): Promise<DiscoveredPrinter[]>;
  testPrint(printer: LocalPrinter, restaurant: Restaurant | null): Promise<void>;
  openDrawer(printer: LocalPrinter): Promise<void>;
  status(): Promise<StationStatus>;
  enqueueJobs(jobs: PendingJob[]): Promise<void>;
  takeAcks(): Promise<{ id: string; status: 'printed' | 'skipped' | 'cancelled'; reason?: string }[]>;
  markAcked(id: string): Promise<void>;
  retryJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  reprint(id: string): Promise<void>;
  setAutostart(enabled: boolean): Promise<void>;
  updateTray(items: TrayItem[], tooltip: string): Promise<void>;
  /** Show the Estación panel window (from the title bar pill). */
  openPanel(page?: string): Promise<void>;
  /** Hide the panel and bring the VIPE window back. */
  showVipe(): Promise<void>;
}
