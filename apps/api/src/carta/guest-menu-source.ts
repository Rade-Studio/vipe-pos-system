import type { schema } from '@vipe/db';
import type { CategoryColor, Subcategory } from '../catalog/catalog.dto';
import { toCategory, toDish } from '../catalog/catalog.mappers';
import { priceWithPromotions } from '../catalog/dishes.service';
import type { MenuDataSource, MenuSnapshot } from '../catalog/menu-data-source';
import { dishGroupsFromRows } from '../catalog/modifiers.service';
import { type PromotionJson, type RestaurantNow, toRecord } from '../promotions/promotion-catalog.service';

/** private.guest_menu_data(slug) (0034), as pg parses the jsonb. */
export interface GuestMenuData {
  snapshot: MenuSnapshot | null;
  categories: {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    active: boolean;
    sortOrder: number;
    color: string;
    hasSubcategories: boolean;
  }[];
  subcategories: { id: string; category_id: string; name: string; sort_order: number; active: boolean }[];
  dishes: {
    id: string;
    name: string;
    description: string | null;
    price: number | string;
    categoryId: string | null;
    subcategoryId: string | null;
    imageUrl: string | null;
    active: boolean;
    allowComments: boolean;
    sortOrder: number;
  }[];
  liveDishIds: string[];
  availability: Record<string, boolean>;
  modifierLinks: { dish_id: string; row: Record<string, unknown> }[];
  promotions: PromotionJson[];
  details: { dishId: string; tags: string[]; descriptionEn: string | null; descriptionEnReviewed: boolean }[];
  mostOrdered: string[];
}

type CategoryRow = typeof schema.categories.$inferSelect;
type DishRow = typeof schema.dishes.$inferSelect;

/**
 * The staff menu's rows for one published restaurant, from its guest rows:
 * mapped into the shapes the shared code reads (toCategory, toDish, the
 * modifier mapping, PromotionCatalog's toRecord) and priced with the staff
 * rule at `now`. Nothing is filtered here: MenuService drops inactive
 * categories and dishes, and the promotion schedule drops non-current
 * promotions, as for staff (A4). Timestamps are not carried (the carta never
 * returns them).
 */
export function guestMenuSource(data: GuestMenuData, now: RestaurantNow): MenuDataSource {
  return {
    snapshot: () => Promise.resolve(data.snapshot),
    categories: () =>
      Promise.resolve(
        data.categories.map((row) =>
          toCategory(
            {
              id: row.id,
              name: row.name,
              description: row.description,
              icon: row.icon,
              active: row.active,
              sortOrder: row.sortOrder,
              color: row.color as CategoryColor,
              createdAt: null,
              updatedAt: null,
            } as CategoryRow,
            row.hasSubcategories,
          ),
        ),
      ),
    subcategories: () =>
      Promise.resolve(
        data.subcategories.map(
          (row): Subcategory => ({
            id: row.id,
            categoryId: row.category_id,
            name: row.name,
            sortOrder: row.sort_order,
            active: row.active,
            createdAt: null,
            updatedAt: null,
          }),
        ),
      ),
    dishes: (channel) => {
      const groups = dishGroupsFromRows(
        data.dishes.map((row) => row.id),
        data.modifierLinks,
      );
      const list = data.dishes.map((row) =>
        toDish(
          {
            id: row.id,
            name: row.name,
            description: row.description,
            price: String(row.price),
            categoryId: row.categoryId,
            subcategoryId: row.subcategoryId,
            imageUrl: row.imageUrl,
            active: row.active,
            allowComments: row.allowComments,
            sortOrder: row.sortOrder,
            createdAt: null,
            updatedAt: null,
          } as DishRow,
          groups.get(row.id),
        ),
      );
      const rules = data.promotions.map((row) => toRecord(row).rule);
      return priceWithPromotions(list, rules, () => Promise.resolve(now), channel);
    },
    liveDishIds: () => Promise.resolve(new Set(data.liveDishIds)),
    availability: (dishIds) => Promise.resolve(Object.fromEntries(dishIds.flatMap((id) => (id in data.availability ? [[id, data.availability[id]]] : [])))),
  };
}
