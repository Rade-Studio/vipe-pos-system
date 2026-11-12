import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * The known business_config keys: the stored key, its camelCase DTO field,
 * the server default and how the text column is typed. The server is the only
 * source of defaults (ported from the web's business-config-service, plus
 * delivery_default_fee, whose missing value the web already read as 0).
 */
const number = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
/** Same rule as the web's suggestedFeeFromConfig: anything but a non-negative integer is 0. */
const wholeFee = (value: string) => {
  const trimmed = value.trim();
  const parsed = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const text = (value: string) => value;

/** How waiters reach the system (F2): their own accounts (default) or a shared terminal with a personal PIN. */
export const WAITER_ACCESS_MODES = ['own_accounts', 'shared_terminal'] as const;
export type WaiterAccessMode = (typeof WAITER_ACCESS_MODES)[number];
const accessMode = (value: string): WaiterAccessMode => (value === 'shared_terminal' ? 'shared_terminal' : 'own_accounts');
/** Update channel of the restaurant's desktop app (F5a, L32): pilot receives versions before stable. */
export const DESKTOP_UPDATE_CHANNELS = ['stable', 'pilot'] as const;
export type DesktopUpdateChannel = (typeof DESKTOP_UPDATE_CHANNELS)[number];
const updateChannel = (value: string): DesktopUpdateChannel => (value === 'pilot' ? 'pilot' : 'stable');
/** Late thresholds: a stored value that is not an integer 1..240 reads as the default. */
const minutes = (fallback: number) => (value: string) => {
  const trimmed = value.trim();
  const parsed = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 240 ? parsed : fallback;
};

/** Business day cut-off: a stored value that is not an integer 0..6 reads as 4. */
const cutoffHour = (value: string) => {
  const trimmed = value.trim();
  const parsed = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : 4;
};

export const CONFIG_KEYS = {
  taxPercentage: { key: 'tax_percentage', fallback: 10, read: (v: string) => number(v, 10) },
  tipPercentage: { key: 'tip_percentage', fallback: 10, read: (v: string) => number(v, 10) },
  priceSuggestion: { key: 'price_suggestion', fallback: 300, read: (v: string) => number(v, 300) },
  businessName: { key: 'business_name', fallback: 'Mi Restaurante', read: text },
  businessAddress: { key: 'business_address', fallback: 'Dirección del Restaurante', read: text },
  businessPhone: { key: 'business_phone', fallback: '123-456-7890', read: text },
  businessNit: { key: 'business_nit', fallback: '123456789', read: text },
  inventoryControlEnabled: { key: 'inventory_control_enabled', fallback: false, read: (v: string) => v === 'true' },
  deliveryDefaultFee: { key: 'delivery_default_fee', fallback: 0, read: wholeFee },
  /** Minutes after which a kitchen ticket is late (default 25: the rail's at-risk 15 / late 25). */
  kitchenLateMinutes: { key: 'kitchen_late_minutes', fallback: 25, read: minutes(25) },
  /** Minutes after which an open delivery is late (default 45). */
  deliveryLateMinutes: { key: 'delivery_late_minutes', fallback: 45, read: minutes(45) },
  /** own_accounts (default, a login per waiter) | shared_terminal (order writes need a PIN identification). */
  waiterAccessMode: { key: 'waiter_access_mode', fallback: 'own_accounts' as WaiterAccessMode, read: accessMode },
  /** F1 (L14): a supervisor may authorize their own cancellation or void; off by default, such events are flagged self_authorized. */
  allowSelfAuthorization: { key: 'allow_self_authorization', fallback: false, read: (v: string) => v === 'true' },
  /** F6 (S2): the restaurant uses thermal printers; a missing key reads as true, so existing restaurants keep printing. */
  printingEnabled: { key: 'printing_enabled', fallback: true, read: (v: string) => v !== 'false' },
  /** F5a: stable (default) | pilot; anything else reads as stable. */
  desktopUpdateChannel: { key: 'desktop_update_channel', fallback: 'stable' as DesktopUpdateChannel, read: updateChannel },
  /** S5 (caja-cierres): hour 0..6 (default 4); a register opened before it belongs to the previous business day. */
  businessDayCutoffHour: { key: 'business_day_cutoff_hour', fallback: 4, read: cutoffHour },
} as const;

export type ConfigField = keyof typeof CONFIG_KEYS;

const percentage = z.number().min(0).max(100);
const shortText = z.string().max(255);
const lateMinutes = z.number().int().min(1).max(240);

export const updateConfigSchema = z.strictObject({
  taxPercentage: percentage.optional(),
  tipPercentage: percentage.optional(),
  priceSuggestion: z.number().min(0).optional(),
  businessName: shortText.optional(),
  businessAddress: shortText.optional(),
  businessPhone: shortText.optional(),
  businessNit: shortText.optional(),
  inventoryControlEnabled: z.boolean().optional(),
  deliveryDefaultFee: z.number().int().min(0).optional(),
  kitchenLateMinutes: lateMinutes.optional(),
  deliveryLateMinutes: lateMinutes.optional(),
  waiterAccessMode: z.enum(WAITER_ACCESS_MODES).optional(),
  allowSelfAuthorization: z.boolean().optional(),
  printingEnabled: z.boolean().optional(),
  desktopUpdateChannel: z.enum(DESKTOP_UPDATE_CHANNELS).optional(),
  businessDayCutoffHour: z.number().int().min(0).max(6).optional(),
});

/** Typed config built from the stored rows; missing or unreadable keys take the default. */
export function configFromRows(rows: readonly { key: string; value: string }[]): BusinessConfig {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const config: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(CONFIG_KEYS)) {
    const value = stored.get(spec.key);
    config[field] = value === undefined ? spec.fallback : spec.read(value);
  }
  return config as unknown as BusinessConfig;
}

export class BusinessConfig {
  @ApiProperty({ default: 10 }) taxPercentage!: number;
  @ApiProperty({ default: 10 }) tipPercentage!: number;
  @ApiProperty({ default: 300 }) priceSuggestion!: number;
  @ApiProperty({ default: 'Mi Restaurante' }) businessName!: string;
  @ApiProperty({ default: 'Dirección del Restaurante' }) businessAddress!: string;
  @ApiProperty({ default: '123-456-7890' }) businessPhone!: string;
  @ApiProperty({ default: '123456789' }) businessNit!: string;
  @ApiProperty({ default: false }) inventoryControlEnabled!: boolean;
  @ApiProperty({ default: 0, description: 'Suggested delivery fee in whole pesos.' }) deliveryDefaultFee!: number;
  @ApiProperty({ default: 25, minimum: 1, maximum: 240, description: 'Minutes after which a kitchen ticket is late.' })
  kitchenLateMinutes!: number;
  @ApiProperty({ default: 45, minimum: 1, maximum: 240, description: 'Minutes after which an open delivery is late.' })
  deliveryLateMinutes!: number;
  @ApiProperty({
    enum: WAITER_ACCESS_MODES,
    default: 'own_accounts',
    description: 'own_accounts: each waiter logs in; shared_terminal: a terminal session takes orders and each write needs the PIN identification.',
  })
  waiterAccessMode!: WaiterAccessMode;
  @ApiProperty({
    default: false,
    description:
      'Permitir que el supervisor se autorice a sí mismo: when true, an admin or cashier may authorize their own cancellation or void with their PIN and the event is flagged selfAuthorized; when false another supervisor must authorize (403 self_authorization_not_allowed).',
  })
  allowSelfAuthorization!: boolean;
  @ApiProperty({
    default: true,
    description:
      'Este restaurante usa impresoras térmicas: when false, POST /print/commands and /print/invoices answer 409 printing_disabled and the screens offer no print action.',
  })
  printingEnabled!: boolean;
  @ApiProperty({
    enum: DESKTOP_UPDATE_CHANNELS,
    default: 'stable',
    description: 'Update channel of the VIPE desktop app: pilot receives new versions before stable.',
  })
  desktopUpdateChannel!: DesktopUpdateChannel;
  @ApiProperty({
    default: 4,
    minimum: 0,
    maximum: 6,
    description:
      "Hora de corte del día de negocio: a register belongs to the date of its opening in the restaurant's timezone minus this many hours (opened at 1:00 a.m. with 4 is the previous day).",
  })
  businessDayCutoffHour!: number;
}

export class UpdateBusinessConfigRequest {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) taxPercentage?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) tipPercentage?: number;
  @ApiPropertyOptional({ minimum: 0 }) priceSuggestion?: number;
  @ApiPropertyOptional({ maxLength: 255 }) businessName?: string;
  @ApiPropertyOptional({ maxLength: 255 }) businessAddress?: string;
  @ApiPropertyOptional({ maxLength: 255 }) businessPhone?: string;
  @ApiPropertyOptional({ maxLength: 255 }) businessNit?: string;
  @ApiPropertyOptional() inventoryControlEnabled?: boolean;
  @ApiPropertyOptional({ minimum: 0, type: 'integer' }) deliveryDefaultFee?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 240, type: 'integer' }) kitchenLateMinutes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 240, type: 'integer' }) deliveryLateMinutes?: number;
  @ApiPropertyOptional({ enum: WAITER_ACCESS_MODES }) waiterAccessMode?: WaiterAccessMode;
  @ApiPropertyOptional({ description: 'Admin only, like every key.' }) allowSelfAuthorization?: boolean;
  @ApiPropertyOptional() printingEnabled?: boolean;
  @ApiPropertyOptional({ enum: DESKTOP_UPDATE_CHANNELS }) desktopUpdateChannel?: DesktopUpdateChannel;
  @ApiPropertyOptional({ minimum: 0, maximum: 6, type: 'integer' }) businessDayCutoffHour?: number;
}
