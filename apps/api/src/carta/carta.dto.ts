import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { ORDER_CHANNELS } from '../catalog/catalog.dto';

export const CARTA_MESSAGES = {
  notFound: 'No encontramos esta carta.',
} as const;

/** restaurants.slug as the carta links use it. */
export const cartaSlugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
/** table_qr_tokens.token (0034): 24 base64url characters. */
export const tableTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const cartaDishIdSchema = z.guid();

export const CARTA_LANGS = ['es', 'en'] as const;
/** Unknown query keys (utm_*, fbclid, ...) are ignored; an unknown lang falls back to the header. */
const langQuery = z.enum(CARTA_LANGS).optional().catch(undefined);
export const cartaQuerySchema = z.object({ channel: z.enum(ORDER_CHANNELS).optional(), lang: langQuery });
export const cartaTableQuerySchema = z.object({ lang: langQuery });

/** Dish tags the restaurant sets (dish_public_details) plus "Lo más pedido" from sales. */
export const CARTA_TAGS = ['vegetarian', 'spicy', 'gluten_free', 'dairy', 'most_ordered'] as const;

export class CartaRestaurant {
  @ApiProperty({ example: 'Brasa & Leña' }) name!: string;
  @ApiProperty({ example: 'brasa-y-lena' }) slug!: string;
  @ApiProperty({ example: 'COP' }) currency!: string;
}

export class CartaOpeningDay {
  @ApiProperty({ example: '07:00', description: 'HH:MM, restaurant time.' }) opens!: string;
  @ApiProperty({ example: '22:30', description: 'HH:MM; earlier than opens = closes after midnight.' }) closes!: string;
}

export class CartaOpeningHours {
  @ApiProperty({ type: CartaOpeningDay, nullable: true, description: 'Monday; null = closed.' }) '1'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true }) '2'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true }) '3'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true }) '4'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true }) '5'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true }) '6'!: CartaOpeningDay | null;
  @ApiProperty({ type: CartaOpeningDay, nullable: true, description: 'Sunday.' }) '7'!: CartaOpeningDay | null;
}

export class CartaSettings {
  @ApiProperty({ type: String, nullable: true, description: 'Short description under the name (<= 160).' }) description!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '#b4532a' }) brandColor!: string | null;
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) coverUrl!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Handle without @.' }) instagram!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Handle without @.' }) tiktok!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Digits with country code.' }) whatsapp!: string | null;
  @ApiProperty({ type: String, nullable: true }) mapsUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) googleReviewUrl!: string | null;
  @ApiProperty() tableOrderingEnabled!: boolean;
  @ApiProperty() deliveryOrderingEnabled!: boolean;
  @ApiProperty() showTableBill!: boolean;
  @ApiProperty({ description: 'Off: lang is always es and no English text is returned.' }) englishEnabled!: boolean;
  @ApiProperty({ type: CartaOpeningHours, nullable: true, description: 'null = not configured (always open).' })
  openingHours!: CartaOpeningHours | null;
}

export class CartaNextOpening {
  @ApiProperty({ example: '2026-11-11', description: 'Restaurant-local date.' }) date!: string;
  @ApiProperty({ example: '07:00' }) opensAt!: string;
  @ApiProperty({ example: 1, description: '0 = later today, 1 = tomorrow, ...' }) inDays!: number;
}

export class CartaDaypart {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Desayuno' }) name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'null when unset or English is off.' }) nameEn!: string | null;
  @ApiProperty({ example: '07:00' }) startsAt!: string;
  @ApiProperty({ example: '11:00', description: 'Exclusive.' }) endsAt!: string;
  @ApiProperty({ description: 'Its [startsAt, endsAt) holds now (server clock, restaurant timezone).' }) current!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '"Plato del día"; null unless listed in the menu.' })
  featuredDishId!: string | null;
  @ApiProperty({ type: [String], description: 'Categories of the daypart that the menu lists, in menu order.' }) categoryIds!: string[];
}

export class CartaModifierOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Added to the unit price.' }) price!: number;
}

export class CartaModifierGroup {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() minSelect!: number;
  @ApiProperty({ type: Number, nullable: true }) maxSelect!: number | null;
  @ApiProperty({ type: [CartaModifierOption] }) options!: CartaModifierOption[];
}

export class CartaDish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Always in Spanish.' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiPropertyOptional({ description: "The restaurant's English description; only when English is on and it is set." })
  descriptionEn?: string;
  @ApiProperty({ description: 'List price, as the waiter menu.' }) price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) subcategoryId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Opaque image reference, as the waiter menu.' }) imageUrl!: string | null;
  @ApiProperty() allowComments!: boolean;
  @ApiProperty({ description: 'false = "Agotado hoy": listed after the available dishes, cannot be added.' }) available!: boolean;
  @ApiProperty({ enum: CARTA_TAGS, isArray: true }) tags!: string[];
  @ApiPropertyOptional({ format: 'uuid', description: 'The automatic promotion a line would get now on the channel (waiter menu rule).' })
  promotionId?: string;
  @ApiPropertyOptional() promotionName?: string;
  @ApiPropertyOptional({ example: '2x1' }) promotionBadge?: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '16:00', description: 'End of the current window; null = all day.' })
  promotionEndsAt?: string | null;
  @ApiPropertyOptional({ description: 'Only for a product discount: the unit price after it.' }) promoPrice?: number;
  @ApiProperty({ type: [CartaModifierGroup] }) modifierGroups!: CartaModifierGroup[];
}

export class CartaSubcategory {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class CartaCategory {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() icon!: string;
  @ApiProperty() color!: string;
  @ApiProperty() hasSubcategories!: boolean;
  @ApiProperty({ type: [CartaSubcategory] }) subcategories!: CartaSubcategory[];
  @ApiProperty({ type: [CartaDish] }) dishes!: CartaDish[];
}

export class CartaMenu {
  @ApiProperty({ type: [CartaCategory], description: 'The waiter menu tree for the channel: same categories, dishes, prices, promotions and availability.' })
  categories!: CartaCategory[];
  @ApiProperty({ type: [CartaDish], description: 'Active dishes without category.' }) uncategorized!: CartaDish[];
}

export class CartaTable {
  @ApiProperty({ example: 12 }) number!: number;
  @ApiProperty({ type: String, nullable: true, example: 'Terraza' }) zoneName!: string | null;
  @ApiProperty({ description: 'The table has an open order (guest orders need it).' }) isOpen!: boolean;
}

export class Carta {
  @ApiProperty({ enum: CARTA_LANGS, description: 'lang query, else Accept-Language (en* = en), else es.' }) lang!: string;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel!: string;
  @ApiProperty({ type: CartaRestaurant }) restaurant!: CartaRestaurant;
  @ApiProperty({ type: CartaSettings }) settings!: CartaSettings;
  @ApiProperty({ description: 'Server clock in the restaurant timezone; true when no hours are configured.' }) isOpenNow!: boolean;
  @ApiProperty({ type: String, nullable: true, example: '22:30', description: 'When open: the time it closes.' }) closesAt!: string | null;
  @ApiProperty({ type: CartaNextOpening, nullable: true, description: 'When closed: the next opening.' }) nextOpening!: CartaNextOpening | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) currentDaypartId!: string | null;
  @ApiProperty({ type: [CartaDaypart] }) dayparts!: CartaDaypart[];
  @ApiProperty({ type: CartaMenu }) menu!: CartaMenu;
  @ApiProperty({ example: 4000 }) deliveryFee!: number;
  @ApiProperty({ example: 10 }) tipPercentage!: number;
  @ApiPropertyOptional({ type: CartaTable, description: 'Only on the table QR route.' }) table?: CartaTable;
}

export class CartaShareRestaurant {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class CartaShareDish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() price!: number;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
}

export class CartaDishShare {
  @ApiProperty({ type: CartaShareRestaurant }) restaurant!: CartaShareRestaurant;
  @ApiProperty({ type: CartaShareDish }) dish!: CartaShareDish;
}
