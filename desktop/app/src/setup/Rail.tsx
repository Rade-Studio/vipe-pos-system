import { Check } from 'lucide-react';
import { STEPS, stepLabel, stepNumber, type SetupProgress, type StepId } from './flow';

/** Left step menu: done steps can be revisited, later ones are locked. */
export function Rail({ progress, onJump, onDefer }: { progress: SetupProgress; onJump: (s: StepId) => void; onDefer?: () => void }) {
  const current = stepNumber(progress.step);
  const pct = Math.round((current / STEPS.length) * 100);
  return (
    <nav className="side wide" aria-label="Pasos de la configuración">
      <ol className="steps">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < current || (progress.completed && n <= STEPS.length);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={done && n !== current ? 'done' : undefined}
                aria-current={n === current ? 'step' : undefined}
                disabled={n > progress.maxStep || progress.step === 'done'}
                onClick={() => n !== current && onJump(s.id)}
              >
                <span className="n">{done && n !== current ? <Check aria-hidden /> : n}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="run-foot">
        <b>
          Paso {current} de 9 · {stepLabel(progress.step)}
        </b>
        <div className="bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
        Se guarda en cada paso. Si cierras, seguimos donde quedaste.
        {onDefer && (
          <button type="button" className="btn" onClick={onDefer}>
            Configurar después
          </button>
        )}
      </div>
    </nav>
  );
}
