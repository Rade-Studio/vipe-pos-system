import { Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatNetworkAddress, parseNetworkAddress } from '../../bridge/printer-address';
import type { LocalPrinter } from '../../bridge/types';
import { NetworkFields, checkDraft, type NetworkDraft } from '../../setup/steps/networkFields';
import { PrinterFields, StationOptions } from '../../setup/steps/printerFields';
import type { PanelContext } from '../Panel';

const REMOVE_TEXT = 'Deja de imprimir en esta computadora. Las comandas de sus estaciones salen en las demás impresoras o quedan en cola.';

/** "Configurar": every setting of one printer on one screen, saved on "Guardar" (S4). */
export function EditPrinter({ ctx, original }: { ctx: PanelContext; original: LocalPrinter }) {
  const [draft, setDraft] = useState(original);
  const at = parseNetworkAddress(original.address);
  const [net, setNet] = useState<NetworkDraft>({ host: at.host, port: String(at.port) });
  const [removing, setRemoving] = useState(false);
  const { printers } = ctx.settings;
  const set = (patch: Partial<LocalPrinter>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => ctx.openCard(null);

  const withAddress = (): LocalPrinter | null => {
    if (draft.connection !== 'network') return draft;
    const r = checkDraft(net);
    if (!r.ok) return setNet(r.draft), null;
    return { ...draft, address: formatNetworkAddress(r.host, r.port) };
  };
  const save = async () => {
    const next = withAddress();
    if (!next) return;
    await ctx.savePrinters(printers.map((p) => (p.id === original.id ? next : p)));
    close();
  };
  const remove = async () => {
    await ctx.savePrinters(printers.filter((p) => p.id !== original.id));
    close();
  };
  const test = () => {
    const p = withAddress();
    if (p) void ctx.bridge.testPrint(p, ctx.settings.restaurant);
  };

  return (
    <section className="card wz-card" aria-labelledby="ed-h">
      <header className="wz-head">
        <div>
          <span className="eyebrow">{original.model}</span>
          <h2 id="ed-h">Configurar {original.name}</h2>
        </div>
      </header>
      <div className="wz-body">
        <div className="wz-pane">
          <h3 className="wz-sub">Conexión</h3>
          {draft.connection === 'network' ? (
            <NetworkFields draft={net} onChange={setNet} />
          ) : (
            <label className="field">
              <span>{draft.connection === 'usb' ? 'Impresora de Windows' : 'Puerto COM'}</span>
              <input className="input" value={draft.address} readOnly />
            </label>
          )}
          <div>
            <button type="button" className="btn" onClick={test}>
              <Play aria-hidden /> Imprimir prueba
            </button>
          </div>
          <h3 className="wz-sub">Nombre y papel</h3>
          <PrinterFields printer={draft} set={set} bridge={ctx.bridge} />
          <h3 className="wz-sub">Estaciones</h3>
          <StationOptions printer={draft} set={set} stations={ctx.stations} />
        </div>
      </div>
      {removing ? (
        <footer className="wz-foot confirm" role="alertdialog" aria-labelledby="rm-h" aria-describedby="rm-d">
          <span className="grow">
            <b id="rm-h">¿Quitar {original.name}?</b>
            <small id="rm-d">{REMOVE_TEXT}</small>
          </span>
          <button type="button" className="btn ghost" onClick={() => setRemoving(false)}>No, dejarla</button>
          <button type="button" className="btn danger" onClick={() => void remove()}>Sí, quitar</button>
        </footer>
      ) : (
        <footer className="wz-foot">
          <button type="button" className="btn danger" onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden /> Quitar impresora
          </button>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={close}>Cancelar</button>
          <button type="button" className="btn primary" disabled={!draft.name.trim()} onClick={() => void save()}>
            Guardar
          </button>
        </footer>
      )}
    </section>
  );
}
