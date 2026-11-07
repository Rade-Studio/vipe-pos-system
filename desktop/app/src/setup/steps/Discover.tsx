import { Bluetooth, Network, RefreshCw, Search, Usb } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConnectionKind } from '../../api/contract';
import { toLocal } from '../../bridge/demoData';
import type { DiscoveredPrinter } from '../../bridge/types';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';

const KIND_ICON = { usb: Usb, network: Network, bluetooth: Bluetooth } as const;
const TABS: { id: ConnectionKind | 'all'; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'usb', label: 'USB' },
  { id: 'network', label: 'Red' },
  { id: 'bluetooth', label: 'Bluetooth' },
];
const KIND_LABEL = { usb: 'USB', network: 'Red', bluetooth: 'Bluetooth' } as const;

/** Step 4: search USB (Windows printers), network and Bluetooth printers. */
export function Discover({ ctx }: { ctx: StepContext }) {
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<ConnectionKind | 'all'>('all');

  const search = async () => {
    setFound(null);
    const list = await ctx.bridge.discoverPrinters();
    setFound(list);
    setSelected(new Set(list.map((p) => p.id)));
  };
  useEffect(() => {
    void search();
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = (found ?? []).filter((p) => selected.has(p.id));
  const visible = (found ?? []).filter((p) => tab === 'all' || p.connection === tab);
  const keep = () => {
    const existing = new Map(ctx.settings.printers.map((p) => [p.id, p]));
    void ctx.next({ printers: chosen.map((d) => existing.get(d.id) ?? toLocal(d)) });
  };

  return (
    <section className="step">
      <p className="eyebrow">Paso 4 de 9</p>
      <h1>{found === null ? 'Buscando impresoras…' : found.length ? `Encontramos ${found.length} impresoras` : 'No encontramos impresoras'}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="tabs" role="group" aria-label="Tipo de conexión">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {(() => {
                const Icon = t.id === 'all' ? Search : KIND_ICON[t.id];
                return <Icon aria-hidden size={15} />;
              })()}
              {t.label}
            </button>
          ))}
        </div>
        <span className="scan" style={{ flex: 1 }}>
          <RefreshCw aria-hidden className={found === null ? 'spin' : undefined} />
          {found === null ? 'Buscando en USB, la red y Bluetooth…' : 'Búsqueda terminada'}
        </span>
        <button type="button" className="btn" onClick={() => void search()}>
          <RefreshCw aria-hidden /> Buscar de nuevo
        </button>
      </div>
      {found && found.length === 0 && (
        <p className="lead">
          Revisa que la impresora esté encendida y conectada por USB o a la misma red. También puedes seguir sin
          impresoras y agregarlas después en el panel de estación.
        </p>
      )}
      <div className="opts">
        {visible.map((p) => {
          const Icon = KIND_ICON[p.connection];
          return (
            <Opt
              key={p.id}
              kind="check"
              pressed={selected.has(p.id)}
              onClick={() => toggle(p.id)}
              icon={
                <span className="pi" aria-hidden>
                  <Icon />
                </span>
              }
              title={p.model}
              hint={`${KIND_LABEL[p.connection]} · ${p.detail}`}
              tail={<span className="chip s-ok">Lista</span>}
            />
          );
        })}
      </div>
      <Acts onBack={() => void ctx.back()}>
        {chosen.length > 0 ? (
          <NextButton label={`Configurar ${chosen.length} ${chosen.length === 1 ? 'impresora' : 'impresoras'}`} onClick={keep} />
        ) : (
          <NextButton label="Seguir sin impresoras" onClick={keep} disabled={found === null} />
        )}
      </Acts>
    </section>
  );
}
