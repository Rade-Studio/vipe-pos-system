import { Check, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function Opt({
  pressed,
  onClick,
  title,
  hint,
  kind = 'radio',
  icon,
  tail,
  disabled,
}: {
  pressed: boolean;
  onClick?: () => void;
  title: string;
  hint?: string;
  kind?: 'radio' | 'check' | 'none';
  icon?: ReactNode;
  tail?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="opt" aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {kind === 'radio' && <span className="radio" aria-hidden />}
      {kind === 'check' && (
        <span className="bx" aria-hidden>
          <Check />
        </span>
      )}
      {icon}
      <span className="grow">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
      {tail}
    </button>
  );
}

export function NextButton({ label = 'Siguiente', onClick, disabled }: { label?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn primary" onClick={onClick} disabled={disabled}>
      {label}
      <ChevronRight aria-hidden />
    </button>
  );
}

export function Acts({ onBack, children }: { onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="acts">
      {onBack && (
        <button type="button" className="btn ghost" onClick={onBack}>
          Atrás
        </button>
      )}
      <span className="sp" />
      {children}
    </div>
  );
}
