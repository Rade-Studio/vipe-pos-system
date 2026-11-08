import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockApiClient } from '../api/mock';
import { createDemoBridge, type DemoScenario } from '../bridge/demo';
import type { StationSettings } from '../bridge/types';
import { Panel } from './Panel';

afterEach(cleanup);

async function mount(scenario: DemoScenario, page?: string) {
  const api = new MockApiClient();
  const bridge = createDemoBridge({ scenario, storage: null });
  const settings = await bridge.loadSettings();
  const save = bridge.saveSettings.bind(bridge);
  const saved: StationSettings[] = [];
  bridge.saveSettings = vi.fn(async (s: StationSettings) => {
    saved.push(structuredClone(s));
    await save(s);
  });
  await act(async () => {
    render(<Panel api={api} bridge={bridge} initial={settings} initialPage={page} />);
  });
  return { api, bridge, saved };
}

const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

describe('Estación panel (design/estacion-vipe/01-panel-con-menu.html)', () => {
  it('Estado: everything printing, connection and the tray', async () => {
    const { bridge } = await mount('ready');
    expect(screen.getByRole('heading', { name: 'Estado' })).toBeTruthy();
    expect(screen.getByText('Todo imprime con normalidad · 46 impresiones hoy')).toBeTruthy();
    expect(screen.getByText('Conectado a VIPE')).toBeTruthy();
    expect(screen.getAllByText('Cocina caliente').length).toBeGreaterThan(0);
    expect(bridge.tray?.tooltip).toBe('VIPE — Impresión: 3 listas');
  });

  it('a printer without paper is an alert and its job can be retried from Cola', async () => {
    const { bridge } = await mount('failing');
    expect(screen.getByText('Caja sin papel')).toBeTruthy();
    await click(screen.getByRole('button', { name: /^Cola/ }));
    expect(screen.getByRole('heading', { name: 'Cola de impresión' })).toBeTruthy();
    const row = screen.getByText('Factura FE-2041 · Mesa 9').closest('li') as HTMLElement;
    expect(within(row).getByText('Falló: sin papel')).toBeTruthy();
    await click(within(row).getByRole('button', { name: 'Reintentar' }));
    expect(bridge.retried).toEqual(['f2041']);
  });

  it('a waiting job can be cancelled', async () => {
    const { bridge } = await mount('ready', 'cola');
    const row = screen.getByText('#132 · Domicilio').closest('li') as HTMLElement;
    await click(within(row).getByRole('button', { name: 'Cancelar' }));
    expect(bridge.cancelled).toEqual(['j132']);
  });

  it('"Abrir cajón" opens at once and records the event', async () => {
    const { api, bridge } = await mount('ready');
    await click(screen.getByRole('button', { name: 'Abrir cajón' }));
    expect(bridge.drawerPulses).toBe(1);
    expect(api.drawerEvents).toEqual([expect.objectContaining({ printerId: 'net-192.168.1.51', reason: 'manual' })]);
  });

  it('Impresoras shows the read-only "Qué imprime" of each printer', async () => {
    const { api } = await mount('ready', 'impresoras');
    await act(async () => {
      await api.stations();
    });
    expect(await screen.findByText('comandas de Entradas, Platos fuertes, Postres')).toBeTruthy();
    expect(screen.getByText('facturas y precuentas · abre el cajón al cobrar en efectivo')).toBeTruthy();
    expect(screen.getByText(/se define en VIPE web/)).toBeTruthy();
  });

  it('Historial reprints a finished job', async () => {
    const { bridge } = await mount('ready', 'historial');
    const row = screen.getByText('Comanda #128 · Mesa 8 · Cocina').closest('li') as HTMLElement;
    await click(within(row).getByRole('button', { name: 'Reimprimir' }));
    expect(bridge.reprinted).toEqual(['h128']);
    expect(screen.getByText('No impresa')).toBeTruthy();
  });

  it('Ajustes turns autostart off and saves it', async () => {
    const { bridge } = await mount('ready', 'ajustes');
    expect(screen.getByText('Versión 0.1.0')).toBeTruthy();
    const sw = screen.getByRole('switch', { name: 'Abrir al iniciar Windows' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await click(sw);
    expect(bridge.autostart).toBe(false);
    expect((await bridge.loadSettings()).autostart).toBe(false);
  });

  it('without printers it invites to add the first one', async () => {
    await mount('empty');
    expect(screen.getByText('Agrega tu primera impresora')).toBeTruthy();
    await click(screen.getByRole('button', { name: /Agregar impresora/ }));
    // The add card opens on the Impresoras page, not the first-run wizard (S1).
    expect(screen.getByRole('heading', { name: 'Paso 1 de 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Impresoras/ }).getAttribute('aria-current')).toBe('page');
  });

  it('without connection it says so and keeps printing locally', async () => {
    await mount('offline');
    expect(screen.getByText('Sin conexión con VIPE')).toBeTruthy();
  });
});
