// Status shown outside the panel: the title-bar pill and the tray menu.
import type { PrinterState, StationSettings, StationStatus, TrayItem } from '../bridge/types';

export type Tone = 'ok' | 'warning' | 'danger' | 'muted';

export const TONE_CLASS: Record<Tone, string> = { ok: 's-ok', warning: 's-warning', danger: 's-danger', muted: '' };

export function healthLabel(state: PrinterState | undefined): string {
  switch (state?.health) {
    case 'printing':
      return 'Imprimiendo';
    case 'error':
      return state.error ?? 'Con falla';
    case 'offline':
      return 'Sin conexión';
    default:
      return 'Lista';
  }
}

export function failingPrinters(status: StationStatus) {
  return status.printers.filter((p) => p.health === 'error' || p.health === 'offline');
}

export function statusPill(settings: StationSettings, status: StationStatus): { tone: Tone; label: string } {
  if (status.connection === 'offline') return { tone: 'danger', label: 'Sin conexión' };
  if (status.connection === 'reconnecting') return { tone: 'warning', label: 'Reconectando' };
  if (settings.printers.length === 0) return { tone: 'muted', label: 'Sin impresoras' };
  if (!status.printingEnabled) return { tone: 'muted', label: 'Impresión apagada' };
  const failing = failingPrinters(status).length;
  if (failing > 0) return { tone: 'danger', label: `Impresión: ${failing} con falla` };
  const ready = settings.printers.length;
  return { tone: 'ok', label: `Impresión: ${ready} ${ready === 1 ? 'lista' : 'listas'}` };
}

export function trayMenu(settings: StationSettings, status: StationStatus): { items: TrayItem[]; tooltip: string } {
  const printers: TrayItem[] = settings.printers.length
    ? settings.printers.map((p) => ({
        id: `printer:${p.id}`,
        label: `${p.name} · ${healthLabel(status.printers.find((s) => s.id === p.id))}`,
        enabled: false,
      }))
    : [{ id: 'printer:none', label: 'Sin impresoras', enabled: false }];
  return {
    tooltip: `VIPE — ${statusPill(settings, status).label}`,
    items: [
      { id: 'open_vipe', label: 'Abrir VIPE', enabled: true },
      { id: 'open_panel', label: 'Estación de impresión', enabled: true },
      ...printers,
      { id: 'quit', label: 'Salir', enabled: true },
    ],
  };
}

const TIME = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
export const clock = (iso: string) => TIME.format(new Date(iso));

export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Sin señal todavía';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `Última señal hace ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `Última señal hace ${m} min` : `Última señal hace ${Math.round(m / 60)} h`;
}
