import { Printer, X } from 'lucide-react';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';

/** Step 3: printing is optional (S2); "No" jumps to step 8. */
export function Prints({ ctx }: { ctx: StepContext }) {
  const { setup, restaurant } = ctx.settings;
  const prints = setup.prints !== false;
  const choose = (value: boolean) => ctx.update({ setup: { ...setup, prints: value } });
  return (
    <section className="step">
      <p className="eyebrow">Paso 3 de 9 · {restaurant?.name}</p>
      <h1>¿Este computador imprime?</h1>
      <p className="lead">
        Si aquí hay una impresora térmica (caja, cocina o barra), la configuramos ahora. Si no, VIPE funciona igual y las
        comandas se ven en la pantalla de cocina.
      </p>
      <div className="opts">
        <Opt
          pressed={prints}
          onClick={() => choose(true)}
          icon={
            <span className="pi s-served" aria-hidden>
              <Printer />
            </span>
          }
          title="Sí, tiene impresoras conectadas"
          hint="Buscaremos impresoras USB, de red y Bluetooth."
        />
        <Opt
          pressed={!prints}
          onClick={() => choose(false)}
          icon={
            <span className="pi" aria-hidden>
              <X />
            </span>
          }
          title="No, este restaurante no usa impresoras"
          hint="Saltamos al paso 8. Puedes agregarlas después en el panel de estación."
        />
      </div>
      <Acts onBack={() => void ctx.back()}>
        <NextButton onClick={() => void ctx.next({ setup: { ...setup, prints }, printers: prints ? ctx.settings.printers : [] })} />
      </Acts>
    </section>
  );
}
