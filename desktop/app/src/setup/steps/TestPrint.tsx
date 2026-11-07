import { AlertTriangle, Check, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TestResult } from '../../bridge/types';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';
import { usePrinter } from './StepView';

/** Step 6: print a test ticket and ask how it came out. */
export function TestPrint({ ctx }: { ctx: StepContext }) {
  const { printer, set } = usePrinter(ctx);
  const [error, setError] = useState<string | null>(null);
  const restaurant = ctx.settings.restaurant;

  const print = async (p = printer) => {
    setError(null);
    try {
      await ctx.bridge.testPrint(p, restaurant);
    } catch (e) {
      setError(`No se pudo enviar la prueba: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    void print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!printer) return null;

  const choose = (result: TestResult) => {
    set({ testResult: result });
    if (result === 'garbled') {
      // Try the other code page: UTF-8 firmware prints CP1252 accents as symbols and vice versa.
      const next = { ...printer, testResult: result, encoding: printer.encoding === 'cp1252' ? ('utf-8' as const) : ('cp1252' as const) };
      set({ encoding: next.encoding });
      void print(next);
    }
  };

  return (
    <section className="step">
      <p className="eyebrow">Paso 6 de 9 · {printer.name}</p>
      <h1>Imprimimos una prueba. ¿Cómo salió?</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 250px', gap: 28, alignItems: 'start' }}>
        <div className="opts">
          <Opt pressed={printer.testResult === 'ok'} onClick={() => choose('ok')} title="Salió bien"
            hint="Texto nítido, tildes y ñ correctas, papel cortado."
            icon={<span className="pi s-ok" aria-hidden><Check /></span>} />
          <Opt pressed={printer.testResult === 'garbled'} onClick={() => choose('garbled')} title="Salió cortada o con símbolos raros"
            hint="Probamos otra codificación y la imprimimos otra vez."
            icon={<span className="pi s-warning" aria-hidden><AlertTriangle /></span>} />
          <Opt pressed={printer.testResult === 'nothing'} onClick={() => choose('nothing')} title="No salió nada"
            hint="Te ayudamos a revisar papel, tapa y conexión."
            icon={<span className="pi s-danger" aria-hidden><X /></span>} />
          {printer.testResult === 'nothing' && (
            <p className="note">
              <AlertTriangle aria-hidden />
              Revisa que tenga papel, que la tapa esté cerrada y que el cable o la red estén conectados; luego imprime otra vez.
            </p>
          )}
          {error && <p className="err" role="alert">{error}</p>}
          <div>
            <button type="button" className="btn" onClick={() => void print()}>
              <Play aria-hidden /> Imprimir otra vez
            </button>
          </div>
        </div>
        <div className="ticket" aria-label="Vista previa de la prueba">
          <div className="c"><b>{(restaurant?.name ?? 'VIPE').toUpperCase()}</b></div>
          <div className="c">{restaurant?.branch}</div>
          <hr />
          {`PRUEBA DE IMPRESIÓN\n${printer.name} · ${printer.paperMm} mm\nÑandú, café, jalapeño`}
          <hr />
          {'Bandeja paisa ...... 31.900\nLimonada coco ..... 12.900'}
          <hr />
          <div className="c">VIPE 0.1.0</div>
        </div>
      </div>
      <Acts onBack={() => void ctx.back()}>
        <NextButton onClick={() => void ctx.next()} disabled={printer.testResult !== 'ok'} />
      </Acts>
    </section>
  );
}
