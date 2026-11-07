import { useState } from 'react';
import type { QueueItem } from '../../bridge/types';
import type { PanelContext } from '../Panel';
import { clock } from '../model';
import { JobChip } from '../parts';

const FILTERS: { id: QueueItem['status'] | 'all'; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'pending', label: 'En espera' },
  { id: 'printing', label: 'Imprimiendo' },
  { id: 'failed', label: 'Fallidos' },
];

export function Cola({ ctx }: { ctx: PanelContext }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const { queue } = ctx.status;
  const rows = queue.filter((q) => filter === 'all' || q.status === filter);
  const act = async (fn: () => Promise<void>) => {
    await fn();
    await ctx.refresh();
  };

  return (
    <>
      <header className="ph">
        <div>
          <h1>Cola de impresión</h1>
          <p>Los trabajos se guardan en este computador hasta que salen impresos.</p>
        </div>
      </header>
      <div className="tabs" role="group" aria-label="Filtrar cola">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.id === 'all' ? `Todo · ${queue.length}` : f.label}
          </button>
        ))}
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>Nada en la cola. Las comandas salen en segundos.</p>
        ) : (
          <ul className="rows">
            {rows.map((q) => (
              <li key={q.id}>
                <time>{clock(q.at)}</time>
                <span className="who">
                  <b>{q.title}</b>
                  <small>{`${q.detail}${q.attempts ? ` · intento ${q.attempts}` : ''}`}</small>
                </span>
                <JobChip item={q} />
                {q.status === 'failed' ? (
                  <button type="button" className="btn sm" onClick={() => void act(() => ctx.bridge.retryJob(q.id))}>
                    Reintentar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={q.status === 'printing'}
                    onClick={() => void act(() => ctx.bridge.cancelJob(q.id))}
                  >
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
