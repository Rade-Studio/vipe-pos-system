import {
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { DbClient } from '../db/db-client';
import { UnitOfWork } from '../db/unit-of-work';
import { CONFIG_KEYS } from '../settings/business-config';
import { newDeviceToken, newPairingCode, sha256 } from './desktop-identity';
import type { claimSchema, PairingClaim, PairingCode, PairingPreview, PairingRestaurant } from './desktop.dto';

const iso = (value: Date | string) => new Date(value).toISOString();
const CANDIDATES = 5;

const MESSAGES = {
  invalid: 'Ese código no existe. Revisa los 6 dígitos o genera uno nuevo.',
  expired: 'El código venció. Genera uno nuevo en VIPE → Ajustes → Estación de impresión.',
  attempts: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  unavailable: 'No se pudo generar un código. Vuelve a intentarlo.',
} as const;

type Status = 'ok' | 'invalid' | 'expired' | 'attempts';

interface RestaurantRow {
  restaurant_id: string;
  restaurant_name: string;
  business_name: string | null;
  business_address: string | null;
}

/** First letters of up to two words of the name, upper case ("La Fonda Paisa" → "LF"). */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toLocaleUpperCase('es'))
    .join('');

function toRestaurant(row: RestaurantRow): PairingRestaurant {
  const business = row.business_name?.trim();
  const name = business || row.restaurant_name;
  return {
    id: row.restaurant_id,
    name,
    branch: business && business !== row.restaurant_name ? row.restaurant_name : '',
    address: row.business_address?.trim() ?? '',
    initials: initialsOf(name),
  };
}

/** 404 / 410 / 429 for a refused code; never says which part of the code was wrong. */
function refusal(status: Exclude<Status, 'ok'>): HttpException {
  switch (status) {
    case 'invalid':
      return new NotFoundException({ message: MESSAGES.invalid, code: 'pairing_code_invalid' });
    case 'expired':
      return new GoneException({ message: MESSAGES.expired, code: 'pairing_code_expired' });
    case 'attempts':
      return new HttpException({ message: MESSAGES.attempts, code: 'pairing_attempts' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Pairing (F5a): an admin creates a 6-digit code in the request transaction;
 * the desktop app previews and claims it without a session, on the pool,
 * through the SECURITY DEFINER functions keyed by sha256(code) and the client
 * IP key, which also count wrong codes. Codes and tokens are never logged.
 */
@Injectable()
export class DesktopPairingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly client: DbClient,
  ) {}

  /** Five random candidates; the function keeps the first that is not a live code. */
  async createCode(): Promise<PairingCode> {
    const codes = Array.from({ length: CANDIDATES }, newPairingCode);
    try {
      const { rows } = await this.uow.db.execute(sql`
        SELECT attempt, expires_at FROM private.desktop_create_pairing_code(${sql.param(codes.map(sha256))}::text[])`);
      const row = rows[0] as { attempt: number; expires_at: Date | string };
      return { code: codes[row.attempt - 1], expiresAt: iso(row.expires_at) };
    } catch (error) {
      const pg = error as { message?: string; cause?: { message?: string } };
      if ([pg.message, pg.cause?.message].includes('desktop_create_pairing_code: collision')) {
        throw new ServiceUnavailableException({ message: MESSAGES.unavailable, code: 'pairing_code_unavailable' });
      }
      throw error;
    }
  }

  async preview(code: string, ipKey: string): Promise<PairingPreview> {
    const { rows } = await this.client.pool.query<RestaurantRow & { status: Status }>(
      'SELECT status, restaurant_id, restaurant_name, business_name, business_address FROM private.desktop_pairing_preview($1, $2)',
      [sha256(code), ipKey],
    );
    const row = rows[0];
    if (row.status !== 'ok') {
      throw refusal(row.status);
    }
    return { restaurant: toRestaurant(row) };
  }

  async claim(input: z.infer<typeof claimSchema>, ipKey: string): Promise<PairingClaim> {
    const { token, hash } = newDeviceToken();
    const { rows } = await this.client.pool.query<RestaurantRow & { status: Status; device_id: string; channel: string }>(
      `SELECT status, device_id, restaurant_id, restaurant_name, business_name, business_address, channel
         FROM private.desktop_pairing_claim($1, $2, $3, $4, $5, $6)`,
      [sha256(input.code), ipKey, input.device.name, input.device.platform, input.device.appVersion, hash],
    );
    const row = rows[0];
    if (row.status !== 'ok') {
      throw refusal(row.status);
    }
    return {
      deviceId: row.device_id,
      deviceToken: token,
      restaurant: toRestaurant(row),
      channel: CONFIG_KEYS.desktopUpdateChannel.read(row.channel),
    };
  }
}
