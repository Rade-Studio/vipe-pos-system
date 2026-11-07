import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockApiClient } from '../api/mock';
import { createDemoBridge } from '../bridge/demo';
import type { StationSettings } from '../bridge/types';
import { Setup } from './Setup';

afterEach(cleanup);

function setup(scenario: 'fresh' | 'resume' = 'fresh', api = new MockApiClient()) {
  const bridge = createDemoBridge({ scenario, storage: null });
  const saved: StationSettings[] = [];
  const save = bridge.saveSettings.bind(bridge);
  bridge.saveSettings = vi.fn(async (s: StationSettings) => {
    saved.push(structuredClone(s));
    await save(s);
  });
  const onDone = vi.fn();
  const onDefer = vi.fn();
  return { api, bridge, saved, onDone, onDefer };
}

async function mount(ctx: ReturnType<typeof setup>) {
  const settings = await ctx.bridge.loadSettings();
  render(<Setup api={ctx.api} bridge={ctx.bridge} initial={settings} onDone={ctx.onDone} onDefer={ctx.onDefer} />);
}

function typeCode(code: string) {
  code.split('').forEach((d, i) => fireEvent.change(screen.getByLabelText(`Dígito ${i + 1}`), { target: { value: d } }));
}

const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole('button', { name })));

describe('first-run setup (design/instalador-vipe/02-asistente.html)', () => {
  it('walks the nine steps, saving progress after each one', async () => {
    const ctx = setup();
    await mount(ctx);
    expect(screen.getByRole('heading', { name: 'Bienvenido a VIPE en este computador' })).toBeTruthy();
    await click(/Empezar/);

    expect(screen.getByText('Paso 2 de 9')).toBeTruthy();
    typeCode('481207');
    await click('Revisar código');
    expect(await screen.findByText('Casa Guadua · Sede Laureles')).toBeTruthy();
    await click('Sí, es mi restaurante');

    expect(await screen.findByRole('heading', { name: '¿Este computador imprime?' })).toBeTruthy();
    await click(/Siguiente/);

    expect(await screen.findByRole('heading', { name: 'Encontramos 2 impresoras' })).toBeTruthy();
    await click(/Configurar 2 impresoras/);

    expect(screen.getByRole('heading', { name: 'EPSON TM-T20III' })).toBeTruthy();
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Caja principal');
    await click(/Probar cajón/);
    expect(ctx.bridge.drawerPulses).toBe(1);
    await click(/Siguiente: prueba/);
    expect(screen.getByRole('heading', { name: 'Imprimimos una prueba. ¿Cómo salió?' })).toBeTruthy();
    await click(/Salió bien/);
    await click(/^Siguiente/);
    expect(await screen.findByRole('heading', { name: '¿Para qué estación imprime?' })).toBeTruthy();
    expect(screen.getByText('Sigue: Xprinter XP-N160II')).toBeTruthy();
    await click(/Siguiente impresora/);

    expect(screen.getByRole('heading', { name: 'Xprinter XP-N160II' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Cocina caliente' } });
    await click(/Siguiente: prueba/);
    await click(/Salió bien/);
    await click(/^Siguiente/);
    await screen.findByRole('heading', { name: '¿Para qué estación imprime?' });
    await click(/Cocina/);
    await click(/^Siguiente/);

    expect(screen.getByRole('heading', { name: 'Inicio y actualizaciones' })).toBeTruthy();
    expect(screen.getByText('Canal Estable')).toBeTruthy();
    expect(screen.getByText('Solo lectura')).toBeTruthy();
    await click(/Terminar/);

    expect(await screen.findByRole('heading', { name: 'Listo, Casa Guadua' })).toBeTruthy();
    expect(screen.getByText('Caja principal → Caja · cajón probado')).toBeTruthy();
    expect(screen.getByText('Cocina caliente → Cocina · prueba bien')).toBeTruthy();
    await click(/Abrir la caja/);
    expect(ctx.onDone).toHaveBeenCalled();

    const steps = ctx.saved.map((s) => s.setup.step);
    for (const step of ['connect', 'prints', 'discover', 'details', 'test', 'station', 'startup', 'done']) {
      expect(steps).toContain(step);
    }
    const last = ctx.saved[ctx.saved.length - 1];
    expect(last.setup.completed).toBe(true);
    expect(last.deviceToken).toMatch(/^vdt_/);
    expect(last.printers.map((p) => [p.name, p.stationIds])).toEqual([
      ['Caja principal', ['st-caja']],
      ['Cocina caliente', ['st-cocina']],
    ]);
    expect(ctx.api.savedPrinters.map((p) => p.name)).toEqual(['Caja principal', 'Cocina caliente']);
  });

  it('skips to step 8 when the computer does not print', async () => {
    const ctx = setup();
    await mount(ctx);
    await click(/Empezar/);
    typeCode('481207');
    await click('Revisar código');
    await screen.findByText('Casa Guadua · Sede Laureles');
    await click('Sí, es mi restaurante');
    await click(/No, este restaurante no usa impresoras/);
    await click(/Siguiente/);
    expect(screen.getByRole('heading', { name: 'Inicio y actualizaciones' })).toBeTruthy();
  });

  it('explains an expired code and a missing connection', async () => {
    const ctx = setup();
    await mount(ctx);
    await click(/Empezar/);
    typeCode('000000');
    await click('Revisar código');
    expect(await screen.findByText(/El código venció/)).toBeTruthy();

    ctx.api.offline = true;
    typeCode('481207');
    await click('Revisar código');
    expect(await screen.findByText(/Sin conexión a internet/)).toBeTruthy();
  });

  it('"Configurar después" saves where it stopped and leaves the setup', async () => {
    const ctx = setup('resume');
    await mount(ctx);
    await click('Continuar en el paso 5');
    await click('Configurar después');
    expect(ctx.onDefer).toHaveBeenCalled();
    const last = ctx.saved[ctx.saved.length - 1];
    expect(last.setup).toMatchObject({ step: 'details', deferred: true, completed: false });
  });

  it('resumes a half-done setup where it stopped', async () => {
    const ctx = setup('resume');
    await mount(ctx);
    expect(screen.getByRole('heading', { name: 'Sigamos donde quedaste' })).toBeTruthy();
    expect(screen.getByText('Cerraste VIPE en el paso 5 de 9. Lo que ya hiciste quedó guardado.')).toBeTruthy();
    expect(screen.getByText('2 impresoras encontradas')).toBeTruthy();
    await click('Continuar en el paso 5');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'EPSON TM-T20III' })).toBeTruthy());
  });
});
