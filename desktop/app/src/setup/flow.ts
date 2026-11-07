// The nine first-run steps (design/instalador-vipe/02-asistente.html) and how
// "Siguiente" / "Atrás" move between them. Steps 5-7 repeat per printer.

export type StepId = 'welcome' | 'connect' | 'prints' | 'discover' | 'details' | 'test' | 'station' | 'startup' | 'done';

export interface SetupProgress {
  step: StepId;
  /** Printer being configured in steps 5-7. */
  printerIndex: number;
  /** Furthest step reached (1-9): the side menu can jump back up to it. */
  maxStep: number;
  /** Answer of "¿Este computador imprime?"; null until answered. */
  prints: boolean | null;
  completed: boolean;
  deferred: boolean;
}

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Bienvenida' },
  { id: 'connect', label: 'Conectar' },
  { id: 'prints', label: '¿Imprime?' },
  { id: 'discover', label: 'Buscar impresoras' },
  { id: 'details', label: 'Nombre y papel' },
  { id: 'test', label: 'Prueba' },
  { id: 'station', label: 'Estación' },
  { id: 'startup', label: 'Inicio y actualizaciones' },
  { id: 'done', label: 'Listo' },
];

export const stepNumber = (step: StepId) => STEPS.findIndex((s) => s.id === step) + 1;
export const stepLabel = (step: StepId) => STEPS[stepNumber(step) - 1].label;

export function freshProgress(): SetupProgress {
  return { step: 'welcome', printerIndex: 0, maxStep: 1, prints: null, completed: false, deferred: false };
}

function go(p: SetupProgress, step: StepId, printerIndex = p.printerIndex): SetupProgress {
  return { ...p, step, printerIndex, maxStep: Math.max(p.maxStep, stepNumber(step)) };
}

export function nextStep(p: SetupProgress, printers: number): SetupProgress {
  switch (p.step) {
    case 'welcome':
      return go(p, 'connect');
    case 'connect':
      return go(p, 'prints');
    case 'prints':
      return p.prints === false ? go(p, 'startup', 0) : go(p, 'discover');
    case 'discover':
      return printers > 0 ? go(p, 'details', 0) : go(p, 'startup', 0);
    case 'details':
      return go(p, 'test');
    case 'test':
      return go(p, 'station');
    case 'station':
      return p.printerIndex + 1 < printers ? go(p, 'details', p.printerIndex + 1) : go(p, 'startup');
    case 'startup':
    case 'done':
      return go(p, 'done');
  }
}

export function backStep(p: SetupProgress, printers: number): SetupProgress {
  const to = (step: StepId, printerIndex = p.printerIndex) => ({ ...p, step, printerIndex });
  switch (p.step) {
    case 'welcome':
      return p;
    case 'connect':
      return to('welcome');
    case 'prints':
      return to('connect');
    case 'discover':
      return to('prints');
    case 'details':
      return p.printerIndex > 0 ? to('station', p.printerIndex - 1) : to('discover');
    case 'test':
      return to('details');
    case 'station':
      return to('test');
    case 'startup':
      if (p.prints === false) return to('prints');
      return printers > 0 ? to('station', printers - 1) : to('discover');
    case 'done':
      return to('startup');
  }
}

/** Step number shown by "Continuar en el paso N". */
export const resumeTarget = (p: SetupProgress) => stepNumber(p.step);
