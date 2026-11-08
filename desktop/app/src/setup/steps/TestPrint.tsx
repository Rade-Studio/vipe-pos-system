import type { StepContext } from '../Setup';
import { Acts, NextButton } from './common';
import { TestPrintBody } from './printerFields';
import { usePrinter } from './StepView';

/** Step 6: print a test ticket and ask how it came out. */
export function TestPrint({ ctx }: { ctx: StepContext }) {
  const { printer, set } = usePrinter(ctx);
  if (!printer) return null;
  return (
    <section className="step">
      <p className="eyebrow">Paso 6 de 9 · {printer.name}</p>
      <h1>Imprimimos una prueba. ¿Cómo salió?</h1>
      <TestPrintBody printer={printer} set={set} bridge={ctx.bridge} restaurant={ctx.settings.restaurant} />
      <Acts onBack={() => void ctx.back()}>
        <NextButton onClick={() => void ctx.next()} disabled={printer.testResult !== 'ok'} />
      </Acts>
    </section>
  );
}
