import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';

const isDate = (value: string) => !Number.isNaN(Date.parse(value));
const dateString = z.string().refine(isDate, 'Invalid date');
const nullableText = z.string().nullable();
/** numeric(10,2) columns. */
const money = z.number().min(0).max(99_999_999.99);

// ---- Categories -------------------------------------------------------------

export const categoryListQuerySchema = z.strictObject({ active: booleanQuery.optional() });

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText.optional(),
  icon: z.string().trim().min(1).max(50),
  active: z.boolean().optional(),
});
export const updateCategorySchema = createCategorySchema.partial();

export class Category {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() icon!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreateCategoryRequest {
  @ApiProperty({ maxLength: 100 }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiProperty({ maxLength: 50 }) icon!: string;
  @ApiPropertyOptional({ default: true }) active?: boolean;
}

export class UpdateCategoryRequest {
  @ApiPropertyOptional({ maxLength: 100 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ maxLength: 50 }) icon?: string;
  @ApiPropertyOptional() active?: boolean;
}

// ---- Dishes -----------------------------------------------------------------

export const dishListQuerySchema = z.strictObject({
  categoryId: z.guid().optional(),
  active: booleanQuery.optional(),
  pricing: z.enum(['promotions']).optional(),
});

export const createDishSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: nullableText.optional(),
  price: money,
  categoryId: z.guid().nullable().optional(),
  imageUrl: nullableText.optional(),
  active: z.boolean().optional(),
  allowComments: z.boolean().optional(),
});
export const updateDishSchema = createDishSchema.partial();

export class Dish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Price after the best active promotion when pricing=promotions applied one.' })
  price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Opaque image reference.' }) imageUrl!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() allowComments!: boolean;
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
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl?: string | null;
  @ApiPropertyOptional({ default: true }) active?: boolean;
  @ApiPropertyOptional({ default: false }) allowComments?: boolean;
}

export class UpdateDishRequest {
  @ApiPropertyOptional({ maxLength: 100 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ minimum: 0 }) price?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl?: string | null;
  @ApiPropertyOptional() active?: boolean;
  @ApiPropertyOptional() allowComments?: boolean;
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
