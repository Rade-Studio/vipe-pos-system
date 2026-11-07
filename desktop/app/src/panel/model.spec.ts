import { describe, expect, it } from 'vitest';
import { createDemoBridge } from '../bridge/demo';
import { statusPill, trayMenu } from './model';

async function state(scenario: 'ready' | 'failing' | 'empty' | 'offline') {
  const bridge = createDemoBridge({ scenario, storage: null });
  return { settings: await bridge.loadSettings(), status: await bridge.status() };
}

describe('title-bar pill', () => {
  it('counts ready printers', async () => {
    const { settings, status } = await state('ready');
    expect(statusPill(settings, status)).toEqual({ tone: 'ok', label: 'Impresión: 3 listas' });
  });

  it('shows failures before anything else but the connection', async () => {
    const { settings, status } = await state('failing');
    expect(statusPill(settings, status)).toEqual({ tone: 'danger', label: 'Impresión: 1 con falla' });
    expect(statusPill(settings, { ...status, connection: 'offline' })).toEqual({ tone: 'danger', label: 'Sin conexión' });
    expect(statusPill(settings, { ...status, connection: 'reconnecting' })).toEqual({ tone: 'warning', label: 'Reconectando' });
  });

  it('says when this computer has no printers or printing is off', async () => {
    const { settings, status } = await state('empty');
    expect(statusPill(settings, status)).toEqual({ tone: 'muted', label: 'Sin impresoras' });
    const ready = await state('ready');
    expect(statusPill(ready.settings, { ...ready.status, printingEnabled: false })).toEqual({ tone: 'muted', label: 'Impresión apagada' });
  });

  it('uses the singular for one printer', async () => {
    const { settings, status } = await state('ready');
    const one = { ...settings, printers: settings.printers.slice(0, 1) };
    expect(statusPill(one, { ...status, printers: status.printers.slice(0, 1) }).label).toBe('Impresión: 1 lista');
  });
});

describe('tray menu', () => {
  it('lists the actions and every printer with its state', async () => {
    const { settings, status } = await state('failing');
    const menu = trayMenu(settings, status);
    expect(menu.tooltip).toBe('VIPE — Impresión: 1 con falla');
    expect(menu.items.map((i) => i.label)).toEqual([
      'Abrir VIPE',
      'Estación de impresión',
      'Cocina caliente · Lista',
      'Barra · Imprimiendo',
      'Caja · Sin papel',
      'Salir',
    ]);
    expect(menu.items.filter((i) => i.id.startsWith('printer:')).every((i) => !i.enabled)).toBe(true);
    expect(menu.items.find((i) => i.id === 'quit')?.enabled).toBe(true);
  });

  it('says there are no printers', async () => {
    const { settings, status } = await state('empty');
    expect(trayMenu(settings, status).items.map((i) => i.label)).toEqual([
      'Abrir VIPE',
      'Estación de impresión',
      'Sin impresoras',
      'Salir',
    ]);
  });
});
