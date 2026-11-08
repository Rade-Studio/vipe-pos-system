import { Link } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage, type Station } from '../../api/contract';
import type { StationSettings } from '../../bridge/types';
import type { StepContext } from '../Setup';
import { Acts, NextButton } from './common';
import { StationOptions } from './printerFields';
import { usePrinter } from './StepView';

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
        const caja = list.find((s) => s.fixed);
        // The core prints invoices without a station on the Caja printers.
        const patch: Partial<StationSettings> = { cajaStationId: caja?.id ?? null };
        // A printer with a cash drawer starts on the Caja station.
        if (caja && printer && printer.stationIds.length === 0 && printer.hasDrawer) {
          patch.printers = ctx.settings.printers.map((p, i) => (i === index ? { ...p, stationIds: [caja.id] } : p));
        }
        ctx.update(patch);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (!printer) return null;

  const following = ctx.settings.printers[index + 1];

  return (
    <section className="step">
      <p className="eyebrow">Paso 7 de 9 · {printer.name}</p>
      <h1>¿Para qué estación imprime?</h1>
      {error && <p className="err" role="alert">{error}</p>}
      <StationOptions printer={printer} set={set} stations={stations ?? []} />
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
