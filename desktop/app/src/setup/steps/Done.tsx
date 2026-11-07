import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Station } from '../../api/contract';
import type { LocalPrinter } from '../../bridge/types';
import type { StepContext } from '../Setup';
import { NextButton } from './common';

export function printerSummary(p: LocalPrinter, stations: Station[]) {
  const names = p.stationIds.map((id) => stations.find((s) => s.id === id)?.name ?? id).join(' y ');
  const proof = p.drawerTested ? 'cajón probado' : p.testResult === 'ok' ? 'prueba bien' : 'sin prueba';
  return names ? `${p.name} → ${names} · ${proof}` : `${p.name} · sin estación · ${proof}`;
}

/** Step 9: summary and "Abrir la caja". */
export function Done({ ctx }: { ctx: StepContext }) {
  const { restaurant, printers, autostart, autoUpdate } = ctx.settings;
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    ctx.api.stations().then(setStations, () => setStations([]));
  }, []);

  const served = [...new Set(printers.flatMap((p) => p.stationIds))]
    .map((id) => stations.find((s) => s.id === id)?.name)
    .filter(Boolean);
  const startup = [autostart ? 'Abre al encender' : 'No abre al encender', autoUpdate ? 'actualiza fuera del servicio' : 'actualización manual'].join(' · ');

  return (
    <section className="step" style={{ justifyItems: 'center', textAlign: 'center' }}>
      <span className="bigok" aria-hidden>
        <Check />
      </span>
      <h1>Listo, {restaurant?.name}</h1>
      <p className="lead">
        {printers.length
          ? `Este computador imprime para ${served.join(' y ') || 'sus estaciones'}. Inicia sesión con tu usuario y empieza a vender.`
          : 'Este computador abre VIPE sin imprimir; las comandas se ven en la pantalla de cocina. Inicia sesión y empieza a vender.'}
      </p>
      <ul className="sum card" style={{ width: '100%', maxWidth: 520, textAlign: 'left' }}>
        <li>
          <Check aria-hidden />
          <span>
            Vinculado con <b>{restaurant?.branch}</b>
          </span>
        </li>
        {printers.map((p) => (
          <li key={p.id}>
            <Check aria-hidden />
            <span>{printerSummary(p, stations)}</span>
          </li>
        ))}
        <li>
          <Check aria-hidden />
          <span>{startup}</span>
        </li>
      </ul>
      <NextButton label="Abrir la caja" onClick={ctx.finish} />
    </section>
  );
}
