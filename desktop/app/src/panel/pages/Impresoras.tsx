import { Inbox, Link, Plus, Settings2 } from 'lucide-react';
import type { PanelContext } from '../Panel';
import { HealthChip, PrinterIcon, StationChips, printerLine, whatPrints } from '../parts';
import { AddPrinter } from './AddPrinter';
import { EditPrinter } from './EditPrinter';
import { EmptyPrinters } from './Estado';

export function Impresoras({ ctx }: { ctx: PanelContext }) {
  const { settings, status, stations, card } = ctx;
  const editing = card?.mode === 'edit' ? settings.printers.find((p) => p.id === card.id) : undefined;
  if (card?.mode === 'add') return <AddPrinter ctx={ctx} />;
  if (editing) return <EditPrinter key={editing.id} ctx={ctx} original={editing} />;
  return (
    <>
      <header className="ph">
        <div style={{ flex: 1 }}>
          <h1>Impresoras</h1>
          <p>Cada impresora imprime lo de sus estaciones. Qué platos van a cada estación se define en VIPE web.</p>
        </div>
        {settings.printers.length > 0 && (
          <button type="button" className="btn primary" onClick={() => ctx.openCard({ mode: 'add' })}>
            <Plus aria-hidden /> Agregar impresora
          </button>
        )}
      </header>
      {settings.printers.length === 0 ? (
        <EmptyPrinters ctx={ctx} />
      ) : (
        <section className="card">
          <ul className="rows">
            {settings.printers.map((p) => {
              const st = status.printers.find((s) => s.id === p.id);
              const prints = whatPrints(p, stations);
              return (
                <li key={p.id} className="tall">
                  <PrinterIcon printer={p} state={st} />
                  <span className="who">
                    <b>{p.name}</b>
                    <small className="wrap">{printerLine(p)}</small>
                    <span className="what">
                      <em className="muted" style={{ fontStyle: 'normal' }}>Qué imprime: </em>
                      <span>{prints || 'ninguna estación asignada'}</span>
                    </span>
                  </span>
                  <StationChips printer={p} stations={stations} />
                  <HealthChip state={st} />
                  <span className="acts-row">
                    <button type="button" className="btn sm" onClick={() => ctx.openCard({ mode: 'edit', id: p.id })}>
                      <Settings2 aria-hidden /> Configurar
                    </button>
                    {p.hasDrawer ? (
                      <button type="button" className="btn sm" onClick={() => void ctx.bridge.openDrawer(p)}>
                        <Inbox aria-hidden /> Abrir cajón
                      </button>
                    ) : (
                      <button type="button" className="btn sm" onClick={() => void ctx.bridge.testPrint(p, settings.restaurant)}>
                        Imprimir prueba
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="route-note">
        <Link aria-hidden size={18} />
        <span style={{ flex: 1 }}>
          Para mover un plato o una categoría a otra estación, cámbialo en <b>VIPE web → Ajustes → Estaciones y rutas</b>.
          Esta computadora imprime lo que VIPE le envía.
        </span>
      </div>
    </>
  );
}
