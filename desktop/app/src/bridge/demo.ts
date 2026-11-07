// Bridge without a native side: tests, `vite dev` and the app's demo mode.
// Scenarios mirror the design states.
import { freshProgress } from '../setup/flow';
import { DEMO_DISCOVERED, baseSettings, demoHistory, demoQueue, linkedSettings, readySettings, toLocal } from './demoData';
import type { Bridge, StationSettings, StationStatus, TrayItem } from './types';

export type DemoScenario = 'fresh' | 'resume' | 'ready' | 'failing' | 'empty' | 'offline';

const KEY = 'vipe.desktop.demo.settings';

function scenarioSettings(s: DemoScenario): StationSettings {
  switch (s) {
    case 'fresh':
      return baseSettings();
    case 'resume':
      return {
        ...linkedSettings(),
        printers: DEMO_DISCOVERED.map(toLocal),
        setup: { ...freshProgress(), step: 'details', printerIndex: 0, maxStep: 5, prints: true },
      };
    case 'empty':
      return { ...linkedSettings(), setup: { ...freshProgress(), step: 'done', maxStep: 9, prints: false, completed: true } };
    default:
      return readySettings();
  }
}

export interface DemoBridge extends Bridge {
  drawerPulses: number;
  testPrints: number;
  retried: string[];
  cancelled: string[];
  reprinted: string[];
  autostart: boolean | null;
  tray: { items: TrayItem[]; tooltip: string } | null;
  panelOpened: string | null;
}

export function createDemoBridge(opts: { scenario: DemoScenario; storage: Storage | null }): DemoBridge {
  const { scenario, storage } = opts;
  let settings = scenarioSettings(scenario);
  const stored = storage?.getItem(KEY);
  if (stored) settings = JSON.parse(stored) as StationSettings;
  let queue = demoQueue(scenario === 'failing');
  const history = scenario === 'empty' ? [] : demoHistory();

  const bridge: DemoBridge = {
    kind: 'demo',
    drawerPulses: 0,
    testPrints: 0,
    retried: [],
    cancelled: [],
    reprinted: [],
    autostart: null,
    tray: null,
    panelOpened: null,
    async loadSettings() {
      return structuredClone(settings);
    },
    async saveSettings(next) {
      settings = structuredClone(next);
      storage?.setItem(KEY, JSON.stringify(settings));
    },
    async discoverPrinters() {
      return DEMO_DISCOVERED.map((d) => ({ ...d }));
    },
    async testPrint() {
      bridge.testPrints += 1;
    },
    async openDrawer() {
      bridge.drawerPulses += 1;
    },
    async status(): Promise<StationStatus> {
      const failing = scenario === 'failing';
      return {
        connection: scenario === 'offline' ? 'offline' : 'online',
        lastSignalAt: new Date(Date.now() - (scenario === 'offline' ? 240_000 : 5_000)).toISOString(),
        printingEnabled: true,
        printers: settings.printers.map((p) => ({
          id: p.id,
          health: failing && p.name === 'Caja' ? 'error' : p.name === 'Barra' ? 'printing' : 'ready',
          error: failing && p.name === 'Caja' ? 'Sin papel' : undefined,
        })),
        queue: scenario === 'empty' ? [] : queue,
        history,
        printedToday: scenario === 'empty' ? 0 : 46,
        version: '0.1.0',
      };
    },
    async enqueueJobs() {},
    async takeAcks() {
      return [];
    },
    async markAcked() {},
    async retryJob(id) {
      bridge.retried.push(id);
      queue = queue.map((q) => (q.id === id ? { ...q, status: 'pending', error: undefined } : q));
    },
    async cancelJob(id) {
      bridge.cancelled.push(id);
      queue = queue.filter((q) => q.id !== id);
    },
    async reprint(id) {
      bridge.reprinted.push(id);
    },
    async setAutostart(enabled) {
      bridge.autostart = enabled;
    },
    async updateTray(items, tooltip) {
      bridge.tray = { items, tooltip };
    },
    async openPanel(page) {
      bridge.panelOpened = page ?? 'estado';
    },
    async showVipe() {},
  };
  return bridge;
}
