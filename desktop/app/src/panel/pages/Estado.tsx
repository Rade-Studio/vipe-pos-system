import { CloudOff, FileWarning, Inbox, Plus, Printer } from 'lucide-react';
import type { PanelContext } from '../Panel';
import { failingPrinters } from '../model';
import { HealthChip, HistoryChip, JobChip, PrinterIcon, StationChips } from '../parts';
import { clock } from '../model';

export async function openDrawer(ctx: PanelContext) {
  const printer = ctx.settings.printers.find((p) => p.hasDrawer);
  if (!printer) return;
  await ctx.bridge.openDrawer(printer);
  await ctx.api.drawerOpened({ printerId: printer.id, openedAt: new Date().toISOString(), reason: 'manual' }).catch(() => undefined);
}

export function EmptyPrinters({ ctx }: { ctx: PanelContext }) {
  return (
    <div className="card empty">
      <span className="big" aria-hidden>
        <Printer size={28} />
      </span>
      <h2>Agrega tu primera impresora</h2>
      <p>VIPE funciona sin impresoras: las comandas se ven en la pantalla de cocina. Si este computador tiene una impresora térmica, agrégala aquí.</p>
      <button type="button" className="btn primary" onClick={ctx.onAddPrinter}>
        <Plus aria-hidden /> Agregar impresora
      </button>
    </div>
  );
}

export function Estado({ ctx }: { ctx: PanelContext }) {
  const { settings, status, stations } = ctx;
  const failing = failingPrinters(status);
  const hasDrawer = settings.printers.some((p) => p.hasDrawer);
  const subtitle = failing.length
    ? `${failing.length} ${failing.length === 1 ? 'impresora necesita' : 'impresoras necesitan'} atención · ${status.printedToday} impresiones hoy`
    : `Todo imprime con normalidad · ${status.printedToday} impresiones hoy`;

  return (
    <>
      <header className="ph">
        <div style={{ flex: 1 }}>
          <h1>Estado</h1>
          <p>{settings.printers.length ? subtitle : 'Este computador todavía no tiene impresoras'}</p>
        </div>
        {hasDrawer && (
          <button type="button" className="btn" onClick={() => void openDrawer(ctx)}>
            <Inbox aria-hidden /> Abrir cajón
          </button>
        )}
      </header>
      {status.connection !== 'online' && (
        <div className="alert s-danger" role="status">
          <CloudOff aria-hidden size={18} />
          <p style={{ flex: 1 }}>
            <b>Sin conexión con VIPE</b>
            <br />
            Lo que ya está en la cola se sigue imprimiendo; las comandas nuevas llegan al volver la conexión.
          </p>
        </div>
      )}
      {failing.map((f) => {
        const p = settings.printers.find((x) => x.id === f.id);
        return (
          <div key={f.id} className="alert s-danger" role="alert">
            <FileWarning aria-hidden size={18} />
            <p style={{ flex: 1 }}>
              <b>{`${p?.name ?? 'Impresora'} ${(f.error ?? 'con falla').toLowerCase()}`}</b>
              <br />
              Cambia el rollo o revisa la tapa; lo pendiente sale solo al resolverlo.
            </p>
            <button type="button" className="btn sm" onClick={() => ctx.go('cola')}>
              Ver cola
            </button>
          </div>
        );
      })}
      {settings.printers.length === 0 ? (
        <EmptyPrinters ctx={ctx} />
      ) : (
        <div className="grid2">
          <section className="card">
            <h2>
              Impresoras
              <button type="button" className="linkbtn" onClick={() => ctx.go('impresoras')}>Ver todas</button>
            </h2>
            <ul className="rows">
              {settings.printers.map((p) => {
                const st = status.printers.find((s) => s.id === p.id);
                return (
                  <li key={p.id}>
                    <PrinterIcon printer={p} state={st} />
                    <span className="who">
                      <b>{p.name}</b>
                      <small>{p.model}</small>
                    </span>
                    <StationChips printer={p} stations={stations} />
                    <HealthChip state={st} />
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card">
            <h2>
              En cola ahora
              <button type="button" className="linkbtn" onClick={() => ctx.go('cola')}>Ver cola</button>
            </h2>
            <ul className="rows">
              {status.queue.slice(0, 3).map((q) => (
                <li key={q.id}>
                  <span className="who">
                    <b>{q.title}</b>
                    <small>{q.detail}</small>
                  </span>
                  <JobChip item={q} />
                </li>
              ))}
              <li className="muted" style={{ fontSize: 13 }}>Nada más por imprimir. Las comandas salen en segundos.</li>
            </ul>
          </section>
        </div>
      )}
      {status.history.length > 0 && (
        <section className="card">
          <h2>
            Últimas impresiones
            <button type="button" className="linkbtn" onClick={() => ctx.go('historial')}>Historial</button>
          </h2>
          <ul className="rows">
            {status.history.slice(0, 3).map((h) => (
              <li key={h.id}>
                <time>{clock(h.at)}</time>
                <span className="who">
                  <b>{h.title}</b>
                  <small>{h.detail}</small>
                </span>
                <HistoryChip item={h} />
                <button type="button" className="btn sm" onClick={() => void ctx.bridge.reprint(h.id)}>Reimprimir</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
