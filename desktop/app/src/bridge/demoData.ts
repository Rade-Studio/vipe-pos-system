// Sample station data for demo mode and tests (same names as the designs).
// Times are relative to "now" so the panel always reads naturally.
import { DEMO_RESTAURANT } from '../api/mock';
import { freshProgress } from '../setup/flow';
import type { DiscoveredPrinter, HistoryItem, LocalPrinter, QueueItem, StationSettings } from './types';

export const DEFAULT_WEB_URL = 'https://vipe-staging.212.56.33.197.sslip.io';

export const DEMO_DISCOVERED: DiscoveredPrinter[] = [
  { id: 'usb-USB001', model: 'EPSON TM-T20III', connection: 'usb', address: 'EPSON TM-T20III Receipt', detail: 'puerto USB001 · con cajón de dinero', paperMm: 80, hasDrawer: true, suggestedName: 'Caja principal' },
  { id: 'net-192.168.1.40', model: 'Xprinter XP-N160II', connection: 'network', address: '192.168.1.40:9100', detail: '192.168.1.40:9100', paperMm: 80, hasDrawer: false, suggestedName: 'Barra' },
];

export function toLocal(d: DiscoveredPrinter): LocalPrinter {
  return {
    id: d.id, name: d.suggestedName, model: d.model, connection: d.connection, address: d.address,
    paperMm: d.paperMm, encoding: 'cp1252', hasDrawer: d.hasDrawer, cut: true, stationIds: [],
    testResult: null, drawerTested: false,
  };
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function baseSettings(): StationSettings {
  return {
    webUrl: DEFAULT_WEB_URL, deviceId: null, deviceToken: null, restaurant: null, linkedAt: null,
    channel: 'stable', printers: [], autostart: true, autoUpdate: true, soundOnFailure: true,
    setup: freshProgress(),
  };
}

export function linkedSettings(): StationSettings {
  return { ...baseSettings(), deviceId: 'dev-demo-1', deviceToken: 'vdt_demo_0001', restaurant: DEMO_RESTAURANT, linkedAt: ago(60 * 24 * 5) };
}

export function readySettings(): StationSettings {
  const printer = (id: string, name: string, model: string, connection: LocalPrinter['connection'], address: string, station: string, drawer = false): LocalPrinter => ({
    id, name, model, connection, address, paperMm: 80, encoding: 'cp1252', hasDrawer: drawer, cut: true,
    stationIds: [station], testResult: 'ok', drawerTested: drawer,
  });
  return {
    ...linkedSettings(),
    printers: [
      printer('usb-USB001', 'Cocina caliente', 'Epson TM-T20III', 'usb', 'EPSON TM-T20III Receipt', 'st-cocina'),
      printer('net-192.168.1.50', 'Barra', 'Xprinter XP-80', 'network', '192.168.1.50:9100', 'st-barra'),
      printer('net-192.168.1.51', 'Caja', 'Epson TM-T88VI', 'network', '192.168.1.51:9100', 'st-caja', true),
    ],
    setup: { ...freshProgress(), step: 'done', maxStep: 9, prints: true, completed: true },
  };
}

export function demoQueue(failing: boolean): QueueItem[] {
  const q: QueueItem[] = [
    { id: 'j131', title: '#131 · Mesa 4', detail: 'Barra · 2× Limonada de coco', printerName: 'Barra', status: 'printing', attempts: 0, at: ago(1) },
    { id: 'j132', title: '#132 · Domicilio', detail: 'Cocina · 1× Sancocho de gallina', printerName: 'Cocina caliente', status: 'pending', attempts: 0, at: ago(0) },
  ];
  if (failing) {
    q.unshift({ id: 'f2041', title: 'Factura FE-2041 · Mesa 9', detail: 'Caja · $ 58.000', printerName: 'Caja', status: 'failed', attempts: 2, error: 'Sin papel', at: ago(2) });
  }
  return q;
}

export function demoHistory(): HistoryItem[] {
  return [
    { id: 'h128', title: 'Comanda #128 · Mesa 8 · Cocina', detail: 'Cocina caliente · 2× Bandeja paisa, 1× Ajiaco santafereño', status: 'printed', at: ago(3) },
    { id: 'h2040', title: 'Factura FE-2040 · Mesa 3', detail: 'Caja · $ 86.400 · se abrió el cajón', status: 'printed', at: ago(5) },
    { id: 'h-pre5', title: 'Precuenta · Mesa 5', detail: 'Caja · $ 124.500', status: 'printed', at: ago(8) },
    { id: 'h-old', title: 'Comanda #097 · Mesa 2 · Cocina', detail: 'Más de 12 horas en espera: no se imprimió', status: 'skipped', at: ago(60 * 14) },
  ];
}
