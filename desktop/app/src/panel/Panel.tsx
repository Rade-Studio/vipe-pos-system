import { Clock, History, Home, List, Printer, Settings } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Station, VipeApiClient } from '../api/contract';
import type { Bridge, StationSettings, StationStatus } from '../bridge/types';
import { agoText, trayMenu } from './model';
import { Ajustes } from './pages/Ajustes';
import { Cola } from './pages/Cola';
import { Estado } from './pages/Estado';
import { Historial } from './pages/Historial';
import { Impresoras } from './pages/Impresoras';

export type Page = 'estado' | 'impresoras' | 'cola' | 'historial' | 'ajustes';

export interface PanelProps {
  api: VipeApiClient;
  bridge: Bridge;
  initial: StationSettings;
  initialPage?: string;
  onAddPrinter: () => void;
}

export interface PanelContext {
  api: VipeApiClient;
  bridge: Bridge;
  settings: StationSettings;
  status: StationStatus;
  stations: Station[];
  go: (page: Page) => void;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<StationSettings>) => Promise<void>;
  onAddPrinter: () => void;
}

const PAGES: { id: Page; label: string; Icon: typeof Home }[] = [
  { id: 'estado', label: 'Estado', Icon: Home },
  { id: 'impresoras', label: 'Impresoras', Icon: Printer },
  { id: 'cola', label: 'Cola', Icon: List },
  { id: 'historial', label: 'Historial', Icon: History },
  { id: 'ajustes', label: 'Ajustes', Icon: Settings },
];

const asPage = (p?: string): Page => (PAGES.some((x) => x.id === p) ? (p as Page) : 'estado');

/** Estación panel: Estado, Impresoras, Cola, Historial, Ajustes. */
export function Panel({ api, bridge, initial, initialPage, onAddPrinter }: PanelProps) {
  const [page, setPage] = useState<Page>(asPage(initialPage));
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<StationStatus | null>(null);
  const [stations, setStations] = useState<Station[]>([]);

  const refresh = useCallback(async () => {
    const next = await bridge.status();
    setStatus(next);
    const menu = trayMenu(settings, next);
    await bridge.updateTray(menu.items, menu.tooltip);
  }, [bridge, settings]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api.stations().then(setStations, () => setStations([]));
  }, [api]);

  if (!status) return null;
  const ctx: PanelContext = {
    api,
    bridge,
    settings,
    status,
    stations,
    go: setPage,
    refresh,
    onAddPrinter,
    saveSettings: async (patch) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await bridge.saveSettings(next);
    },
  };
  const failed = status.queue.filter((q) => q.status === 'failed').length;
  const online = status.connection === 'online';
  const { restaurant } = settings;

  return (
    <div className="shell">
      <div className="body">
        <aside className="side">
          <div className="brand">
            <span className="mark" aria-hidden>
              <Printer size={18} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{restaurant?.name ?? 'Sin vincular'}</b>
              <small>{restaurant ? `${restaurant.branch} · Estación` : 'Vincula con un código'}</small>
            </span>
          </div>
          <nav className="nav" aria-label="Estación de impresión">
            {PAGES.map(({ id, label, Icon }) => {
              const count = id === 'impresoras' ? settings.printers.length : id === 'cola' ? status.queue.length : 0;
              return (
                <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
                  <Icon aria-hidden size={18} />
                  {label}
                  {count > 0 && <span className={`count ${id === 'cola' && failed ? 's-danger' : ''}`}>{count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="side-foot">
            <span className={`chip ${online ? 's-ok' : status.connection === 'reconnecting' ? 's-warning' : 's-danger'}`}>
              <span className="dot" /> {online ? 'Conectado a VIPE' : status.connection === 'reconnecting' ? 'Reconectando' : 'Sin conexión'}
            </span>
            <span className="r">
              <Clock aria-hidden /> {agoText(status.lastSignalAt)}
            </span>
          </div>
        </aside>
        <main className="main">
          {page === 'estado' && <Estado ctx={ctx} />}
          {page === 'impresoras' && <Impresoras ctx={ctx} />}
          {page === 'cola' && <Cola ctx={ctx} />}
          {page === 'historial' && <Historial ctx={ctx} />}
          {page === 'ajustes' && <Ajustes ctx={ctx} />}
        </main>
      </div>
    </div>
  );
}
