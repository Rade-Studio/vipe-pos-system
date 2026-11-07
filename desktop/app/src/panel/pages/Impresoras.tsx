import { Inbox, Link, Plus } from 'lucide-react';
import type { PanelContext } from '../Panel';
import { HealthChip, PrinterIcon, StationChips, printerLine, whatPrints } from '../parts';
import { EmptyPrinters } from './Estado';

export function Impresoras({ ctx }: { ctx: PanelContext }) {
  const { settings, status, stations } = ctx;
  return (
    <>
      <header className="ph">
        <div style={{ flex: 1 }}>
          <h1>Impresoras</h1>
          <p>Cada impresora imprime lo de sus estaciones. Qué platos van a cada estación se define en VIPE web.</p>
        </div>
        {settings.printers.length > 0 && (
          <button type="button" className="btn primary" onClick={ctx.onAddPrinter}>
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
                    <small>{printerLine(p)}</small>
                    <span className="what">
                      <em className="muted" style={{ fontStyle: 'normal' }}>Qué imprime: </em>
                      <span>{prints || 'ninguna estación asignada'}</span>
                    </span>
                  </span>
                  <StationChips printer={p} stations={stations} />
                  <HealthChip state={st} />
                  <span className="acts-row">
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
