import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '@vipe/db';

/** A printing-service identity, resolved from its token hash. */
export interface Printer {
  readonly id: string;
  readonly restaurantId: string;
  readonly tokenHash: string;
}

const TOKEN_PREFIX = 'vpt_';

/** Opaque printer token: `vpt_` + 32 random bytes (base64url). Only its sha256 is stored. */
export function newPrinterToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashPrinterToken(token) };
}

export function hashPrinterToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The live printer of a plaintext token, recording last_seen_at, or undefined
 * for an unknown or revoked token. Runs on the pool outside any app.user_id:
 * private.touch_printer is the SECURITY DEFINER entry that resolves the tenant.
 */
export async function resolvePrinter(pool: Pool, token: unknown): Promise<Printer | undefined> {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    return undefined;
  }
  const tokenHash = hashPrinterToken(token);
  const { rows } = await pool.query<{ id: string; restaurant_id: string }>(
    'SELECT id, restaurant_id FROM private.touch_printer($1)',
    [tokenHash],
  );
  const row = rows[0];
  return row ? { id: row.id, restaurantId: row.restaurant_id, tokenHash } : undefined;
}
