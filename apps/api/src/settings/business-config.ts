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

/** S9 (caja-cierres): the tax the restaurant charges; anything but IVA reads as INC. */
export const TAX_TYPES = ['INC', 'IVA'] as const;
export type TaxType = (typeof TAX_TYPES)[number];
const taxType = (value: string): TaxType => (value === 'IVA' ? 'IVA' : 'INC');
/** Printed name of each tax type. */
export const TAX_TYPE_NAMES: Record<TaxType, string> = { INC: 'Impuesto nacional al consumo', IVA: 'IVA' };

/** Business day cut-off: a stored value that is not an integer 0..6 reads as 4. */
const cutoffHour = (value: string) => {
  const trimmed = value.trim();
  const parsed = trimmed.length === 0 ? Number.NaN : Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : 4;
};

/** H-014 / S2 (T12): the invoice prefix, uppercase letters and digits (POS-000123). */
export const INVOICE_PREFIX = /^[A-Z0-9]{1,10}$/;
/** Tax regimes printed on the invoice. */
export const TAX_REGIMES = ['responsable_iva', 'no_responsable_iva', 'regimen_simple'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];
/** Printed name of each tax regime. */
export const TAX_REGIME_NAMES: Record<TaxRegime, string> = {
  responsable_iva: 'Responsable de IVA',
  no_responsable_iva: 'No responsable de IVA',
  regimen_simple: 'Régimen Simple de Tributación',
};
/** The largest consecutive the stored value admits (12 digits, CHECK of 0043). */
const MAX_INVOICE_NUMBER = 999_999_999_999;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** '' (not set) or anything unreadable is null. */
const optionalText = (value: string) => (value.trim().length > 0 ? value.trim() : null);
const prefix = (value: string) => (INVOICE_PREFIX.test(value) ? value : 'POS');
const positive = (value: string) => (/^[1-9][0-9]{0,11}$/.test(value) ? Number(value) : null);
const isoDate = (value: string) => (ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);
const taxRegime = (value: string): TaxRegime | null => ((TAX_REGIMES as readonly string[]).includes(value) ? (value as TaxRegime) : null);

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
  /** S9 (caja-cierres): INC (default, impuesto nacional al consumo) | IVA; labels bills, slips and the Z. */
  taxType: { key: 'tax_type', fallback: 'INC' as TaxType, read: taxType },
  /** H-014 / S2: prefix of the invoice consecutive (default POS). */
  invoicePrefix: { key: 'invoice_prefix', fallback: 'POS', read: prefix },
  /** DIAN resolution number; null when not configured. */
  invoiceResolution: { key: 'invoice_resolution', fallback: null as string | null, read: optionalText },
  /** First number of the authorized range; the consecutive never starts below it (default 1). */
  invoiceRangeFrom: { key: 'invoice_range_from', fallback: 1, read: (v: string) => positive(v) ?? 1 },
  /** Last number of the authorized range; null when not configured. */
  invoiceRangeTo: { key: 'invoice_range_to', fallback: null as number | null, read: positive },
  /** Validity of the resolution, YYYY-MM-DD; null when not configured. */
  invoiceValidFrom: { key: 'invoice_valid_from', fallback: null as string | null, read: isoDate },
  invoiceValidTo: { key: 'invoice_valid_to', fallback: null as string | null, read: isoDate },
  /** Tax regime printed on the invoice; null when not configured (nothing is printed). */
  taxRegime: { key: 'tax_regime', fallback: null as TaxRegime | null, read: taxRegime },
} as const;

export type ConfigField = keyof typeof CONFIG_KEYS;

const percentage = z.number().min(0).max(100);
const shortText = z.string().max(255);
const lateMinutes = z.number().int().min(1).max(240);
const invoiceNumber = z.number().int().min(1).max(MAX_INVOICE_NUMBER);
const calendarDate = z
  .string()
  .regex(ISO_DATE, 'Usa el formato AAAA-MM-DD')
  .refine((value) => isoDate(value) !== null && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'La fecha no existe');

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
  taxType: z.enum(TAX_TYPES).optional(),
  invoicePrefix: z.string().regex(INVOICE_PREFIX, 'El prefijo lleva de 1 a 10 letras mayúsculas o números, sin espacios ni guiones').optional(),
  invoiceResolution: z.string().trim().max(60).nullable().optional(),
  invoiceRangeFrom: invoiceNumber.optional(),
  invoiceRangeTo: invoiceNumber.nullable().optional(),
  invoiceValidFrom: calendarDate.nullable().optional(),
  invoiceValidTo: calendarDate.nullable().optional(),
  taxRegime: z.enum(TAX_REGIMES).nullable().optional(),
});

export const INVOICE_RANGE_MESSAGE = 'El número final del rango autorizado debe ser mayor o igual al inicial';
export const INVOICE_VALIDITY_MESSAGE = 'La fecha final de la vigencia debe ser igual o posterior a la inicial';

/** The stored text of a value: null clears the key (''), a trimmed empty text too. */
export const storedValue = (value: unknown) => (value === null ? '' : String(value));

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
  @ApiProperty({
    enum: TAX_TYPES,
    default: 'INC',
    description:
      'Tipo de impuesto: INC (impuesto nacional al consumo, what restaurants usually charge) or IVA. Labels bills, slips and the informe Z with taxPercentage; changing it never changes taxPercentage.',
  })
  taxType!: TaxType;
  @ApiProperty({ default: 'POS', pattern: '^[A-Z0-9]{1,10}$', description: 'Prefijo de la factura: the invoice number is prefix-consecutive (POS-000123).' })
  invoicePrefix!: string;
  @ApiProperty({ type: String, nullable: true, default: null, description: 'Número de resolución DIAN; printed on the invoice when set.' })
  invoiceResolution!: string | null;
  @ApiProperty({ default: 1, type: 'integer', description: 'First number of the authorized range; the consecutive never starts below it.' })
  invoiceRangeFrom!: number;
  @ApiProperty({ type: 'integer', nullable: true, default: null, description: 'Last number of the authorized range; a payment past it is warned, never blocked.' })
  invoiceRangeTo!: number | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, default: null, description: 'Start of the resolution validity.' })
  invoiceValidFrom!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, default: null, description: 'End of the resolution validity; a payment after it is warned, never blocked.' })
  invoiceValidTo!: string | null;
  @ApiProperty({ enum: TAX_REGIMES, nullable: true, default: null, description: 'Régimen tributario printed on the invoice; null prints none.' })
  taxRegime!: TaxRegime | null;
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
  @ApiPropertyOptional({ enum: TAX_TYPES }) taxType?: TaxType;
  @ApiPropertyOptional({ pattern: '^[A-Z0-9]{1,10}$' }) invoicePrefix?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60, description: 'null clears it.' }) invoiceResolution?: string | null;
  @ApiPropertyOptional({ minimum: 1, type: 'integer' }) invoiceRangeFrom?: number;
  @ApiPropertyOptional({ minimum: 1, type: 'integer', nullable: true, description: 'Must be >= invoiceRangeFrom (the sent or the stored one); null clears it.' })
  invoiceRangeTo?: number | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) invoiceValidFrom?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, description: 'Must be >= invoiceValidFrom; null clears it.' })
  invoiceValidTo?: string | null;
  @ApiPropertyOptional({ enum: TAX_REGIMES, nullable: true, description: 'null clears it.' }) taxRegime?: TaxRegime | null;
}
