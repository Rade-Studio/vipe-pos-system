// Printer step bodies shared by the first-run wizard (steps 5-7) and the
// panel's add and edit card. They only see the printer, never a step context.
import { AlertTriangle, Check, Inbox, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Restaurant, Station } from '../../api/contract';
import type { Bridge, LocalPrinter, TestResult } from '../../bridge/types';
import { Opt } from './common';

export type PrinterPatch = (patch: Partial<LocalPrinter>) => void;

export function stationHint(s: Station) {
  if (s.fixed) return 'Facturas, precuentas y cierre de caja. Abre el cajón.';
  return `Qué imprime: ${s.prints}${s.productCount ? ` · ${s.productCount} productos` : ''}`;
}

/** Name, paper width, cash drawer (with its test) and cutter. */
export function PrinterFields({ printer, set, bridge }: { printer: LocalPrinter; set: PrinterPatch; bridge: Bridge }) {
  const testDrawer = async () => {
    await bridge.openDrawer(printer);
    set({ drawerTested: true });
  };
  return (
    <>
      <div className="pf-grid">
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
      <div className="card checks" style={{ padding: '8px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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
    </>
  );
}

/** Prints a test ticket on mount and asks how it came out. */
export function TestPrintBody({ printer, set, bridge, restaurant }: { printer: LocalPrinter; set: PrinterPatch; bridge: Bridge; restaurant: Restaurant | null }) {
  const [error, setError] = useState<string | null>(null);
  const print = async (p = printer) => {
    setError(null);
    try {
      await bridge.testPrint(p, restaurant);
    } catch (e) {
      setError(`No se pudo enviar la prueba: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    void print();
  }, []);

  const choose = (result: TestResult) => {
    if (result !== 'garbled') return set({ testResult: result });
    // Try the other code page: UTF-8 firmware prints CP1252 accents as symbols and vice versa.
    const encoding = printer.encoding === 'cp1252' ? ('utf-8' as const) : ('cp1252' as const);
    set({ testResult: result, encoding });
    void print({ ...printer, testResult: result, encoding });
  };

  return (
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
  );
}

/** Which stations the printer serves (one ticket per station). */
export function StationOptions({ printer, set, stations }: { printer: LocalPrinter; set: PrinterPatch; stations: Station[] }) {
  const toggle = (id: string) =>
    set({ stationIds: printer.stationIds.includes(id) ? printer.stationIds.filter((s) => s !== id) : [...printer.stationIds, id] });
  return (
    <div className="opts">
      {stations.map((s) => (
        <Opt key={s.id} kind="check" pressed={printer.stationIds.includes(s.id)} onClick={() => toggle(s.id)}
          title={s.name} hint={stationHint(s)} tail={s.fixed ? <span className="ro">Fija</span> : undefined} />
      ))}
    </div>
  );
}
