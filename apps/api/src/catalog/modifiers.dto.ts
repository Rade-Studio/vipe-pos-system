import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';

/** numeric(10,2), as the dish price. */
const money = z.number().min(0).max(99_999_999.99);
const sortOrder = z.number().int().min(-100_000).max(100_000);
const name = z.string().trim().min(1).max(60);
const selectCount = z.number().int().min(0).max(50);

export const MODIFIER_MESSAGES = {
  duplicateGroup: 'Ya existe un grupo de modificadores con ese nombre',
  duplicateOption: 'Ya existe una opción con ese nombre en el grupo',
  required: 'Un grupo obligatorio pide al menos una opción y uno opcional ninguna',
  minMax: 'El máximo debe ser mayor o igual al mínimo',
  ingredient: 'El ingrediente y su cantidad van juntos',
  unknownIngredient: 'Ingrediente desconocido',
  unknownGroup: 'Grupo de modificadores desconocido',
} as const;

/** Codes of a 422 for the options of an order line (private.resolve_line_modifiers, 0023). */
export const MODIFIER_ERROR_CODES = ['modifier_invalid', 'modifier_inactive', 'modifier_duplicate', 'modifier_required', 'modifier_max'] as const;
export type ModifierErrorCode = (typeof MODIFIER_ERROR_CODES)[number];

export const modifierGroupListQuerySchema = z.strictObject({ includeInactive: booleanQuery.optional() });

/**
 * modifier_groups_select_check: required exactly when minSelect >= 1. Omitted,
 * each follows the other (required -> minSelect 1, minSelect >= 1 -> required).
 */
const groupFields = {
  name,
  required: z.boolean().optional(),
  minSelect: selectCount.optional(),
  maxSelect: z.number().int().min(1).max(50).nullable().optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
};
export const createModifierGroupSchema = z.strictObject(groupFields);
export const updateModifierGroupSchema = z.strictObject(groupFields).partial();

const optionFields = {
  name,
  price: money,
  ingredientId: z.guid().nullable().optional(),
  ingredientQty: z.number().gt(0).max(99_999_999_999.999).nullable().optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
};
export const createModifierOptionSchema = z.strictObject(optionFields);
export const updateModifierOptionSchema = z.strictObject(optionFields).partial();

export const dishModifierGroupsSchema = z.strictObject({
  groupIds: z.array(z.guid()).max(50).refine((ids) => new Set(ids).size === ids.length, 'Duplicate id'),
});

export class ModifierOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) groupId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Added to the unit price of the line (>= 0).' }) price!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Ingredient deducted per unit, with ingredientQty.' })
  ingredientId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) ingredientQty!: number | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
}

export class ModifierGroup {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'True exactly when minSelect >= 1: the line cannot be sent without it.' }) required!: boolean;
  @ApiProperty() minSelect!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null: no limit.' }) maxSelect!: number | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ type: [ModifierOption], description: 'By sortOrder, then name; only active ones unless includeInactive.' })
  options!: ModifierOption[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

/** A group as a dish offers it (Dish.modifierGroups): active, with its active options and live prices. */
export class DishModifierGroup {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() minSelect!: number;
  @ApiProperty({ type: Number, nullable: true }) maxSelect!: number | null;
  @ApiProperty({ type: [ModifierOption] }) options!: ModifierOption[];
}

export class CreateModifierGroupRequest {
  @ApiProperty({ minLength: 1, maxLength: 60, description: 'Unique per restaurant, case-insensitive (409).' }) name!: string;
  @ApiPropertyOptional({ description: 'Omitted: minSelect >= 1.' }) required?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 50, description: 'Omitted: 1 when required, else 0.' }) minSelect?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 50, description: 'null or omitted: no limit.' })
  maxSelect?: number | null;
  @ApiPropertyOptional({ description: 'Omitted: after the last group.' }) sortOrder?: number;
  @ApiPropertyOptional({ description: 'Omitted: true.' }) isActive?: boolean;
}

export class UpdateModifierGroupRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 }) name?: string;
  @ApiPropertyOptional() required?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 50 }) minSelect?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 50 }) maxSelect?: number | null;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional() isActive?: boolean;
}

export class CreateModifierOptionRequest {
  @ApiProperty({ minLength: 1, maxLength: 60, description: 'Unique per group, case-insensitive (409).' }) name!: string;
  @ApiProperty({ minimum: 0, description: '0 for a free option ("Sin cebolla").' }) price!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'An ingredient of the restaurant; set with ingredientQty.' })
  ingredientId?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: '> 0, in the ingredient unit, per unit of the line.' })
  ingredientQty?: number | null;
  @ApiPropertyOptional({ description: 'Omitted: after the last option of the group.' }) sortOrder?: number;
  @ApiPropertyOptional({ description: 'Omitted: true.' }) isActive?: boolean;
}

export class UpdateModifierOptionRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 }) name?: string;
  @ApiPropertyOptional({ minimum: 0 }) price?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) ingredientId?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) ingredientQty?: number | null;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional() isActive?: boolean;
}

export class DishModifierGroupsRequest {
  @ApiProperty({ type: [String], description: 'The complete group set of the dish, in order; replaces the previous one.' })
  groupIds!: string[];
}

export class DishModifierGroupIds {
  @ApiProperty({ type: [String], description: 'Groups assigned to the dish in order, inactive ones included.' })
  groupIds!: string[];
}

/** One chosen option of an order line (order_item_modifiers snapshot). */
export class OrderItemModifier {
  @ApiProperty({ format: 'uuid' }) groupId!: string;
  @ApiProperty() groupName!: string;
  @ApiProperty({ format: 'uuid' }) optionId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Already included in the line price.' }) price!: number;
}
