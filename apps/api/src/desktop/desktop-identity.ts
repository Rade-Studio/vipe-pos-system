import { createHash, randomBytes, randomInt } from 'node:crypto';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { Pool } from '@vipe/db';
import type { Request } from 'express';

/** A desktop app identity (F5a), resolved from its token hash on every request. */
export interface DesktopDevice {
  readonly id: string;
  readonly restaurantId: string;
  readonly tokenHash: string;
}

const TOKEN_PREFIX = 'vdt_';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Opaque device token: `vdt_` + 32 random bytes (base64url). Only its sha256 is stored. */
export function newDeviceToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

/** A 6-digit pairing code; only its sha256 is stored. */
export const newPairingCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * The client address the pairing limits count. Express `req.ip` is the socket
 * peer while `trust proxy` is not configured (configure-app.ts); behind a
 * reverse proxy every client then shares one bucket and the global limit is
 * the backstop. Hashed: the raw address is never stored.
 */
export const clientIpKey = (req: Request) => `ip:${sha256(req.ip ?? req.socket.remoteAddress ?? 'unknown')}`;

export const DESKTOP_MESSAGES = {
  unauthorized: 'Este computador no está vinculado. Vincúlalo con un código.',
  revoked: 'Este computador fue desvinculado. Vincúlalo de nuevo con un código.',
} as const;

export const deviceUnauthorized = () =>
  new UnauthorizedException({ message: DESKTOP_MESSAGES.unauthorized, code: 'device_unauthorized' });
export const deviceRevoked = () => new UnauthorizedException({ message: DESKTOP_MESSAGES.revoked, code: 'device_revoked' });

/**
 * The device of a plaintext token, recording last_seen_at: 401
 * `device_unauthorized` for a missing, malformed or unknown token, 401
 * `device_revoked` for a revoked one. Runs on the pool outside any
 * app.user_id: private.desktop_touch is the SECURITY DEFINER entry.
 */
export async function resolveDevice(pool: Pool, token: unknown): Promise<DesktopDevice> {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    throw deviceUnauthorized();
  }
  const tokenHash = sha256(token);
  const { rows } = await pool.query<{ device_id: string; restaurant_id: string; revoked: boolean }>(
    'SELECT device_id, restaurant_id, revoked FROM private.desktop_touch($1)',
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw deviceUnauthorized();
  }
  if (row.revoked) {
    throw deviceRevoked();
  }
  return { id: row.device_id, restaurantId: row.restaurant_id, tokenHash };
}

/** A device function refused the token (revoked between the guard and the call): 401 device_revoked. */
export function mapDeviceError(error: unknown): unknown {
  const pg = error as { code?: unknown; message?: unknown };
  if (pg?.code === '42501' && pg.message === 'desktop: device_revoked') {
    return deviceRevoked();
  }
  return error;
}

/** Runs a device query and turns a revoke detected inside the function into 401 device_revoked. */
export async function deviceQuery<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapDeviceError(error) as Error | HttpException;
  }
}
