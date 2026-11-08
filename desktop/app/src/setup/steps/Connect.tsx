import { Check } from 'lucide-react';
import { type ClipboardEvent, useState } from 'react';
import { errorMessage, type Restaurant } from '../../api/contract';
import type { StepContext } from '../Setup';
import { Acts } from './common';
import { APP_VERSION } from './Welcome';

/** Step 2: 6-digit pairing code, then confirm the restaurant and branch. */
export function Connect({ ctx }: { ctx: StepContext }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [found, setFound] = useState<Restaurant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = digits.join('');

  // Each input sits in its own `display: contents` span, so look the boxes up from the code row.
  const box = (input: HTMLInputElement, i: number) =>
    input.closest('.code')?.querySelectorAll<HTMLInputElement>('input')[i];

  const setDigit = (i: number, value: string, input: HTMLInputElement) => {
    const d = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => prev.map((x, j) => (j === i ? d : x)));
    setFound(null);
    if (d) box(input, i + 1)?.focus();
  };

  /** A pasted code ("481207" or "481 207") fills the boxes from the one it lands on; six digits always fill all six. */
  const pasteDigits = (i: number, event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    event.preventDefault();
    const start = pasted.length >= 6 ? 0 : i;
    const fill = pasted.slice(0, 6 - start).split('');
    setDigits((prev) => prev.map((x, j) => (j >= start && j < start + fill.length ? fill[j - start] : x)));
    setFound(null);
    box(event.currentTarget, Math.min(start + fill.length, 5))?.focus();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const check = () => run(async () => setFound((await ctx.api.previewPairing(code)).restaurant));
  const confirm = () =>
    run(async () => {
      const claim = await ctx.api.claimPairing(code, { name: 'Estación VIPE', platform: 'windows', appVersion: APP_VERSION });
      await ctx.next({
        deviceId: claim.deviceId,
        deviceToken: claim.deviceToken,
        restaurant: claim.restaurant,
        channel: claim.channel,
        linkedAt: new Date().toISOString(),
      });
    });

  return (
    <section className="step">
      <p className="eyebrow">Paso 2 de 9</p>
      <h1>Conecta este computador con tu restaurante</h1>
      <div className="two">
        <ol className="how">
          <li>
            <span>
              En otro equipo abre <b>VIPE → Ajustes → Estación de impresión</b>.
            </span>
          </li>
          <li>
            <span>
              Pulsa <b>Generar código</b>. Dura 10 minutos.
            </span>
          </li>
          <li>Escribe aquí los 6 dígitos. No necesitas usuario ni contraseña.</li>
        </ol>
        <div className="card pane">
          <span className="lbl">Código de 6 dígitos</span>
          <div className="code">
            {digits.map((d, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i === 3 && <span className="sep" aria-hidden />}
                <input
                  aria-label={`Dígito ${i + 1}`}
                  inputMode="numeric"
                  maxLength={2}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value, e.target)}
                  onPaste={(e) => pasteDigits(i, e)}
                />
              </span>
            ))}
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          {found ? (
            <>
              <div className="org card" style={{ background: 'var(--surface-2)' }}>
                <span className="av" aria-hidden>
                  {found.initials}
                </span>
                <span>
                  <b>
                    {found.name} · {found.branch}
                  </b>
                  <small>{found.address}</small>
                </span>
                <span className="chip s-ok">
                  <Check aria-hidden /> Encontrado
                </span>
              </div>
              <button type="button" className="btn primary" onClick={confirm} disabled={busy}>
                Sí, es mi restaurante
              </button>
              <button type="button" className="btn ghost" onClick={() => setFound(null)}>
                No es este, escribir otro código
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={check} disabled={busy || code.length !== 6}>
              Revisar código
            </button>
          )}
        </div>
      </div>
      <Acts onBack={() => void ctx.back()}>
        <span className="hint">Este paso es obligatorio para imprimir</span>
      </Acts>
    </section>
  );
}
