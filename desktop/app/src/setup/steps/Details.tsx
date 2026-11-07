import { Check, Inbox } from 'lucide-react';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';
import { usePrinter } from './StepView';

/** Step 5: name, paper width, cash drawer and cutter of one printer. */
export function Details({ ctx }: { ctx: StepContext }) {
  const { printer, set, index, total } = usePrinter(ctx);
  if (!printer) return null;
  const testDrawer = async () => {
    await ctx.bridge.openDrawer(printer);
    set({ drawerTested: true });
  };
  return (
    <section className="step">
      <p className="eyebrow">
        Paso 5 de 9 · Impresora {index + 1} de {total}
      </p>
      <h1>{printer.model}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <label className="field">
          <span>Nombre</span>
          <input className="input" value={printer.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="field">
          <span>Ancho del papel</span>
          <div className="opts cols">
            {([58, 80] as const).map((mm) => (
              <Opt key={mm} pressed={printer.paperMm === mm} onClick={() => set({ paperMm: mm })} title={`${mm} mm`} />
            ))}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: '8px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Opt
              kind="check"
              pressed={printer.hasDrawer}
              onClick={() => set({ hasDrawer: !printer.hasDrawer })}
              title="Tiene cajón de dinero conectado"
              hint="VIPE lo abre al cobrar en efectivo y queda registrado quién lo abrió."
            />
          </div>
          {printer.hasDrawer && (
            <button type="button" className="btn" onClick={() => void testDrawer()}>
              <Inbox aria-hidden /> {printer.drawerTested ? 'Cajón probado' : 'Probar cajón'}
            </button>
          )}
        </div>
        <Opt
          kind="check"
          pressed={printer.cut}
          onClick={() => set({ cut: !printer.cut })}
          title="Cortar el papel al terminar"
          hint="Si tu impresora no tiene cuchilla, desactívalo."
        />
      </div>
      <p className="note">
        <Check aria-hidden />
        Detectamos {printer.paperMm} mm automáticamente; cámbialo solo si no coincide.
      </p>
      <Acts onBack={() => void ctx.back()}>
        <NextButton label="Siguiente: prueba" onClick={() => void ctx.next()} disabled={!printer.name.trim()} />
      </Acts>
    </section>
  );
}
