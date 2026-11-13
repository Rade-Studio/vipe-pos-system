import type { Category, Dish, Subcategory } from './catalog.dto';

/** menu_publications.snapshot, the shape of private.menu_structure() (migration 0015). */
export interface MenuSnapshot {
  categories: Record<string, { name: string; icon: string; color: string; sort_order: number; active: boolean }>;
  subcategories: Record<string, { category_id: string; name: string; sort_order: number; active: boolean }>;
  dishes: Record<string, { name: string; category_id: string | null; subcategory_id: string | null; sort_order: number }>;
}

/** The order channel the promotion fields of the dishes are computed for. */
export type MenuChannel = 'dine_in' | 'takeaway' | 'delivery';

/**
 * The rows MenuService builds the menu tree from, for one restaurant. The
 * staff source reads them under RLS through the request unit of work; the
 * public carta (L12 option D) reads them from private.guest_menu_data on the
 * pool. Both hand over unfiltered rows: the tree's rules (active flags,
 * publication, promotion schedule) are applied by MenuService alone.
 */
export interface MenuDataSource {
  /** The latest publication, null when never published. */
  snapshot(): Promise<MenuSnapshot | null>;
  /** Every category (inactive included), in menu order, with hasSubcategories. */
  categories(): Promise<Category[]>;
  /** Every subcategory (inactive included), in menu order. */
  subcategories(): Promise<Subcategory[]>;
  /** The active dishes by name with their modifier groups, priced as DishesService.list with `pricing: 'promotions'`. */
  dishes(channel: MenuChannel): Promise<Dish[]>;
  /** Every dish id, active or not. */
  liveDishIds(): Promise<Set<string>>;
  /** One portion in stock per dish id (SalesService.availability); unknown ids left out. */
  availability(dishIds: string[]): Promise<Record<string, boolean>>;
}
