import { describe, expect, it } from 'vitest';
import { backStep, freshProgress, nextStep, resumeTarget, STEPS, stepNumber } from './flow';

describe('setup flow', () => {
  it('has the nine approved steps in order', () => {
    expect(STEPS.map((s) => s.label)).toEqual([
      'Bienvenida',
      'Conectar',
      '¿Imprime?',
      'Buscar impresoras',
      'Nombre y papel',
      'Prueba',
      'Estación',
      'Inicio y actualizaciones',
      'Listo',
    ]);
  });

  it('walks every printer through name, test and station before startup', () => {
    let p = freshProgress();
    const seen: string[] = [];
    const printers = 2;
    while (p.step !== 'done') {
      seen.push(`${p.step}${['details', 'test', 'station'].includes(p.step) ? p.printerIndex : ''}`);
      p = nextStep({ ...p, prints: true }, printers);
    }
    expect(seen).toEqual([
      'welcome', 'connect', 'prints', 'discover',
      'details0', 'test0', 'station0',
      'details1', 'test1', 'station1',
      'startup',
    ]);
    expect(p.maxStep).toBe(9);
  });

  it('jumps from ¿Imprime? straight to step 8 when the restaurant does not print', () => {
    const p = nextStep({ ...freshProgress(), step: 'prints', prints: false, maxStep: 3 }, 0);
    expect(p.step).toBe('startup');
    expect(stepNumber(p.step)).toBe(8);
    expect(backStep(p, 0).step).toBe('prints');
  });

  it('goes to startup when the search selected no printer', () => {
    const p = nextStep({ ...freshProgress(), step: 'discover', prints: true, maxStep: 4 }, 0);
    expect(p.step).toBe('startup');
  });

  it('goes back through the previous printer', () => {
    const p = { ...freshProgress(), step: 'details' as const, printerIndex: 1, prints: true, maxStep: 7 };
    expect(backStep(p, 2)).toMatchObject({ step: 'station', printerIndex: 0 });
    expect(backStep({ ...p, printerIndex: 0 }, 2)).toMatchObject({ step: 'discover' });
    expect(backStep({ ...freshProgress(), step: 'welcome' }, 0).step).toBe('welcome');
  });

  it('resumes at the saved step', () => {
    expect(resumeTarget({ ...freshProgress(), step: 'details', printerIndex: 0, maxStep: 5 })).toBe(5);
    expect(resumeTarget(freshProgress())).toBe(1);
  });
});
