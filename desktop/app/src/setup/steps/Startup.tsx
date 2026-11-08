import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, type PrinterRegistration } from '../../api/contract';
import type { LocalPrinter } from '../../bridge/types';
import type { StepContext } from '../Setup';
import { Acts, NextButton, Opt } from './common';

export const CHANNEL_LABEL = { stable: 'Estable', pilot: 'Piloto' } as const;

/** Step 8: start with Windows, automatic updates out of service, channel (read-only, L32). */
/** What VIPE web knows about this computer's printers (no addresses). */
export function registrations(printers: LocalPrinter[]): PrinterRegistration[] {
  return printers.map((p) => ({
    id: p.id, name: p.name, model: p.model, connection: p.connection, paperMm: p.paperMm, hasDrawer: p.hasDrawer, stationIds: p.stationIds,
  }));
}

export function Startup({ ctx }: { ctx: StepContext }) {
  const { autostart, autoUpdate, channel, restaurant, printers } = ctx.settings;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await ctx.bridge.setAutostart(autostart);
      await ctx.api.savePrinters(registrations(printers));
      await ctx.next();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="step">
      <p className="eyebrow">Paso 8 de 9</p>
      <h1>Inicio y actualizaciones</h1>
      <div className="card checks" style={{ padding: '8px 20px' }}>
        <Opt kind="check" pressed={autostart} onClick={() => ctx.update({ autostart: !autostart })}
          title="Abrir VIPE al encender el computador"
          hint="Recomendado: las comandas se imprimen aunque nadie abra VIPE." />
        <Opt kind="check" pressed={autoUpdate} onClick={() => ctx.update({ autoUpdate: !autoUpdate })}
          title="Actualizar automáticamente fuera del servicio"
          hint="Se descarga en segundo plano y se instala al reiniciar o al cierre del día, nunca durante una venta." />
      </div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
        <span className="pi s-occupied" aria-hidden>
          <RefreshCw />
        </span>
        <div style={{ flex: 1 }}>
          <b style={{ display: 'block', fontSize: 16 }}>Canal {CHANNEL_LABEL[channel]}</b>
          <small className="muted" style={{ fontSize: 13 }}>
            Lo define el administrador de {restaurant?.name ?? 'tu restaurante'} en VIPE web. Piloto recibe versiones nuevas
            una semana antes.
          </small>
        </div>
        <span className="ro">Solo lectura</span>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <Acts onBack={() => void ctx.back()}>
        <NextButton label="Terminar" onClick={() => void finish()} disabled={busy} />
      </Acts>
    </section>
  );
}
