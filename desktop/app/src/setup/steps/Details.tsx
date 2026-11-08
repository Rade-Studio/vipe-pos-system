import { Check } from 'lucide-react';
import type { StepContext } from '../Setup';
import { Acts, NextButton } from './common';
import { PrinterFields } from './printerFields';
import { usePrinter } from './StepView';

/** Step 5: name, paper width, cash drawer and cutter of one printer. */
export function Details({ ctx }: { ctx: StepContext }) {
  const { printer, set, index, total } = usePrinter(ctx);
  if (!printer) return null;
  return (
    <section className="step">
      <p className="eyebrow">
        Paso 5 de 9 · Impresora {index + 1} de {total}
      </p>
      <h1>{printer.model}</h1>
      <PrinterFields printer={printer} set={set} bridge={ctx.bridge} />
      <p className="note">
        <Check aria-hidden />
        Detectamos {printer.paperMm} mm y cuchilla automáticamente; cámbialo solo si no coincide.
      </p>
      <Acts onBack={() => void ctx.back()}>
        <NextButton label="Siguiente: prueba" onClick={() => void ctx.next()} disabled={!printer.name.trim()} />
      </Acts>
    </section>
  );
}
