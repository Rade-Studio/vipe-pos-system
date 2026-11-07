import type { PanelContext } from '../Panel';
import { clock } from '../model';
import { HistoryChip } from '../parts';

export function Historial({ ctx }: { ctx: PanelContext }) {
  const { history } = ctx.status;
  return (
    <>
      <header className="ph">
        <div>
          <h1>Historial</h1>
          <p>Lo impreso en los últimos 7 días en este computador.</p>
        </div>
      </header>
      <section className="card">
        {history.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>Todavía no se ha impreso nada.</p>
        ) : (
          <ul className="rows">
            {history.map((h) => (
              <li key={h.id}>
                <time>{clock(h.at)}</time>
                <span className="who">
                  <b>{h.title}</b>
                  <small>{h.detail}</small>
                </span>
                <HistoryChip item={h} />
                <button type="button" className="btn sm" onClick={() => void ctx.bridge.reprint(h.id).then(ctx.refresh)}>
                  Reimprimir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
