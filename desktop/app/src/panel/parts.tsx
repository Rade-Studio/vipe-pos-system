import { Check, Clock, FileWarning, Printer, Usb, Network, Bluetooth } from 'lucide-react';
import type { Station } from '../api/contract';
import type { HistoryItem, LocalPrinter, PrinterState, QueueItem } from '../bridge/types';
import { healthLabel } from './model';

const STATION_TONE = { cashier: 's-occupied', kitchen: 's-kitchen', bar: 's-served', other: 's-reserved' } as const;

export function StationChips({ printer, stations }: { printer: LocalPrinter; stations: Station[] }) {
  return (
    <>
      {printer.stationIds.map((id) => {
        const s = stations.find((x) => x.id === id);
        return (
          <span key={id} className={`chip ${STATION_TONE[s?.kind ?? 'other']}`}>
            {s?.name ?? '…'}
          </span>
        );
      })}
    </>
  );
}

export function HealthChip({ state }: { state: PrinterState | undefined }) {
  const label = healthLabel(state);
  if (state?.health === 'printing')
    return (
      <span className="chip s-served">
        <span className="dot pulse" /> {label}
      </span>
    );
  if (state?.health === 'error' || state?.health === 'offline')
    return (
      <span className="chip s-danger">
        <FileWarning aria-hidden /> {label}
      </span>
    );
  return (
    <span className="chip s-ok">
      <Check aria-hidden /> {label}
    </span>
  );
}

export function PrinterIcon({ printer, state }: { printer: LocalPrinter; state: PrinterState | undefined }) {
  const Icon = printer.connection === 'usb' ? Usb : printer.connection === 'bluetooth' ? Bluetooth : printer.connection === 'network' ? Network : Printer;
  const tone = state?.health === 'error' || state?.health === 'offline' ? 's-danger' : state?.health === 'printing' ? 's-served' : 's-ok';
  return (
    <span className={`pr-ic ${tone}`} aria-hidden>
      <Icon />
    </span>
  );
}

export function JobChip({ item }: { item: QueueItem }) {
  if (item.status === 'failed')
    return (
      <span className="chip s-danger">
        <FileWarning aria-hidden /> {`Falló: ${(item.error ?? 'error').toLowerCase()}`}
      </span>
    );
  if (item.status === 'printing')
    return (
      <span className="chip s-served">
        <span className="dot pulse" /> Imprimiendo
      </span>
    );
  return (
    <span className="chip s-warning">
      <Clock aria-hidden /> En espera
    </span>
  );
}

export function HistoryChip({ item }: { item: HistoryItem }) {
  if (item.status === 'printed')
    return (
      <span className="chip s-ok">
        <Check aria-hidden /> Impresa
      </span>
    );
  return <span className="chip">{item.status === 'cancelled' ? 'Cancelada' : 'No impresa'}</span>;
}

/** Read-only "Qué imprime" text of a printer, built from the server's stations. */
export function whatPrints(printer: LocalPrinter, stations: Station[]): string {
  return printer.stationIds
    .map((id) => stations.find((s) => s.id === id))
    .filter((s): s is Station => Boolean(s))
    .map((s) =>
      s.fixed ? `facturas y precuentas${printer.hasDrawer ? ' · abre el cajón al cobrar en efectivo' : ''}` : `comandas de ${s.prints}`,
    )
    .join(' · ');
}

export const CONNECTION_LABEL = { usb: 'USB', network: 'Red', bluetooth: 'Bluetooth' } as const;

export function printerLine(p: LocalPrinter) {
  const where = p.connection === 'network' ? p.address.replace(/:9100$/, '') : CONNECTION_LABEL[p.connection];
  return `${p.model} · ${where} · ${p.paperMm} mm`;
}
