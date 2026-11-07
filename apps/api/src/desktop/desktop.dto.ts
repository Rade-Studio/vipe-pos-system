import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { DESKTOP_UPDATE_CHANNELS, type DesktopUpdateChannel } from '../settings/business-config';

// Contract: desktop/API-CONTRACT.md and desktop/app/src/api/contract.ts (feat/fase3-f5b-desktop).
export const PRINTER_HEALTH = ['ready', 'printing', 'error', 'offline'] as const;
export const CONNECTIONS = ['usb', 'network', 'bluetooth'] as const;
export const ACK_STATUSES = ['printed', 'skipped', 'cancelled'] as const;
export const DRAWER_REASONS = ['manual', 'cash_payment'] as const;
export const STATION_KINDS = ['cashier', 'kitchen', 'bar', 'other'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

const deviceName = z.string().trim().min(1).max(60);
const lowerGuid = z.guid().transform((value) => value.toLowerCase());

export const pairingCodeSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/, 'Expected 6 digits') });

export const claimSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'Expected 6 digits'),
  device: z.strictObject({ name: deviceName, platform: z.literal('windows'), appVersion: z.string().min(1).max(32) }),
});

/** A longer printer error is cut to 200 characters instead of refusing the heartbeat. */
const printerError = z.string().transform((value) => value.slice(0, 200));

export const heartbeatSchema = z.strictObject({
  appVersion: z.string().min(1).max(32),
  target: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  printers: z
    .array(z.strictObject({ id: z.string().min(1).max(64), status: z.enum(PRINTER_HEALTH), error: printerError.optional() }))
    .max(20),
  queue: z.strictObject({ pending: z.number().int().min(0).max(1_000_000), failed: z.number().int().min(0).max(1_000_000) }),
});

/** Up to 100 entries reach the database so a list over 20 answers `too_many_printers`. */
export const printersSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(64),
      name: z.string().trim().min(1).max(80),
      model: z.string().max(80),
      connection: z.enum(CONNECTIONS),
      paperMm: z.union([z.literal(58), z.literal(80)]),
      hasDrawer: z.boolean(),
      stationIds: z.array(lowerGuid).max(20),
    }),
  )
  .max(100)
  .refine((list) => new Set(list.map((printer) => printer.id)).size === list.length, 'Printer ids must be unique');

export const pendingJobsQuerySchema = z.strictObject({
  after: z.guid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const ackSchema = z.strictObject({ status: z.enum(ACK_STATUSES), reason: z.string().max(200).optional() });

export const drawerEventSchema = z.strictObject({
  printerId: z.string().min(1).max(64),
  openedAt: z.iso.datetime({ offset: true }),
  reason: z.enum(DRAWER_REASONS),
  profileId: z.guid().optional(),
});

export const renameDeviceSchema = z.strictObject({ name: deviceName });

export class PairingCode {
  @ApiProperty({ example: '481207', description: '6 digits, single use; shown once.' }) code!: string;
  @ApiProperty({ format: 'date-time', description: '10 minutes after creation.' }) expiresAt!: string;
}

export class PairingRestaurant {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'business_name, else the restaurant name.' }) name!: string;
  @ApiProperty({ description: 'The restaurant name when business_name differs, else empty.' }) branch!: string;
  @ApiProperty({ description: 'business_address or empty.' }) address!: string;
  @ApiProperty({ example: 'LF' }) initials!: string;
}

export class PairingPreview {
  @ApiProperty({ type: PairingRestaurant }) restaurant!: PairingRestaurant;
}

export class PairingClaim {
  @ApiProperty({ format: 'uuid' }) deviceId!: string;
  @ApiProperty({ description: '`vdt_…`, returned only here; send it as `Authorization: Bearer`.' }) deviceToken!: string;
  @ApiProperty({ type: PairingRestaurant }) restaurant!: PairingRestaurant;
  @ApiProperty({ enum: DESKTOP_UPDATE_CHANNELS }) channel!: DesktopUpdateChannel;
}

export class HeartbeatResponse {
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
  @ApiProperty({ enum: DESKTOP_UPDATE_CHANNELS }) channel!: DesktopUpdateChannel;
  @ApiProperty() printingEnabled!: boolean;
  @ApiPropertyOptional({
    description: 'Present (true) when DESKTOP_RELEASES_BASE_URL is set and the app is older than the newest required release of its channel and target.',
  })
  updateRequired?: true;
}

export class DesktopStation {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: STATION_KINDS, description: 'cashier for Caja; other for every prep station.' })
  kind!: StationKind;
  @ApiProperty({ description: 'The Caja station.' }) fixed!: boolean;
  @ApiProperty({ example: 'Entradas, Platos fuertes' }) prints!: string;
  @ApiProperty() productCount!: number;
}

export class DesktopPrinter {
  @ApiProperty({ maxLength: 64 }) id!: string;
  @ApiProperty({ maxLength: 80 }) name!: string;
  @ApiProperty({ maxLength: 80 }) model!: string;
  @ApiProperty({ enum: CONNECTIONS }) connection!: string;
  @ApiProperty({ enum: [58, 80] }) paperMm!: 58 | 80;
  @ApiProperty() hasDrawer!: boolean;
  @ApiProperty({ type: [String], format: 'uuid' }) stationIds!: string[];
}

export class DesktopPendingJob {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['command', 'invoice'] }) kind!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) stationId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) payload!: Record<string, unknown>;
}

export class UpdateManifest {
  @ApiProperty({ example: '1.2.0' }) version!: string;
  @ApiProperty() notes!: string;
  @ApiProperty({ format: 'date-time' }) pub_date!: string;
  @ApiProperty() url!: string;
  @ApiProperty() signature!: string;
}

export class AdminDesktopPrinter extends DesktopPrinter {
  @ApiProperty({ enum: PRINTER_HEALTH, nullable: true, description: 'From the last heartbeat; null when not reported.' })
  status!: string | null;
}

export class DesktopDevice {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['windows'] }) platform!: string;
  @ApiProperty() appVersion!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSeenAt!: string | null;
  @ApiProperty({ description: 'Not revoked and seen within the last 90 seconds.' }) online!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
  @ApiProperty({ type: 'object', properties: { pending: { type: 'integer' }, failed: { type: 'integer' } } })
  queue!: { pending: number; failed: number };
  @ApiProperty({ type: [AdminDesktopPrinter] }) printers!: AdminDesktopPrinter[];
}

export class PairingCodeRequest {
  @ApiProperty({ pattern: '^\\d{6}$', example: '481207' }) code!: string;
}

export class ClaimDeviceInfo {
  @ApiProperty({ minLength: 1, maxLength: 60 }) name!: string;
  @ApiProperty({ enum: ['windows'] }) platform!: 'windows';
  @ApiProperty({ maxLength: 32 }) appVersion!: string;
}

export class ClaimRequest extends PairingCodeRequest {
  @ApiProperty({ type: ClaimDeviceInfo }) device!: ClaimDeviceInfo;
}

export class HeartbeatPrinterStatus {
  @ApiProperty({ maxLength: 64 }) id!: string;
  @ApiProperty({ enum: PRINTER_HEALTH }) status!: string;
  @ApiPropertyOptional({ description: 'Stored cut to 200 characters.' }) error?: string;
}

export class HeartbeatRequest {
  @ApiProperty({ maxLength: 32 }) appVersion!: string;
  @ApiPropertyOptional({ pattern: '^[a-z0-9_-]{1,40}$', default: 'windows', description: 'Tauri {{target}}; windows-x86_64 reads as windows.' })
  target?: string;
  @ApiProperty({ type: [HeartbeatPrinterStatus], maxItems: 20 }) printers!: HeartbeatPrinterStatus[];
  @ApiProperty({ type: 'object', properties: { pending: { type: 'integer', minimum: 0 }, failed: { type: 'integer', minimum: 0 } } })
  queue!: { pending: number; failed: number };
}

export class AckRequest {
  @ApiProperty({ enum: ACK_STATUSES }) status!: string;
  @ApiPropertyOptional({ maxLength: 200 }) reason?: string;
}

export class DrawerEventRequest {
  @ApiProperty({ maxLength: 64 }) printerId!: string;
  @ApiProperty({ format: 'date-time' }) openedAt!: string;
  @ApiProperty({ enum: DRAWER_REASONS }) reason!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Ignored (stored as null) unless staff of the restaurant.' }) profileId?: string;
}

export class RenameDeviceRequest {
  @ApiProperty({ minLength: 1, maxLength: 60 }) name!: string;
}
