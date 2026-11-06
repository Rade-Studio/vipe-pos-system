import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';

const isDate = (value: string) => !Number.isNaN(Date.parse(value));
const dateString = z.string().refine(isDate, 'Invalid date');
const nullableText = z.string().nullable();
/** numeric(10,2) columns. */
const money = z.number().min(0).max(99_999_999.99);

const sortOrder = z.number().int().min(-100_000).max(100_000);
/** A full reorder: position i gets sort_order i. */
const orderedIds = z.array(z.guid()).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length, 'Duplicate id');

// ---- Categories -------------------------------------------------------------

/** categories_color_check: the menu tree design tokens plus neutral, the default. */
export const CATEGORY_COLORS = ['neutral', 'yellow', 'orange', 'sky', 'violet', 'emerald', 'rose'] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export const CATEGORY_MESSAGES = {
  hasSubcategories: 'La categoría tiene subcategorías; elimínalas primero',
} as const;

export const categoryListQuerySchema = z.strictObject({ active: booleanQuery.optional() });

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText.optional(),
  icon: z.string().trim().min(1).max(50),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
  color: z.enum(CATEGORY_COLORS).optional(),
});
export const updateCategorySchema = createCategorySchema.partial();

export const categoryOrderSchema = z.strictObject({ ids: orderedIds });

export class Category {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() icon!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: 'Menu order; the list is ordered by sortOrder, then name.' }) sortOrder!: number;
  @ApiProperty({ enum: CATEGORY_COLORS }) color!: CategoryColor;
  @ApiProperty({
    description:
      'Derived: true when any dish of the category (active or not) sits in a subcategory. False is "sin subcategorías": the pickers skip the subcategory step.',
  })
  hasSubcategories!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreateCategoryRequest {
  @ApiProperty({ maxLength: 100 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ maxLength: 50 }) icon!: string;
  @ApiPropertyOptional({ default: true }) active?: boolean;
  @ApiPropertyOptional({ description: 'Omitted: after the last category.' }) sortOrder?: number;
  @ApiPropertyOptional({ enum: CATEGORY_COLORS, description: 'Omitted: neutral.' }) color?: CategoryColor;
}

export class UpdateCategoryRequest {
  @ApiPropertyOptional({ maxLength: 100 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ maxLength: 50 }) icon?: string;
  @ApiPropertyOptional() active?: boolean;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional({ enum: CATEGORY_COLORS }) color?: CategoryColor;
}

export class CategoryOrderRequest {
  @ApiProperty({ type: [String], description: 'Category ids in menu order; position i gets sortOrder i. Ids left out keep theirs.' })
  ids!: string[];
}

// ---- Subcategories ----------------------------------------------------------

export const SUBCATEGORY_MESSAGES = {
  duplicateName: 'Ya existe una subcategoría con ese nombre en la categoría',
  hasDishes: 'La subcategoría tiene platos; muévelos primero',
} as const;

const subcategoryName = z.string().trim().min(1).max(40);

export const subcategoryListQuerySchema = z.strictObject({
  categoryId: z.guid().optional(),
  includeInactive: booleanQuery.optional(),
});

export const createSubcategorySchema = z.strictObject({
  categoryId: z.guid(),
  name: subcategoryName,
  sortOrder: sortOrder.optional(),
  active: z.boolean().optional(),
});
/** A subcategory does not move to another category: its dishes would leave theirs. */
export const updateSubcategorySchema = createSubcategorySchema.omit({ categoryId: true }).partial();

export const subcategoryOrderSchema = z.strictObject({ categoryId: z.guid(), ids: orderedIds });

export class Subcategory {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreateSubcategoryRequest {
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ minLength: 1, maxLength: 40, description: 'Unique per category, case-insensitive.' }) name!: string;
  @ApiPropertyOptional({ description: 'Omitted: after the last subcategory of the category.' }) sortOrder?: number;
  @ApiPropertyOptional({ description: 'Omitted: true.' }) active?: boolean;
}

export class UpdateSubcategoryRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 }) name?: string;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional() active?: boolean;
}

export class SubcategoryOrderRequest {
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ type: [String], description: 'Subcategory ids of the category in order; position i gets sortOrder i.' })
  ids!: string[];
}

// ---- Dishes -----------------------------------------------------------------

export const DISH_MESSAGES = {
  otherCategory: 'La subcategoría no pertenece a la categoría del plato',
  noCategory: 'Un plato sin categoría no puede tener subcategoría',
  move: 'El plato está en una subcategoría de su categoría actual; elige una subcategoría de la nueva categoría o quítala',
} as const;

export const QUICK_NOTE_MESSAGES = {
  tooMany: 'Máximo 12 notas rápidas',
  length: 'Cada nota rápida debe tener entre 1 y 30 caracteres',
  duplicate: 'Las notas rápidas no se pueden repetir',
} as const;
export const QUICK_NOTES_MAX = 12;
export const QUICK_NOTE_MAX_LENGTH = 30;

/** private.normalize_quick_note: trimmed, every inner run of whitespace one space. */
const normalizeQuickNote = (note: string) => note.trim().replace(/\s+/g, ' ');

/**
 * dishes.quick_notes as the 0015 CHECK sees it, with Spanish messages: at most
 * 12, each 1-30 characters once normalised, no duplicates ignoring case. The
 * stored value is the normalised one (the database trigger does the same).
 */
const quickNotes = z
  .array(z.string())
  .max(QUICK_NOTES_MAX, QUICK_NOTE_MESSAGES.tooMany)
  .transform((notes) => notes.map(normalizeQuickNote))
  .refine((notes) => notes.every((note) => [...note].length >= 1 && [...note].length <= QUICK_NOTE_MAX_LENGTH), QUICK_NOTE_MESSAGES.length)
  .refine((notes) => new Set(notes.map((note) => note.toLowerCase())).size === notes.length, QUICK_NOTE_MESSAGES.duplicate);

export const dishListQuerySchema = z.strictObject({
  categoryId: z.guid().optional(),
  subcategoryId: z.guid().optional(),
  active: booleanQuery.optional(),
  pricing: z.enum(['promotions']).optional(),
});

export const createDishSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText.optional(),
  price: money,
  categoryId: z.guid().nullable().optional(),
  subcategoryId: z.guid().nullable().optional(),
  imageUrl: nullableText.optional(),
  active: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  quickNotes: quickNotes.optional(),
});
export const updateDishSchema = createDishSchema.partial();

/** A dish group is (categoryId, subcategoryId); null categoryId is the dishes without category. */
export const dishOrderSchema = z.strictObject({
  categoryId: z.guid().nullable(),
  subcategoryId: z.guid().nullable(),
  ids: orderedIds,
});

export class Dish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Price after the best active promotion when pricing=promotions applied one.' })
  price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'A subcategory of categoryId, or null.' })
  subcategoryId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Opaque image reference.' }) imageUrl!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() allowComments!: boolean;
  @ApiProperty({ description: 'Order inside its (category, subcategory) group; the menu tree lists by sortOrder, then name.' })
  sortOrder!: number;
  @ApiProperty({ type: [String], description: 'Modifier chips offered when the dish is added (append to the item comment, no price).' })
  quickNotes!: string[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiPropertyOptional({ description: 'Only when a promotion applies (pricing=promotions).' }) originalPrice?: number;
  @ApiPropertyOptional({ description: 'Only when a promotion applies.' }) discountAmount?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Only when a promotion applies; null for fixed amounts.' })
  discountPercentage?: number | null;
  @ApiPropertyOptional({ format: 'uuid', description: 'Only when a promotion applies.' }) promotionId?: string;
  @ApiPropertyOptional({ description: 'Only when a promotion applies.' }) promotionName?: string;
}

export class CreateDishRequest {
  @ApiProperty({ maxLength: 100 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ minimum: 0 }) price!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'A subcategory of the dish category. Changing categoryId of a dish in a subcategory needs a new subcategoryId or null.',
  })
  subcategoryId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl?: string | null;
  @ApiPropertyOptional({ default: true }) active?: boolean;
  @ApiPropertyOptional({ default: false }) allowComments?: boolean;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 12,
    description: 'At most 12, each 1-30 characters after trimming and collapsing spaces, no duplicates ignoring case (422 in Spanish).',
  })
  quickNotes?: string[];
}

export class UpdateDishRequest {
  @ApiPropertyOptional({ maxLength: 100 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ minimum: 0 }) price?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'A subcategory of the dish category. Changing categoryId of a dish in a subcategory needs a new subcategoryId or null.',
  })
  subcategoryId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl?: string | null;
  @ApiPropertyOptional() active?: boolean;
  @ApiPropertyOptional() allowComments?: boolean;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 12,
    description: 'At most 12, each 1-30 characters after trimming and collapsing spaces, no duplicates ignoring case (422 in Spanish).',
  })
  quickNotes?: string[];
}

export class DishOrderRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null: the dishes without category.' }) categoryId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) subcategoryId!: string | null;
  @ApiProperty({ type: [String], description: 'Dish ids of the group in order; position i gets sortOrder i. Ids left out keep theirs.' })
  ids!: string[];
}

// ---- Menu tree ----------------------------------------------------------------

export class MenuTreeDish extends Dish {
  @ApiProperty({ description: 'One portion is in stock (the check_dishes_stock rule); always true with inventory control off.' })
  available!: boolean;
}

export class MenuTreeCategory extends Category {
  @ApiProperty({ type: [Subcategory], description: 'Active subcategories by sortOrder, then name.' })
  subcategories!: Subcategory[];
  @ApiProperty({
    type: [MenuTreeDish],
    description:
      'Active dishes by sortOrder, then name, priced with the promotions active now; dishes of an inactive subcategory are left out.',
  })
  dishes!: MenuTreeDish[];
}

export class MenuTree {
  @ApiProperty({ type: [MenuTreeCategory], description: 'Active categories by sortOrder, then name.' })
  categories!: MenuTreeCategory[];
  @ApiProperty({
    type: [MenuTreeDish],
    description: 'Active dishes without category ("Otros"), by sortOrder, then name, priced and with availability.',
  })
  uncategorized!: MenuTreeDish[];
}

export const MENU_MESSAGES = {
  publishForbidden: 'Solo un administrador puede publicar el menú',
} as const;

export class MenuPublicationStatus {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Latest publication; null: never published (the live menu is served).' })
  publishedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Name of the admin who published; null for the deploy backfill or a deleted profile.' })
  publishedByName!: string | null;
  @ApiProperty({ description: 'Categories, subcategories and dishes added, removed or changed in structure since then; 0 with no publication.' })
  pendingChanges!: number;
}

// ---- Promotions -------------------------------------------------------------

export const DISCOUNT_TYPES = ['percentage', 'fixed_amount'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const createPromotionSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  description: nullableText.optional(),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: money,
  startDate: dateString,
  endDate: dateString,
  active: z.boolean().optional(),
});
export const updatePromotionSchema = createPromotionSchema.partial();

export const promotionDishesSchema = z.strictObject({ dishIds: z.array(z.guid()).max(1000) });

export class Promotion {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: DISCOUNT_TYPES }) discountType!: DiscountType;
  @ApiProperty() discountValue!: number;
  @ApiProperty({ format: 'date-time' }) startDate!: string;
  @ApiProperty({ format: 'date-time' }) endDate!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreatePromotionRequest {
  @ApiProperty({ maxLength: 255 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ enum: DISCOUNT_TYPES }) discountType!: DiscountType;
  @ApiProperty({ minimum: 0 }) discountValue!: number;
  @ApiProperty({ format: 'date-time' }) startDate!: string;
  @ApiProperty({ format: 'date-time' }) endDate!: string;
  @ApiPropertyOptional({ default: true }) active?: boolean;
}

export class UpdatePromotionRequest {
  @ApiPropertyOptional({ maxLength: 255 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ enum: DISCOUNT_TYPES }) discountType?: DiscountType;
  @ApiPropertyOptional({ minimum: 0 }) discountValue?: number;
  @ApiPropertyOptional({ format: 'date-time' }) startDate?: string;
  @ApiPropertyOptional({ format: 'date-time' }) endDate?: string;
  @ApiPropertyOptional() active?: boolean;
}

export class SetPromotionDishesRequest {
  @ApiProperty({ type: [String], description: 'The complete dish set; replaces the previous one.' })
  dishIds!: string[];
}
