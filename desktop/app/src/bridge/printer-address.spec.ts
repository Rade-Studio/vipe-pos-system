import { describe, expect, it } from 'vitest';
import { checkNetworkInput, describeAddress, formatNetworkAddress, manualNetworkPrinter, parseNetworkAddress } from './printer-address';

describe('network printer address (host:port)', () => {
  it('parses at the last colon and defaults the port to 9100', () => {
    expect(parseNetworkAddress('192.168.1.52:9100')).toEqual({ host: '192.168.1.52', port: 9100 });
    expect(parseNetworkAddress('caja-pc.local:9101')).toEqual({ host: 'caja-pc.local', port: 9101 });
    expect(parseNetworkAddress('192.168.1.52')).toEqual({ host: '192.168.1.52', port: 9100 });
  });

  it('formats host and port back to the stored address', () => {
    expect(formatNetworkAddress('192.168.1.52', 9100)).toBe('192.168.1.52:9100');
    expect(parseNetworkAddress(formatNetworkAddress('caja-pc', 515))).toEqual({ host: 'caja-pc', port: 515 });
  });

  it('validates an IPv4 or host name and a port from 1 to 65535', () => {
    expect(checkNetworkInput(' 192.168.1.52 ', '')).toEqual({ ok: true, host: '192.168.1.52', port: 9100 });
    expect(checkNetworkInput('caja-pc.local', '9101')).toEqual({ ok: true, host: 'caja-pc.local', port: 9101 });
    const hostError = 'Escribe una IP como 192.168.1.52 o el nombre del equipo, sin espacios.';
    const portError = 'El puerto es un número entre 1 y 65535.';
    for (const bad of ['192.168.1.300', '192.168.1', 'mi impresora', '', '-caja'])
      expect(checkNetworkInput(bad, '9100')).toEqual({ ok: false, hostError, portError: undefined });
    for (const bad of ['0', '70000', 'abc', '91.5'])
      expect(checkNetworkInput('192.168.1.52', bad)).toEqual({ ok: false, hostError: undefined, portError });
  });

  it('describes where each printer is for the list', () => {
    expect(describeAddress({ connection: 'network', address: '192.168.1.52:9100' })).toBe('Red · 192.168.1.52 · puerto 9100');
    expect(describeAddress({ connection: 'usb', address: 'EPSON TM-T20III Receipt' })).toBe('USB · EPSON TM-T20III Receipt');
    expect(describeAddress({ connection: 'bluetooth', address: 'COM4' })).toBe('Bluetooth · COM4');
  });

  it('builds a network printer typed by hand', () => {
    expect(manualNetworkPrinter('192.168.1.52', 9100)).toMatchObject({
      id: 'net-192.168.1.52:9100', model: 'Impresora de red', connection: 'network', address: '192.168.1.52:9100',
      detail: '192.168.1.52 · puerto 9100', suggestedName: 'Impresora 192.168.1.52',
    });
  });
});
