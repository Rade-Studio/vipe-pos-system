// Network printers are stored as `address = host:port` (L3); the core splits
// it at the last ':' (desktop/core/src/station.rs, port 9100 by default).
import type { ConnectionKind } from '../api/contract';
import type { DiscoveredPrinter } from './types';

export const DEFAULT_PORT = 9100;
const HOST_ERROR = 'Escribe una IP como 192.168.1.52 o el nombre del equipo, sin espacios.';
const PORT_ERROR = 'El puerto es un número entre 1 y 65535.';
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

export function parseNetworkAddress(address: string): { host: string; port: number } {
  const at = address.lastIndexOf(':');
  const port = at < 0 ? NaN : Number(address.slice(at + 1));
  if (at < 0 || !Number.isInteger(port)) return { host: address, port: DEFAULT_PORT };
  return { host: address.slice(0, at), port };
}

export function formatNetworkAddress(host: string, port: number): string {
  return `${host}:${port}`;
}

function validHost(host: string): boolean {
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split('.');
    return parts.length === 4 && parts.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255);
  }
  return host.length <= 253 && host.split('.').every((l) => LABEL.test(l));
}

export type NetworkCheck = { ok: true; host: string; port: number } | { ok: false; hostError?: string; portError?: string };

/** Validates the "IP o nombre del equipo" and "Puerto" fields; an empty port is 9100. */
export function checkNetworkInput(hostRaw: string, portRaw: string): NetworkCheck {
  const host = hostRaw.trim();
  const portText = portRaw.trim();
  const port = portText === '' ? DEFAULT_PORT : /^\d+$/.test(portText) ? Number(portText) : NaN;
  const hostError = validHost(host) ? undefined : HOST_ERROR;
  const portError = port >= 1 && port <= 65535 ? undefined : PORT_ERROR;
  if (hostError || portError) return { ok: false, hostError, portError };
  return { ok: true, host, port };
}

export function networkText(address: string): string {
  const { host, port } = parseNetworkAddress(address);
  return `${host} · puerto ${port}`;
}

/** "Red · 192.168.1.52 · puerto 9100", "USB · EPSON TM-T20III Receipt". */
export function describeAddress(p: { connection: ConnectionKind; address: string }): string {
  if (p.connection === 'network') return `Red · ${networkText(p.address)}`;
  return `${p.connection === 'usb' ? 'USB' : 'Bluetooth'} · ${p.address}`;
}

/** A network printer typed by hand ("Escribir IP a mano"). */
export function manualNetworkPrinter(host: string, port: number): DiscoveredPrinter {
  const address = formatNetworkAddress(host, port);
  return {
    id: `net-${address}`, model: 'Impresora de red', connection: 'network', address, detail: networkText(address),
    paperMm: 80, hasDrawer: false, suggestedName: `Impresora ${host}`,
  };
}
