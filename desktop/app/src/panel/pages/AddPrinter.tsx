import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toLocal } from '../../bridge/demoData';
import { describeAddress } from '../../bridge/printer-address';
import type { DiscoveredPrinter, LocalPrinter } from '../../bridge/types';
import { ManualIpForm } from '../../setup/steps/networkFields';
import { PrinterFields, StationOptions, TestPrintBody } from '../../setup/steps/printerFields';
import type { PanelContext } from '../Panel';
import { ConnectionIcon } from '../parts';

const STEPS = ['Buscar', 'Nombre y papel', 'Prueba', 'Estación'];

/** "Agregar impresora" inside the panel: the design's 4-step card (S1, S3). */
export function AddPrinter({ ctx }: { ctx: PanelContext }) {
  const [step, setStep] = useState(1);
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [typed, setTyped] = useState<DiscoveredPrinter[]>([]);
  const [manual, setManual] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocalPrinter | null>(null);
  const { printers } = ctx.settings;

  const search = async () => {
    setFound(null);
    setFound(await ctx.bridge.discoverPrinters());
  };
  useEffect(() => {
    void search();
  }, []);

  const added = (d: DiscoveredPrinter) => printers.find((p) => p.id === d.id || (p.connection === d.connection && p.address === d.address));
  const list = [...typed, ...(found ?? []).filter((f) => !typed.some((t) => t.id === f.id))];
  const set = (patch: Partial<LocalPrinter>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const close = () => ctx.openCard(null);

  const next = async () => {
    if (step === 1) {
      const d = list.find((p) => p.id === chosen);
      if (!d) return;
      if (draft?.id !== d.id) {
        const caja = ctx.stations.find((s) => s.fixed);
        // As in the wizard, a printer with a cash drawer starts on the Caja station.
        setDraft({ ...toLocal(d), stationIds: d.hasDrawer && caja ? [caja.id] : [] });
      }
      return setStep(2);
    }
    if (step < 4) return setStep(step + 1);
    if (!draft) return;
    const caja = ctx.stations.find((s) => s.fixed);
    await ctx.savePrinters([...printers, draft], { cajaStationId: ctx.settings.cajaStationId ?? caja?.id ?? null });
    close();
  };
  const canNext =
    step === 1 ? Boolean(chosen) : step === 2 ? Boolean(draft?.name.trim()) : step === 3 ? draft?.testResult === 'ok' : Boolean(draft?.stationIds.length);

  return (
    <section className="card wz-card" aria-labelledby="wz-h">
      <header className="wz-head">
        <div>
          <span className="eyebrow">Agregar impresora</span>
          <h2 id="wz-h">Paso {step} de 4</h2>
        </div>
        <ol className="wz-steps" aria-label="Pasos">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button type="button" className={i + 1 < step ? 'done' : undefined} aria-current={i + 1 === step ? 'step' : undefined}
                disabled={i + 1 > step} onClick={() => setStep(i + 1)}>
                <span className="n">{i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </header>
      <div className="wz-body">
        {step === 1 && (
          <div className="wz-pane">
            <p className="scan" role="status">
              <RefreshCw aria-hidden className={found === null ? 'spin' : undefined} />
              {found === null ? 'Buscando en USB, red local y Bluetooth…' : `Búsqueda terminada · ${found.length} encontradas`}
            </p>
            <div className="opts" role="radiogroup" aria-label="Impresoras encontradas">
              {list.map((d) => {
                const have = added(d);
                return (
                  <button key={d.id} type="button" className="opt" role="radio" aria-checked={chosen === d.id} disabled={Boolean(have)}
                    style={have ? { opacity: 0.7 } : undefined} onClick={() => setChosen(d.id)}>
                    <span className="radio" aria-hidden />
                    <span className="pi" aria-hidden><ConnectionIcon kind={d.connection} /></span>
                    <span className="grow">
                      <b>{d.model}</b>
                      <small className="num">{describeAddress(d)}{have ? ` · ya agregada como “${have.name}”` : ''}</small>
                    </span>
                    <span className={`chip ${have ? 's-reserved' : 's-served'}`}>{have ? 'Agregada' : 'Nueva'}</span>
                  </button>
                );
              })}
            </div>
            {manual ? (
              <ManualIpForm onClose={() => setManual(false)} onAdd={(p) => (setTyped((t) => [p, ...t.filter((x) => x.id !== p.id)]), setChosen(p.id), setManual(false))} />
            ) : (
              <div className="wz-alt">
                <span className="muted">¿No aparece la tuya?</span>
                <button type="button" className="btn sm" onClick={() => setManual(true)}>Escribir IP a mano</button>
                <button type="button" className="btn sm ghost" onClick={() => void search()}>
                  <RefreshCw aria-hidden /> Buscar otra vez
                </button>
              </div>
            )}
          </div>
        )}
        {step === 2 && draft && (
          <div className="wz-pane wz-2col">
            <div className="wz-form"><PrinterFields printer={draft} set={set} bridge={ctx.bridge} /></div>
            <aside className="wz-device card">
              <span className="pi" aria-hidden><ConnectionIcon kind={draft.connection} /></span>
              <div><b>{draft.model}</b><small className="muted">{describeAddress(draft)}</small></div>
            </aside>
          </div>
        )}
        {step === 3 && draft && <TestPrintBody printer={draft} set={set} bridge={ctx.bridge} restaurant={ctx.settings.restaurant} />}
        {step === 4 && draft && (
          <div className="wz-pane">
            <p className="wz-lead">¿Qué imprime <b>{draft.name}</b>? Puedes elegir más de una estación.</p>
            <StationOptions printer={draft} set={set} stations={ctx.stations} />
            <p className="muted wz-note">Si eliges varias estaciones, sale un ticket por cada una. Qué platos van a cada estación se cambia en VIPE web → <b>Ajustes → Estaciones y rutas</b>.</p>
          </div>
        )}
      </div>
      <footer className="wz-foot">
        <button type="button" className="btn ghost" onClick={close}>Cancelar</button>
        <span className="grow" />
        {step > 1 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Atrás</button>}
        <button type="button" className="btn primary" disabled={!canNext} onClick={() => void next()}>
          {step === 4 ? 'Guardar impresora' : 'Siguiente'}
        </button>
      </footer>
    </section>
  );
}
