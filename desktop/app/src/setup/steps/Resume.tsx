import { Check, ChevronRight } from 'lucide-react';
import type { StationSettings } from '../../bridge/types';
import { resumeTarget } from '../flow';
import { Acts, NextButton } from './common';

/** "Sigamos donde quedaste": shown when VIPE opens with a half-done setup. */
export function Resume({ settings, onContinue, onRestart }: { settings: StationSettings; onContinue: () => void; onRestart: () => void }) {
  const n = resumeTarget(settings.setup);
  const { restaurant, printers } = settings;
  return (
    <section className="step">
      <p className="eyebrow">Configuración a medias</p>
      <h1>Sigamos donde quedaste</h1>
      <p className="lead">{`Cerraste VIPE en el paso ${n} de 9. Lo que ya hiciste quedó guardado.`}</p>
      <ul className="sum card">
        {restaurant && (
          <li>
            <Check aria-hidden />
            <span>
              Vinculado con <b>{`${restaurant.name} · ${restaurant.branch}`}</b>
            </span>
          </li>
        )}
        {printers.length > 0 && (
          <li>
            <Check aria-hidden />
            <span>{`${printers.length} ${printers.length === 1 ? 'impresora encontrada' : 'impresoras encontradas'}`}</span>
          </li>
        )}
        <li>
          <ChevronRight aria-hidden className="todo" />
          <span>
            {n <= 7 && printers.length
              ? 'Falta: nombre, papel, prueba y estación de cada impresora'
              : 'Falta: terminar los pasos que quedan'}
          </span>
        </li>
      </ul>
      <Acts>
        <button type="button" className="btn" onClick={onRestart} style={{ marginRight: 'auto' }}>
          Empezar de cero
        </button>
        <NextButton label={`Continuar en el paso ${n}`} onClick={onContinue} />
      </Acts>
    </section>
  );
}
