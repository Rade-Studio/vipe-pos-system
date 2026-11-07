import { Check } from 'lucide-react';
import { useState } from 'react';
import { CHANNEL_LABEL } from '../../setup/steps/Startup';
import type { PanelContext } from '../Panel';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="switch-hit" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="switch" aria-checked={on} />
    </button>
  );
}

const DATE = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

export function Ajustes({ ctx }: { ctx: PanelContext }) {
  const { settings, status } = ctx;
  const [url, setUrl] = useState(settings.webUrl);
  const { restaurant } = settings;

  const unlink = async () => {
    if (!window.confirm('Este computador dejará de imprimir hasta que ingreses un código nuevo. ¿Desvincular?')) return;
    await ctx.saveSettings({ deviceId: null, deviceToken: null, restaurant: null, linkedAt: null });
  };

  return (
    <>
      <header className="ph">
        <h1>Ajustes</h1>
      </header>
      <section className="card">
        <ul className="set">
          <li>
            <span style={{ flex: 1 }}>
              <b>Restaurante vinculado</b>
              <small>
                {restaurant
                  ? `${restaurant.name} · ${restaurant.branch}${settings.linkedAt ? ` · desde el ${DATE.format(new Date(settings.linkedAt))}` : ''}. Si desvinculas, este computador deja de imprimir hasta que ingreses un código nuevo.`
                  : 'Sin vincular: ingresa un código desde la configuración inicial.'}
              </small>
            </span>
            {restaurant && (
              <button type="button" className="btn danger" onClick={() => void unlink()}>Desvincular</button>
            )}
          </li>
          <li>
            <span style={{ flex: 1 }}>
              <b>Abrir al iniciar Windows</b>
              <small>Queda en la bandeja junto al reloj, sin ventana</small>
            </span>
            <Switch
              label="Abrir al iniciar Windows"
              on={settings.autostart}
              onChange={async (v) => {
                await ctx.bridge.setAutostart(v);
                await ctx.saveSettings({ autostart: v });
              }}
            />
          </li>
          <li>
            <span style={{ flex: 1 }}>
              <b>Actualizar automáticamente fuera del servicio</b>
              <small>{`Canal ${CHANNEL_LABEL[settings.channel]} (lo define el administrador en VIPE web)`}</small>
            </span>
            <Switch label="Actualizar automáticamente" on={settings.autoUpdate} onChange={(v) => void ctx.saveSettings({ autoUpdate: v })} />
          </li>
          <li>
            <span style={{ flex: 1 }}>
              <b>Sonido cuando algo falla</b>
              <small>Suena si una impresora se queda sin papel o se pierde la conexión</small>
            </span>
            <Switch label="Sonido cuando algo falla" on={settings.soundOnFailure} onChange={(v) => void ctx.saveSettings({ soundOnFailure: v })} />
          </li>
          <li>
            <span style={{ flex: 1 }}>
              <b>{`Versión ${status.version}`}</b>
              <small>Al día · se actualiza sola cuando no hay nada imprimiéndose</small>
            </span>
            <span className="chip s-ok"><Check aria-hidden /> Actualizada</span>
          </li>
          <li>
            <label className="field" style={{ flex: 1 }}>
              <span>Dirección de VIPE</span>
              <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <button type="button" className="btn" disabled={url === settings.webUrl || !/^https?:\/\//.test(url)} onClick={() => void ctx.saveSettings({ webUrl: url.trim() })}>
              Guardar
            </button>
          </li>
        </ul>
      </section>
    </>
  );
}
