import { UnprocessableEntityException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { createUploadSchema } from '../storage/storage.dto';
import { CartaOpeningHours, CartaSettings } from './carta.dto';

/** Admin copy of "Ajustes · Carta digital" (S17, artboard 02); 422 bodies name the field in Spanish. */
export const CARTA_ADMIN_MESSAGES = {
  invalid: 'Revisa los datos de la carta.',
  published: 'Indica si la carta está publicada.',
  switches: 'Revisa los interruptores de la carta.',
  description: 'La descripción corta admite hasta 160 caracteres.',
  brandColor: 'El color de marca debe tener el formato #rrggbb.',
  logoUrl: 'El logo debe ser un enlace https:// de hasta 1000 caracteres.',
  coverUrl: 'La portada debe ser un enlace https:// de hasta 1000 caracteres.',
  instagram: 'Escribe el usuario de Instagram sin @: letras, números, punto o guion bajo (máximo 30).',
  tiktok: 'Escribe el usuario de TikTok sin @: letras, números, punto o guion bajo (máximo 30).',
  whatsapp: 'El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.',
  mapsUrl: 'El enlace de Google Maps debe empezar por https:// (máximo 500 caracteres).',
  googleReviewUrl: 'El enlace para reseñas debe empezar por https:// (máximo 500 caracteres).',
  openingHours: 'Revisa el horario de atención: cada día va cerrado o con apertura y cierre HH:MM distintos.',
  dayparts: 'Revisa las franjas: hasta 12, cada una con nombre, horas y categorías.',
  daypartName: 'El nombre de la franja admite de 1 a 40 caracteres.',
  daypartNameEn: 'El nombre en inglés de la franja admite de 1 a 40 caracteres.',
  daypartHours: 'Cada franja empieza antes de terminar, en HH:MM y sin cruzar la medianoche.',
  sortOrder: 'El orden de la franja debe ser un número entero desde 0.',
  featuredDish: 'El plato del día debe ser un plato de tu restaurante.',
  categories: 'Las categorías de la franja deben ser de tu restaurante.',
  tags: 'Las etiquetas válidas son Vegetariano, Picante, Sin gluten y Lácteos.',
  descriptionEn: 'La descripción en inglés admite hasta 400 caracteres.',
  descriptionEnReviewed: 'Indica si revisaste la descripción en inglés.',
  slug: 'Usa minúsculas y números separados por guiones (sin tildes, espacios ni guiones al inicio o al final), hasta 64 caracteres.',
  slugTaken: 'Ese enlace ya lo usa otro restaurante',
  assetKind: 'Elige si subes el logo o la portada.',
  assetType: 'Sube una imagen PNG, JPG o WebP (no SVG).',
  assetSize: 'La imagen puede pesar hasta 5 MB.',
  saveFailed: 'No pudimos guardar los cambios. Intenta de nuevo.',
  dishNotFound: 'No encontramos este plato.',
  tableNotFound: 'No encontramos esta mesa.',
} as const;
const M = CARTA_ADMIN_MESSAGES;

export const DISH_TAGS = ['vegetarian', 'spicy', 'gluten_free', 'dairy'] as const;
export const CARTA_ASSET_KINDS = ['logo', 'cover'] as const;
/** The formats the asset message names (PNG, JPG, WebP). */
export const CARTA_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** A blank text clears the field (null). */
const optionalText = (rule: z.ZodType<string>) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), rule.nullable()).optional();
const trimmed = z.string().trim();
const httpsUrl = (max: number) => trimmed.max(max).regex(/^https:\/\/\S+$/);
const handle = trimmed.regex(/^[A-Za-z0-9._]{1,30}$/);
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const openingDay = z.strictObject({ opens: hhmm, closes: hhmm }).refine((day) => day.opens !== day.closes).nullable();

/** Same rules as the carta_settings CHECKs (0036); omitted fields keep their value. */
export const cartaSettingsSchema = z.strictObject({
  published: z.boolean().optional(),
  description: optionalText(trimmed.max(160)),
  // Stored lower case, as the CHECK requires.
  brandColor: optionalText(trimmed.regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase())),
  // https only, stricter than the DB CHECK (http(s)).
  logoUrl: optionalText(httpsUrl(1000)),
  coverUrl: optionalText(httpsUrl(1000)),
  instagram: optionalText(handle),
  tiktok: optionalText(handle),
  whatsapp: optionalText(trimmed.regex(/^[0-9]{7,15}$/)),
  mapsUrl: optionalText(httpsUrl(500)),
  googleReviewUrl: optionalText(httpsUrl(500)),
  tableOrderingEnabled: z.boolean().optional(),
  deliveryOrderingEnabled: z.boolean().optional(),
  showTableBill: z.boolean().optional(),
  englishEnabled: z.boolean().optional(),
  openingHours: z
    .strictObject({ 1: openingDay, 2: openingDay, 3: openingDay, 4: openingDay, 5: openingDay, 6: openingDay, 7: openingDay })
    .nullable()
    .optional(),
});

/** carta_dayparts CHECKs (0036); ids of another restaurant are refused by the service. */
export const cartaDaypartsSchema = z.strictObject({
  dayparts: z
    .array(
      z
        .strictObject({
          name: trimmed.min(1).max(40),
          nameEn: optionalText(trimmed.min(1).max(40)),
          startsAt: hhmm,
          endsAt: hhmm,
          sortOrder: z.number().int().min(0).max(1000).optional(),
          featuredDishId: z.guid().nullable().optional(),
          categoryIds: z.array(z.guid()).max(100),
        })
        .refine((daypart) => daypart.startsAt < daypart.endsAt, { path: ['startsAt'] }),
    )
    .max(12),
});

/** dish_public_details CHECKs (0036). */
export const dishDetailsSchema = z.strictObject({
  // Repeated tags count once.
  tags: z.preprocess((value) => (Array.isArray(value) ? [...new Set(value)] : value), z.array(z.enum(DISH_TAGS)).max(4)),
  descriptionEn: optionalText(trimmed.max(400)),
  descriptionEnReviewed: z.boolean(),
});

/** Words of a-z0-9 joined by single dashes, at most 64: the rule of private.set_restaurant_slug (0039). */
export const cartaSlugUpdateSchema = z.strictObject({ slug: z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) });

/** PNG, JPG or WebP up to the storage limit (5 MB); the folder is always carta. */
export const cartaAssetSchema = z.strictObject({
  kind: z.enum(CARTA_ASSET_KINDS),
  contentType: z.enum(CARTA_ASSET_TYPES),
  size: createUploadSchema.shape.size,
});

/** The 422 message of each field; a nested daypart field keeps its own copy. */
const FIELD_MESSAGES: Record<string, string> = {
  published: M.published,
  tableOrderingEnabled: M.switches,
  deliveryOrderingEnabled: M.switches,
  showTableBill: M.switches,
  englishEnabled: M.switches,
  description: M.description,
  brandColor: M.brandColor,
  logoUrl: M.logoUrl,
  coverUrl: M.coverUrl,
  instagram: M.instagram,
  tiktok: M.tiktok,
  whatsapp: M.whatsapp,
  mapsUrl: M.mapsUrl,
  googleReviewUrl: M.googleReviewUrl,
  openingHours: M.openingHours,
  dayparts: M.dayparts,
  name: M.daypartName,
  nameEn: M.daypartNameEn,
  startsAt: M.daypartHours,
  endsAt: M.daypartHours,
  sortOrder: M.sortOrder,
  featuredDishId: M.featuredDish,
  categoryIds: M.categories,
  tags: M.tags,
  descriptionEn: M.descriptionEn,
  descriptionEnReviewed: M.descriptionEnReviewed,
  slug: M.slug,
  kind: M.assetKind,
  contentType: M.assetType,
  size: M.assetSize,
};

/** Parse an admin body: one Spanish 422 for the first wrong field (the deepest named one). */
export function parseCartaAdminInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const path = (parsed.error.issues[0]?.path ?? []).map(String);
  const field = [...path].reverse().find((part) => FIELD_MESSAGES[part] !== undefined);
  throw new UnprocessableEntityException(field ? FIELD_MESSAGES[field] : M.invalid);
}

export class CartaAdminRestaurant {
  @ApiProperty({ example: 'Brasa & Leña' }) name!: string;
  @ApiProperty({ example: 'brasa-y-lena' }) slug!: string;
  @ApiProperty({ example: '/c/brasa-y-lena', description: 'Path of the public carta on the web origin.' }) publicPath!: string;
  @ApiProperty({ example: 'America/Bogota' }) timezone!: string;
}

export class CartaAdminSettings extends CartaSettings {
  @ApiProperty({ description: 'false = the link and the QRs show not found ("Volvemos pronto").' }) published!: boolean;
}

export class CartaAdminDaypart {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Desayuno' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) nameEn!: string | null;
  @ApiProperty({ example: '07:00' }) startsAt!: string;
  @ApiProperty({ example: '11:00', description: 'Exclusive; later than startsAt.' }) endsAt!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '"Plato del día".' }) featuredDishId!: string | null;
  @ApiProperty({ type: [String], description: 'Category ids, in menu order.' }) categoryIds!: string[];
}

export class CartaAdminCategory {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
}

export class CartaAdminDish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Spanish description of the dish.' }) description!: string | null;
  @ApiProperty() price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ description: 'Paused dishes are hidden from the carta.' }) active!: boolean;
  @ApiProperty({ enum: DISH_TAGS, isArray: true }) tags!: string[];
  @ApiProperty({ type: String, nullable: true, description: 'Written by the restaurant (no translation service).' }) descriptionEn!: string | null;
  @ApiProperty() descriptionEnReviewed!: boolean;
  @ApiProperty({ description: '"Lo más pedido": the guest menu rule (top 5 by units on paid orders of the last 30 days).' })
  mostOrdered!: boolean;
}

export class CartaAdminTable {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ type: String, nullable: true, example: 'Terraza' }) zoneName!: string | null;
  @ApiProperty({ description: 'Current QR token.' }) token!: string;
  @ApiProperty({ example: '/c/brasa-y-lena/m/<token>' }) guestPath!: string;
}

export class CartaAdmin {
  @ApiProperty({ type: CartaAdminRestaurant }) restaurant!: CartaAdminRestaurant;
  @ApiProperty({ type: CartaAdminSettings, description: 'Defaults when the carta was never configured.' }) settings!: CartaAdminSettings;
  @ApiProperty({ type: [CartaAdminDaypart] }) dayparts!: CartaAdminDaypart[];
  @ApiProperty({ type: [CartaAdminCategory] }) categories!: CartaAdminCategory[];
  @ApiProperty({ type: [CartaAdminDish] }) dishes!: CartaAdminDish[];
  @ApiProperty({ type: [CartaAdminTable] }) tables!: CartaAdminTable[];
  @ApiProperty({ description: 'Read-only here: business_config delivery_default_fee (Ajustes · Domicilios).' }) deliveryDefaultFee!: number;
}

export class UpdateCartaSettingsRequest {
  @ApiPropertyOptional() published?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160, description: 'Blank clears.' }) description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '#b4532a', description: 'Stored lower case.' }) brandColor?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'https only, e.g. a publicUrl of POST /carta-admin/assets.' }) logoUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'https only.' }) coverUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Handle without @.' }) instagram?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Handle without @.' }) tiktok?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '573104567890', description: '7-15 digits with country code.' }) whatsapp?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'https only.' }) mapsUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'https only.' }) googleReviewUrl?: string | null;
  @ApiPropertyOptional() tableOrderingEnabled?: boolean;
  @ApiPropertyOptional() deliveryOrderingEnabled?: boolean;
  @ApiPropertyOptional() showTableBill?: boolean;
  @ApiPropertyOptional() englishEnabled?: boolean;
  @ApiPropertyOptional({ type: CartaOpeningHours, nullable: true }) openingHours?: CartaOpeningHours | null;
}

export class CartaDaypartInput {
  @ApiProperty({ maxLength: 40 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 }) nameEn?: string | null;
  @ApiProperty({ example: '07:00' }) startsAt!: string;
  @ApiProperty({ example: '11:00' }) endsAt!: string;
  @ApiPropertyOptional({ minimum: 0, description: 'Defaults to the position in the list.' }) sortOrder?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) featuredDishId?: string | null;
  @ApiProperty({ type: [String] }) categoryIds!: string[];
}

export class ReplaceCartaDaypartsRequest {
  @ApiProperty({ type: [CartaDaypartInput], maxItems: 12, description: 'The whole list; it replaces the current one.' })
  dayparts!: CartaDaypartInput[];
}

export class UpdateDishDetailsRequest {
  @ApiProperty({ enum: DISH_TAGS, isArray: true }) tags!: string[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 400 }) descriptionEn?: string | null;
  @ApiProperty() descriptionEnReviewed!: boolean;
}

export class CartaDishDetails {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ enum: DISH_TAGS, isArray: true }) tags!: string[];
  @ApiProperty({ type: String, nullable: true }) descriptionEn!: string | null;
  @ApiProperty() descriptionEnReviewed!: boolean;
}

export class CartaTablesQr {
  @ApiProperty({ type: [CartaAdminTable] }) tables!: CartaAdminTable[];
}

export class UpdateCartaSlugRequest {
  @ApiProperty({ example: 'la-parrilla', maxLength: 64, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }) slug!: string;
}

export class CreateCartaAssetRequest {
  @ApiProperty({ enum: CARTA_ASSET_KINDS }) kind!: (typeof CARTA_ASSET_KINDS)[number];
  @ApiProperty({ enum: CARTA_ASSET_TYPES, description: 'The PUT must send this exact Content-Type.' }) contentType!: (typeof CARTA_ASSET_TYPES)[number];
  @ApiProperty({ minimum: 1, maximum: 5 * 1024 * 1024, description: 'Bytes. The PUT must send exactly this Content-Length.' }) size!: number;
}
