import type { schema } from '@vipe/db';
import { toIso } from '../common/validation';
import type { Category, CategoryColor, DiscountType, Dish, Promotion } from './catalog.dto';
import type { DishModifierGroup } from './modifiers.dto';

type CategoryRow = typeof schema.categories.$inferSelect;
type DishRow = typeof schema.dishes.$inferSelect;
type PromotionRow = typeof schema.promotions.$inferSelect;

/** `hasSubcategories` is derived from the dishes (see CategoriesService). */
export const toCategory = (row: CategoryRow, hasSubcategories: boolean): Category => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  active: row.active,
  sortOrder: row.sortOrder,
  color: row.color as CategoryColor,
  hasSubcategories,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

/** `modifierGroups` comes from ModifiersService.groupsForDishes. */
export const toDish = (row: DishRow, modifierGroups: DishModifierGroup[] = []): Dish => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: Number(row.price),
  categoryId: row.categoryId,
  subcategoryId: row.subcategoryId,
  imageUrl: row.imageUrl,
  active: row.active,
  allowComments: row.allowComments,
  sortOrder: row.sortOrder,
  modifierGroups,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

export const toPromotion = (row: PromotionRow): Promotion => ({
  id: row.id,
  name: row.name,
  description: row.description,
  discountType: row.discountType as DiscountType,
  discountValue: Number(row.discountValue),
  startDate: toIso(row.startDate),
  // end_date is nullable since 0027; this API still always writes it (T3 widens the DTO).
  endDate: toIso(row.endDate as string),
  // Nullable in the schema; the web always treated a missing flag as inactive.
  active: row.active === true,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});
