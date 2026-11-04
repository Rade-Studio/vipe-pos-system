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
} as const;

export type ConfigField = keyof typeof CONFIG_KEYS;

const percentage = z.number().min(0).max(100);
const shortText = z.string().max(255);

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
}
