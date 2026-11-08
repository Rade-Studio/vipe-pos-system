import { describe, expect, it } from 'vitest';
import { corsDecision } from './desktop-cors';

const WEB = 'https://vipe.example.co';
const OFF = { origin: false, credentials: false };

describe('corsDecision', () => {
  it('keeps credentialed CORS for the web origin on every route', () => {
    for (const url of ['/api/orders', '/api/desktop/devices', '/api/desktop/pairing/preview']) {
      expect(corsDecision(WEB, WEB, url)).toEqual({ origin: true, credentials: true });
    }
  });

  it('lets the desktop app pages call the device routes without credentials', () => {
    for (const origin of ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']) {
      for (const url of [
        '/api/desktop/pairing/preview',
        '/api/desktop/pairing/claim',
        '/api/desktop/heartbeat',
        '/api/desktop/jobs/pending?after=x',
        '/api/desktop/updates/windows/0.1.0',
      ]) {
        expect(corsDecision(WEB, origin, url)).toEqual({ origin: true, credentials: false });
      }
    }
  });

  it('refuses the desktop origins on staff and admin routes', () => {
    for (const url of ['/api/orders', '/api/auth/login', '/api/desktop/devices', '/api/desktop/devices/1', '/api/desktop/pairing-codes', '/api/desktopx']) {
      expect(corsDecision(WEB, 'http://tauri.localhost', url)).toEqual(OFF);
    }
  });

  it('refuses any other origin', () => {
    expect(corsDecision(WEB, 'https://evil.example', '/api/desktop/pairing/preview')).toEqual(OFF);
    expect(corsDecision(WEB, 'http://tauri.localhost.evil.example', '/api/desktop/heartbeat')).toEqual(OFF);
    expect(corsDecision(WEB, undefined, '/api/desktop/heartbeat')).toEqual(OFF);
  });
});
