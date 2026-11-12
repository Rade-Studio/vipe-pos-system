import type { schema } from '@vipe/db';
import { toIso } from '../common/validation';
import type { Category, CategoryColor, Dish } from './catalog.dto';
import type { DishModifierGroup } from './modifiers.dto';

type CategoryRow = typeof schema.categories.$inferSelect;
type DishRow = typeof schema.dishes.$inferSelect;

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
