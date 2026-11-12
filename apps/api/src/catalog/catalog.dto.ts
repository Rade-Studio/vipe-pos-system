import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';
import { DishModifierGroup } from './modifiers.dto';

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

export const dishListQuerySchema = z.strictObject({
  categoryId: z.guid().optional(),
  subcategoryId: z.guid().optional(),
  active: booleanQuery.optional(),
  pricing: z.enum(['promotions']).optional(),
  /** With pricing=promotions: the order channel the promotion fields are computed for. */
  channel: z.enum(['dine_in', 'delivery']).optional(),
});

export const menuTreeQuerySchema = z.strictObject({ channel: z.enum(['dine_in', 'delivery']).optional() });

export const createDishSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText.optional(),
  price: money,
  categoryId: z.guid().nullable().optional(),
  subcategoryId: z.guid().nullable().optional(),
  imageUrl: nullableText.optional(),
  active: z.boolean().optional(),
  allowComments: z.boolean().optional(),
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
  @ApiProperty({ description: 'List price; never rewritten by a promotion (S2). Send it, plus the options, as unitPrice.' })
  price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'A subcategory of categoryId, or null.' })
  subcategoryId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Opaque image reference.' }) imageUrl!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() allowComments!: boolean;
  @ApiProperty({ description: 'Order inside its (category, subcategory) group; the menu tree lists by sortOrder, then name.' })
  sortOrder!: number;
  @ApiProperty({
    type: [DishModifierGroup],
    description: 'Active modifier groups the dish offers, in order, with their active options and live prices (F7). Assigned with PUT /catalog/dishes/{id}/modifier-groups.',
  })
  modifierGroups!: DishModifierGroup[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'pricing=promotions: the automatic product_discount or buy_x_pay_y promotion a line of this dish would be sent with now on the channel.',
  })
  promotionId?: string;
  @ApiPropertyOptional({ description: 'Only with promotionId.' }) promotionName?: string;
  @ApiPropertyOptional({ example: '2x1', description: 'Only with promotionId: 2x1, 3x2, 20%, -$3.000.' }) promotionBadge?: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '19:00', description: 'Only with promotionId: end of the current window (restaurant time); null = all day.' })
  promotionEndsAt?: string | null;
  @ApiPropertyOptional({ description: 'Only for a product_discount: the unit price after the discount (the discount itself is an order line).' })
  promoPrice?: number;
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
      'Active dishes by sortOrder, then name, at list price with the promotion a line would be sent with now (channel query); dishes of an inactive subcategory are left out.',
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
export const PROMOTION_KINDS = ['product_discount', 'buy_x_pay_y', 'combo', 'bill_discount'] as const;
export type PromotionKindValue = (typeof PROMOTION_KINDS)[number];
export const PROMOTION_MODES = ['automatic', 'manual', 'manual_pin'] as const;
/** promotions_channels_check: dine_in (Salón) and delivery (Domicilio) are the order types today; takeaway is accepted for later. */
export const PROMOTION_CHANNEL_VALUES = ['dine_in', 'takeaway', 'delivery'] as const;
/** The channels an order has today (orders.order_type). */
export const ORDER_CHANNELS = ['dine_in', 'delivery'] as const;
export const SCHEDULE_REASONS = ['active', 'paused', 'not_started', 'ended', 'other_day', 'outside_hours', 'manual'] as const;
export const TODAY_OTHER_REASONS = ['other_day', 'outside_hours', 'other_channel', 'manual', 'not_started'] as const;

/**
 * Machine codes of a rejected promotion body (422 `code`, and `<path>: <code>` in `message`).
 * The admin editor (T6) maps them to Spanish next to the field.
 */
export const PROMOTION_ERROR_CODES = [
  'promotion_invalid',
  'discount_required',
  'discount_percentage_range',
  'buy_quantity_invalid',
  'pay_quantity_invalid',
  'rest_discount_invalid',
  'combo_price_invalid',
  'combo_groups_count',
  'combo_group_empty',
  'min_subtotal_invalid',
  'max_discount_invalid',
  'time_window_invalid',
  'days_of_week_invalid',
  'channels_invalid',
  'max_uses_invalid',
  'end_before_start',
  'unknown_target',
] as const;
export type PromotionErrorCode = (typeof PROMOTION_ERROR_CODES)[number];

const code = (value: PromotionErrorCode) => ({ error: value });
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const guids = z.array(z.guid(code('promotion_invalid')), code('promotion_invalid')).max(1000, code('promotion_invalid'));
const optionalMoney = z.number(code('promotion_invalid')).min(0, code('promotion_invalid')).max(99_999_999.99, code('promotion_invalid'));

const promotionFields = {
  name: z.string(code('promotion_invalid')).trim().min(1, code('promotion_invalid')).max(255, code('promotion_invalid')),
  description: z.string(code('promotion_invalid')).nullable().optional(),
  kind: z.enum(PROMOTION_KINDS, code('promotion_invalid')),
  mode: z.enum(PROMOTION_MODES, code('promotion_invalid')),
  discountType: z.enum(DISCOUNT_TYPES, code('promotion_invalid')).nullable(),
  discountValue: optionalMoney.nullable(),
  buyQuantity: z.number(code('buy_quantity_invalid')).int(code('buy_quantity_invalid')).nullable(),
  payQuantity: z.number(code('pay_quantity_invalid')).int(code('pay_quantity_invalid')).nullable(),
  restDiscountPercent: z.number(code('rest_discount_invalid')).int(code('rest_discount_invalid')).nullable(),
  comboPrice: optionalMoney.nullable(),
  comboGroups: z
    .array(
      z.strictObject(
        {
          id: z.guid(code('promotion_invalid')).optional(),
          name: z.string(code('combo_group_empty')).trim().min(1, code('combo_group_empty')).max(60, code('combo_group_empty')),
          dishIds: guids,
        },
        code('promotion_invalid'),
      ),
      code('promotion_invalid'),
    )
    .max(6, code('combo_groups_count')),
  minSubtotal: optionalMoney.nullable(),
  maxDiscount: optionalMoney.nullable(),
  startDate: dateString,
  endDate: dateString.nullable(),
  daysOfWeek: z.array(z.number(code('days_of_week_invalid')).int(code('days_of_week_invalid')).min(1, code('days_of_week_invalid')).max(7, code('days_of_week_invalid')), code('days_of_week_invalid')).max(7, code('days_of_week_invalid')),
  timeWindows: z
    .array(z.strictObject({ from: z.string(code('time_window_invalid')).regex(CLOCK, code('time_window_invalid')), to: z.string(code('time_window_invalid')).regex(CLOCK, code('time_window_invalid')) }, code('time_window_invalid')), code('time_window_invalid'))
    .max(6, code('time_window_invalid')),
  channels: z.array(z.enum(PROMOTION_CHANNEL_VALUES, code('channels_invalid')), code('channels_invalid')).max(3, code('channels_invalid')),
  maxUsesPerOrder: z.number(code('max_uses_invalid')).int(code('max_uses_invalid')).min(1, code('max_uses_invalid')).max(999, code('max_uses_invalid')).nullable(),
  active: z.boolean(code('promotion_invalid')),
  targets: z.strictObject({ dishIds: guids, categoryIds: guids, subcategoryIds: guids }, code('promotion_invalid')),
};

/** The body of POST and PATCH; omitted keys keep the defaults (create) or the stored value (update). */
export const promotionBodySchema = z.strictObject(
  Object.fromEntries(Object.entries(promotionFields).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof promotionFields]: z.ZodOptional<(typeof promotionFields)[K]>;
  },
  code('promotion_invalid'),
);
export type PromotionBody = z.infer<typeof promotionBodySchema>;

/** A complete promotion as stored, checked per kind (S1); fields of other kinds are ignored and stored as null. */
export const promotionShapeSchema = z
  .strictObject({ ...promotionFields, description: z.string().nullable() })
  .superRefine((p, ctx) => {
    const fail = (path: string, error: PromotionErrorCode) => ctx.addIssue({ code: 'custom', path: [path], message: error });
    if (p.kind === 'product_discount' || p.kind === 'bill_discount') {
      if (p.discountType === null || p.discountValue === null) fail('discountValue', 'discount_required');
      else if (p.discountType === 'percentage' && (p.discountValue <= 0 || p.discountValue > 100)) fail('discountValue', 'discount_percentage_range');
    }
    if (p.kind === 'buy_x_pay_y') {
      if (p.buyQuantity === null || p.buyQuantity < 2 || p.buyQuantity > 99) fail('buyQuantity', 'buy_quantity_invalid');
      if (p.payQuantity === null || p.payQuantity < 1 || (p.buyQuantity !== null && p.payQuantity >= p.buyQuantity)) fail('payQuantity', 'pay_quantity_invalid');
      if (p.restDiscountPercent === null || p.restDiscountPercent < 1 || p.restDiscountPercent > 100) fail('restDiscountPercent', 'rest_discount_invalid');
    }
    if (p.kind === 'combo') {
      if (p.comboPrice === null || p.comboPrice <= 0) fail('comboPrice', 'combo_price_invalid');
      if (p.comboGroups.length < 1 || p.comboGroups.length > 6) fail('comboGroups', 'combo_groups_count');
      p.comboGroups.forEach((group, index) => {
        if (group.dishIds.length === 0) ctx.addIssue({ code: 'custom', path: ['comboGroups', index, 'dishIds'], message: 'combo_group_empty' });
      });
    }
    if (p.kind === 'bill_discount' && p.maxDiscount !== null && p.maxDiscount <= 0) fail('maxDiscount', 'max_discount_invalid');
    if (new Set(p.daysOfWeek).size !== p.daysOfWeek.length) fail('daysOfWeek', 'days_of_week_invalid');
    if (new Set(p.channels).size !== p.channels.length) fail('channels', 'channels_invalid');
    p.timeWindows.forEach((window, index) => {
      if (window.from >= window.to) ctx.addIssue({ code: 'custom', path: ['timeWindows', index], message: 'time_window_invalid' });
    });
    if (p.endDate !== null && Date.parse(p.endDate) < Date.parse(p.startDate)) fail('endDate', 'end_before_start');
  });
export type PromotionShape = z.infer<typeof promotionShapeSchema>;

export const promotionDishesSchema = z.strictObject({ dishIds: z.array(z.guid()).max(1000) });

export const promotionsTodayQuerySchema = z.strictObject({ channel: z.enum(ORDER_CHANNELS).default('dine_in') });

export class TimeWindowDto {
  @ApiProperty({ example: '17:00', description: 'HH:MM, inclusive.' }) from!: string;
  @ApiProperty({ example: '19:00', description: 'HH:MM, exclusive; from < to.' }) to!: string;
}

export class ComboGroupDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 60, example: 'Sopa' }) name!: string;
  @ApiProperty({ type: [String], description: 'Dishes the customer can pick in this group (exactly one).' }) dishIds!: string[];
}

export class ComboGroupInput {
  @ApiPropertyOptional({ format: 'uuid', description: 'Ignored on write: the groups are replaced as a whole and get new ids.' }) id?: string;
  @ApiProperty({ maxLength: 60 }) name!: string;
  @ApiProperty({ type: [String], minItems: 1 }) dishIds!: string[];
}

export class PromotionTargetsDto {
  @ApiProperty({ type: [String] }) dishIds!: string[];
  @ApiProperty({ type: [String] }) categoryIds!: string[];
  @ApiProperty({ type: [String] }) subcategoryIds!: string[];
}

export class PromotionStats {
  @ApiProperty({ description: 'Distinct non-cancelled orders of the last 30 days with a discount of this promotion.' }) usesLast30Days!: number;
  @ApiProperty({ description: 'Sum of those discounts, whole pesos.' }) discountLast30Days!: number;
}

export class PromotionSchedule {
  @ApiProperty({ description: 'Applies by itself right now (automatic, active, in dates, day and window); channels are not considered.' })
  activeNow!: boolean;
  @ApiProperty({ enum: SCHEDULE_REASONS }) reason!: (typeof SCHEDULE_REASONS)[number];
  @ApiProperty({ type: String, nullable: true, example: '19:00', description: 'End of the current window (restaurant time); null when all day or not active.' })
  endsAt!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '17:00', description: 'Start of the next window later today, when outside hours.' })
  nextStartToday!: string | null;
}

const KIND_DESCRIPTION =
  'product_discount: discountType/discountValue per unit on the targets. buy_x_pay_y: buyQuantity N >= 2, payQuantity 1 <= M < N, restDiscountPercent 1-100 (100 = free) on the targets. combo: comboPrice > 0 and 1-6 comboGroups. bill_discount: discountType/discountValue on the bill, optional minSubtotal and maxDiscount. Fields of other kinds are stored as null.';
const ERRORS_DESCRIPTION = `422 with \`code\` one of ${PROMOTION_ERROR_CODES.join(', ')}; \`message\` lists \`<field>: <code>\`. Nothing is saved.`;

export class Promotion {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: PROMOTION_KINDS, description: KIND_DESCRIPTION }) kind!: PromotionKindValue;
  @ApiProperty({ enum: PROMOTION_MODES, description: 'automatic applies by itself when items are sent; manual modes never do (the cashier applies them).' })
  mode!: (typeof PROMOTION_MODES)[number];
  @ApiProperty({ enum: DISCOUNT_TYPES, nullable: true }) discountType!: DiscountType | null;
  @ApiProperty({ type: Number, nullable: true }) discountValue!: number | null;
  @ApiProperty({ type: Number, nullable: true }) buyQuantity!: number | null;
  @ApiProperty({ type: Number, nullable: true }) payQuantity!: number | null;
  @ApiProperty({ type: Number, nullable: true }) restDiscountPercent!: number | null;
  @ApiProperty({ type: Number, nullable: true }) comboPrice!: number | null;
  @ApiProperty({ type: [ComboGroupDto], description: 'In order; empty unless combo.' }) comboGroups!: ComboGroupDto[];
  @ApiProperty({ type: Number, nullable: true }) minSubtotal!: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxDiscount!: number | null;
  @ApiProperty({ format: 'date-time' }) startDate!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'null = no end.' }) endDate!: string | null;
  @ApiProperty({ type: [Number], description: 'ISO 1 = Monday … 7 = Sunday; empty = every day.' }) daysOfWeek!: number[];
  @ApiProperty({ type: [TimeWindowDto], description: 'Restaurant time; empty = all day.' }) timeWindows!: TimeWindowDto[];
  @ApiProperty({ enum: PROMOTION_CHANNEL_VALUES, isArray: true, description: 'Empty = every channel.' }) channels!: string[];
  @ApiProperty({ type: Number, nullable: true }) maxUsesPerOrder!: number | null;
  @ApiProperty({ description: 'false = "Pausada".' }) active!: boolean;
  @ApiProperty({ type: PromotionTargetsDto, description: 'product_discount and buy_x_pay_y: a dish matches if listed or in a listed category/subcategory.' })
  targets!: PromotionTargetsDto;
  @ApiProperty({ type: PromotionStats }) stats!: PromotionStats;
  @ApiProperty({ type: PromotionSchedule, description: 'Computed now (server clock, restaurant timezone).' }) schedule!: PromotionSchedule;
  @ApiProperty({ example: 'Lleva 2 cócteles y paga 1; sale gratis el más económico.', description: 'The rule in Spanish.' }) sentence!: string;
  @ApiProperty({ example: '2x1', description: 'Short label: 2x1, 3x2, 20%, -$3.000, Combo, 10%.' }) badge!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreatePromotionRequest {
  @ApiProperty({ maxLength: 255 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ enum: PROMOTION_KINDS, default: 'product_discount', description: KIND_DESCRIPTION }) kind?: PromotionKindValue;
  @ApiPropertyOptional({ enum: PROMOTION_MODES, default: 'automatic' }) mode?: (typeof PROMOTION_MODES)[number];
  @ApiPropertyOptional({ enum: DISCOUNT_TYPES, nullable: true }) discountType?: DiscountType | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, description: 'percentage: 0 < v <= 100.' }) discountValue?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 2 }) buyQuantity?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 }) payQuantity?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 100, default: 100 }) restDiscountPercent?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) comboPrice?: number | null;
  @ApiPropertyOptional({ type: [ComboGroupInput], maxItems: 6, description: 'Replaces every group (new ids).' }) comboGroups?: ComboGroupInput[];
  @ApiPropertyOptional({ type: Number, nullable: true }) minSubtotal?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxDiscount?: number | null;
  @ApiPropertyOptional({ description: 'date-time, or YYYY-MM-DD = the start of that day in the restaurant timezone. Default: now.' }) startDate?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'date-time, or YYYY-MM-DD = the end of that day in the restaurant timezone; null = no end.' })
  endDate?: string | null;
  @ApiPropertyOptional({ type: [Number] }) daysOfWeek?: number[];
  @ApiPropertyOptional({ type: [TimeWindowDto], maxItems: 6 }) timeWindows?: TimeWindowDto[];
  @ApiPropertyOptional({ enum: PROMOTION_CHANNEL_VALUES, isArray: true }) channels?: string[];
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 }) maxUsesPerOrder?: number | null;
  @ApiPropertyOptional({ default: true }) active?: boolean;
  @ApiPropertyOptional({ type: PromotionTargetsDto, description: 'Replaces every target when sent. PUT :id/dishes still replaces only the dish targets.' })
  targets?: PromotionTargetsDto;
}

/** Same fields, all optional; the merged result is validated as a whole. */
export class UpdatePromotionRequest extends CreatePromotionRequest {
  @ApiPropertyOptional({ maxLength: 255 }) declare name: string;
}

export const PROMOTION_ERRORS_DESCRIPTION = ERRORS_DESCRIPTION;

export class SetPromotionDishesRequest {
  @ApiProperty({ type: [String], description: 'The complete dish set; replaces the previous one.' })
  dishIds!: string[];
}

export class TodayActivePromotion {
  @ApiProperty({ type: Promotion }) promotion!: Promotion;
  @ApiProperty() sentence!: string;
  @ApiProperty() badge!: string;
  @ApiProperty({ type: String, nullable: true, example: '19:00', description: 'End of the current window; null = until the end of the day.' })
  endsAt!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Minutes until endsAt.' }) minutesLeft!: number | null;
}

export class TodayLaterPromotion {
  @ApiProperty({ type: Promotion }) promotion!: Promotion;
  @ApiProperty() sentence!: string;
  @ApiProperty() badge!: string;
  @ApiProperty({ example: '17:00' }) startsAt!: string;
  @ApiProperty() minutesUntilStart!: number;
}

export class TodayOtherPromotion {
  @ApiProperty({ type: Promotion }) promotion!: Promotion;
  @ApiProperty() sentence!: string;
  @ApiProperty() badge!: string;
  @ApiProperty({ enum: TODAY_OTHER_REASONS, description: 'Why it does not apply now on this channel.' }) reason!: (typeof TODAY_OTHER_REASONS)[number];
}

export class PromotionsToday {
  @ApiProperty({ format: 'date-time' }) now!: string;
  @ApiProperty({ example: '18:05', description: 'Restaurant time.' }) localTime!: string;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel!: string;
  @ApiProperty({ type: [TodayActivePromotion], description: 'Automatic promotions applying now on the channel.' }) active!: TodayActivePromotion[];
  @ApiProperty({ type: [TodayLaterPromotion], description: 'Automatic promotions of the channel with a window later today.' }) laterToday!: TodayLaterPromotion[];
  @ApiProperty({ type: [TodayOtherPromotion], description: 'The rest that is neither paused nor ended.' }) others!: TodayOtherPromotion[];
}
