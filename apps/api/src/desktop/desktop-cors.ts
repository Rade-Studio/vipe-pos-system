import type { Request } from 'express';

/**
 * Origins of the VIPE desktop app's own pages (setup wizard and Estación
 * panel). Tauri 2 serves them from http://tauri.localhost on Windows and
 * tauri://localhost on macOS and Linux.
 */
export const DESKTOP_APP_ORIGINS: readonly string[] = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

/** Admin routes under /api/desktop use the staff cookie; the app never calls them. */
const ADMIN_PATHS = ['/api/desktop/devices', '/api/desktop/pairing-codes'];

export interface CorsDecision {
  origin: boolean;
  credentials: boolean;
}

/**
 * The web origin gets credentialed CORS everywhere, as before. The desktop
 * app's pages get CORS without credentials on the device routes only
 * (pairing and the bearer-token routes), so a page on those origins can never
 * read a staff response or send the staff cookie.
 */
export function corsDecision(webOrigin: string, origin: string | undefined, url: string): CorsDecision {
  if (origin === webOrigin) {
    return { origin: true, credentials: true };
  }
  const path = url.split('?')[0];
  const deviceRoute = path.startsWith('/api/desktop/') && !ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (origin !== undefined && DESKTOP_APP_ORIGINS.includes(origin) && deviceRoute) {
    return { origin: true, credentials: false };
  }
  return { origin: false, credentials: false };
}

/** Nest/cors per-request options delegate built on corsDecision. */
export function corsOptionsFor(webOrigin: string) {
  return (req: Request, callback: (err: Error | null, options: CorsDecision) => void): void => {
    callback(null, corsDecision(webOrigin, req.headers.origin, req.originalUrl ?? req.url));
  };
}
