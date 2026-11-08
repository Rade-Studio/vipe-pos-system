import { Check, Clock, FileWarning, Printer, Usb, Network, Bluetooth } from 'lucide-react';
import type { ConnectionKind, Station } from '../api/contract';
import { describeAddress } from '../bridge/printer-address';
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

export function ConnectionIcon({ kind }: { kind: ConnectionKind }) {
  const Icon = kind === 'usb' ? Usb : kind === 'bluetooth' ? Bluetooth : kind === 'network' ? Network : Printer;
  return <Icon />;
}

export function PrinterIcon({ printer, state }: { printer: LocalPrinter; state: PrinterState | undefined }) {
  const tone = state?.health === 'error' || state?.health === 'offline' ? 's-danger' : state?.health === 'printing' ? 's-served' : 's-ok';
  return (
    <span className={`pr-ic ${tone}`} aria-hidden>
      <ConnectionIcon kind={printer.connection} />
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

/** "Xprinter XP-80 · Red · 192.168.1.50 · puerto 9100 · 80 mm" (S2). */
export function printerLine(p: LocalPrinter) {
  return `${p.model} · ${describeAddress(p)} · ${p.paperMm} mm`;
}
