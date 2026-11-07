import { Link } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage, type Station } from '../../api/contract';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';
import { usePrinter } from './StepView';

export function stationHint(s: Station) {
  if (s.fixed) return 'Facturas, precuentas y cierre de caja. Abre el cajón.';
  return `Qué imprime: ${s.prints}${s.productCount ? ` · ${s.productCount} productos` : ''}`;
}

/** Step 7: which stations this printer serves. Routing itself is read-only (L10). */
export function StationStep({ ctx }: { ctx: StepContext }) {
  const { printer, set, index, total } = usePrinter(ctx);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ctx.api
      .stations()
      .then((list) => {
        setStations(list);
        // A printer with a cash drawer starts on the Caja station.
        if (printer && printer.stationIds.length === 0 && printer.hasDrawer) {
          const caja = list.find((s) => s.fixed);
          if (caja) set({ stationIds: [caja.id] });
        }
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (!printer) return null;

  const toggle = (id: string) =>
    set({ stationIds: printer.stationIds.includes(id) ? printer.stationIds.filter((s) => s !== id) : [...printer.stationIds, id] });
  const following = ctx.settings.printers[index + 1];

  return (
    <section className="step">
      <p className="eyebrow">Paso 7 de 9 · {printer.name}</p>
      <h1>¿Para qué estación imprime?</h1>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="opts">
        {(stations ?? []).map((s) => (
          <Opt
            key={s.id}
            kind="check"
            pressed={printer.stationIds.includes(s.id)}
            onClick={() => toggle(s.id)}
            title={s.name}
            hint={stationHint(s)}
            tail={s.fixed ? <span className="ro">Fija</span> : undefined}
          />
        ))}
      </div>
      <p className="note">
        <Link aria-hidden />
        Qué plato va a cada estación se decide en VIPE web → Estaciones y rutas; aquí solo se ve. Una impresora puede servir
        varias estaciones (un ticket por estación).
      </p>
      <Acts onBack={() => void ctx.back()}>
        {following && <span className="hint">Sigue: {following.model}</span>}
        <NextButton
          label={index + 1 < total ? 'Siguiente impresora' : 'Siguiente'}
          onClick={() => void ctx.next()}
          disabled={printer.stationIds.length === 0}
        />
      </Acts>
    </section>
  );
}
