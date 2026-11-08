import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockApiClient } from '../api/mock';
import { createDemoBridge } from '../bridge/demo';
import type { StationSettings } from '../bridge/types';
import { Panel } from './Panel';

afterEach(cleanup);

async function mount() {
  const api = new MockApiClient();
  const bridge = createDemoBridge({ scenario: 'ready', storage: null });
  const save = bridge.saveSettings.bind(bridge);
  const saved: StationSettings[] = [];
  bridge.saveSettings = vi.fn(async (s: StationSettings) => {
    saved.push(structuredClone(s));
    await save(s);
  });
  const settings = await bridge.loadSettings();
  await act(async () => {
    render(<Panel api={api} bridge={bridge} initial={settings} initialPage="impresoras" />);
  });
  return { api, bridge, saved };
}

const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole('button', { name })));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const HOST_ERROR = 'Escribe una IP como 192.168.1.52 o el nombre del equipo, sin espacios.';
const PORT_ERROR = 'El puerto es un número entre 1 y 65535.';

describe('Impresoras: add and edit inside the panel (S1-S4)', () => {
  it('adds a network printer by IP and port without leaving the panel', async () => {
    const { bridge, saved } = await mount();
    await click(/Agregar impresora/);
    expect(screen.getByRole('heading', { name: 'Paso 1 de 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Impresoras/ }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('radio', { name: /Agregada/ })).toHaveProperty('disabled', true);

    await click('Escribir IP a mano');
    expect((screen.getByLabelText('Puerto') as HTMLInputElement).value).toBe('9100');
    type('IP o nombre del equipo', '192.168.1.300');
    for (const port of ['0', '70000', 'abc']) {
      type('Puerto', port);
      await click('Usar esta IP');
      expect(screen.getByText(HOST_ERROR)).toBeTruthy();
      expect(screen.getByText(PORT_ERROR)).toBeTruthy();
    }
    type('IP o nombre del equipo', '192.168.1.52');
    type('Puerto', '');
    await click('Usar esta IP');
    expect(screen.queryByText(HOST_ERROR)).toBeNull();
    const row = screen.getByRole('radio', { name: /Impresora de red/ });
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(within(row).getByText('Red · 192.168.1.52 · puerto 9100')).toBeTruthy();
    await click(/^Siguiente/);

    expect(screen.getByRole('heading', { name: 'Paso 2 de 4' })).toBeTruthy();
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Impresora 192.168.1.52');
    type('Nombre', 'Caja auxiliar');
    await click(/^Siguiente/);
    expect(bridge.testPrints).toBe(1);
    await click(/Salió bien/);
    await click(/^Siguiente/);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /^Barra/ })));
    await click('Guardar impresora');

    expect(saved).toHaveLength(1);
    expect(saved[0].printers[3]).toMatchObject({
      name: 'Caja auxiliar', model: 'Impresora de red', connection: 'network', address: '192.168.1.52:9100', stationIds: ['st-barra'],
    });
    expect(screen.queryByText('Paso 4 de 4')).toBeNull();
    expect(screen.getByText('Impresora de red · Red · 192.168.1.52 · puerto 9100 · 80 mm')).toBeTruthy();
  });

  it('Cancelar goes back to the list and saves nothing', async () => {
    const { saved } = await mount();
    await click(/Agregar impresora/);
    await click('Escribir IP a mano');
    type('IP o nombre del equipo', '192.168.1.52');
    await click('Usar esta IP');
    await click('Cancelar');
    expect(screen.getByRole('heading', { name: 'Impresoras' })).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('the list shows the IP and port of network printers', async () => {
    await mount();
    expect(screen.getByText('Xprinter XP-80 · Red · 192.168.1.50 · puerto 9100 · 80 mm')).toBeTruthy();
    expect(screen.getByText('Epson TM-T20III · USB · EPSON TM-T20III Receipt · 80 mm')).toBeTruthy();
  });

  it('Configurar edits the IP and port and saves only on Guardar', async () => {
    const { saved } = await mount();
    const row = screen.getByText('Xprinter XP-80 · Red · 192.168.1.50 · puerto 9100 · 80 mm').closest('li') as HTMLElement;
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Configurar' })));
    expect(screen.getByRole('heading', { name: 'Configurar Barra' })).toBeTruthy();
    expect((screen.getByLabelText('IP o nombre del equipo') as HTMLInputElement).value).toBe('192.168.1.50');
    type('IP o nombre del equipo', '192.168.1.60');
    type('Puerto', '70000');
    await click('Guardar');
    expect(screen.getByText(PORT_ERROR)).toBeTruthy();
    expect(saved).toEqual([]);
    type('Puerto', '9101');
    await click('Guardar');
    expect(saved[0].printers[1]).toMatchObject({ id: 'net-192.168.1.50', name: 'Barra', address: '192.168.1.60:9101' });
    expect(screen.getByText('Xprinter XP-80 · Red · 192.168.1.60 · puerto 9101 · 80 mm')).toBeTruthy();
  });

  it('a USB printer shows its Windows name read-only and can print a test', async () => {
    const { bridge } = await mount();
    const row = screen.getByText(/USB · EPSON TM-T20III Receipt/).closest('li') as HTMLElement;
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Configurar' })));
    expect((screen.getByLabelText('Impresora de Windows') as HTMLInputElement).readOnly).toBe(true);
    await click('Imprimir prueba');
    expect(bridge.testPrints).toBe(1);
  });

  it('Quitar impresora asks first, then removes it', async () => {
    const { saved } = await mount();
    const row = screen.getByText(/192.168.1.51/).closest('li') as HTMLElement;
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Configurar' })));
    await click('Quitar impresora');
    expect(screen.getByText(/Deja de imprimir en esta computadora. Las comandas de sus estaciones salen en las demás impresoras o quedan en cola./)).toBeTruthy();
    expect(saved).toEqual([]);
    await click('Sí, quitar');
    expect(saved[0].printers.map((p) => p.name)).toEqual(['Cocina caliente', 'Barra']);
    expect(screen.queryByText(/192.168.1.51/)).toBeNull();
  });

  it('row actions still work: Abrir cajón and Imprimir prueba', async () => {
    const { bridge } = await mount();
    await click('Abrir cajón');
    expect(bridge.drawerPulses).toBe(1);
    const row = screen.getByText(/192.168.1.50/).closest('li') as HTMLElement;
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Imprimir prueba' })));
    expect(bridge.testPrints).toBe(1);
  });

  it('every control in the add and edit cards is at least 44 px tall', async () => {
    await mount();
    const rule = (sel: string) => ['app.css', 'setup.css'].map((f) => readFileSync(`src/styles/${f}`, 'utf8')).join('\n').split('\n').find((l) => l.startsWith(`${sel} {`)) ?? '';
    for (const sel of ['.btn', '.input', '.wz-steps button', '.opt']) expect(rule(sel)).toMatch(/(min-height|height): (44|64)px/);
    const sized = (el: Element) => ['btn', 'opt', 'switch-hit'].some((c) => el.classList.contains(c)) || Boolean(el.closest('.wz-steps'));
    await click(/Agregar impresora/);
    await click('Escribir IP a mano');
    expect([...document.querySelectorAll('.wz-card button')].filter((b) => !sized(b))).toEqual([]);
    expect([...document.querySelectorAll('.wz-card input')].every((i) => i.classList.contains('input'))).toBe(true);
    await click('Cancelar');
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Configurar' })[0]));
    await click('Quitar impresora');
    expect([...document.querySelectorAll('.wz-card button')].filter((b) => !sized(b))).toEqual([]);
  });
});
