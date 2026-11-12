import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import { SalesService } from '../inventory/sales.service';
import {
  type Category,
  type CategoryColor,
  type Dish,
  MENU_MESSAGES,
  type MenuPublicationStatus,
  type MenuTree,
  type MenuTreeDish,
  type Subcategory,
} from './catalog.dto';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { SubcategoriesService } from './subcategories.service';

/** menu_publications.snapshot, the shape of private.menu_structure() (migration 0015). */
interface MenuSnapshot {
  categories: Record<string, { name: string; icon: string; color: string; sort_order: number; active: boolean }>;
  subcategories: Record<string, { category_id: string; name: string; sort_order: number; active: boolean }>;
  dishes: Record<string, { name: string; category_id: string | null; subcategory_id: string | null; sort_order: number }>;
}

/** The order channel the promotion fields of the dishes are computed for. */
type MenuChannel = 'dine_in' | 'takeaway' | 'delivery';

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

/** Stable: rows already in name order stay so among equal sortOrder. */
const bySortOrder = <T extends { sortOrder: number }>(rows: T[]) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * The waiter and delivery step picker's one read (S5, S3) and the admin menu
 * publication (T20, 0015 contract). Structure (order, names, colours, icons,
 * active flags of categories and subcategories, subcategory membership) comes
 * from the latest publication; price, dish availability (`active`), stock and
 * modifier groups are always live. A snapshot id gone live drops out; a live row
 * missing from the snapshot waits for the next publication; no publication
 * serves the live structure. Pricing and availability are the existing rules:
 * DishesService with `pricing: 'promotions'` and SalesService.availability.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly categories: CategoriesService,
    private readonly subcategories: SubcategoriesService,
    private readonly dishes: DishesService,
    private readonly sales: SalesService,
  ) {}

  /** What waiters and delivery see: the published structure. */
  async tree(channel: MenuChannel = 'dine_in'): Promise<MenuTree> {
    const [latest] = await this.rows<{ snapshot: MenuSnapshot }>(sql`
      SELECT snapshot FROM public.menu_publications ORDER BY published_at DESC, id DESC LIMIT 1`);
    return this.build(latest?.snapshot ?? null, channel);
  }

  /** The admin editor's preview: the live structure, what the next publication would serve. */
  draft(channel: MenuChannel = 'dine_in'): Promise<MenuTree> {
    return this.build(null, channel);
  }

  async status(): Promise<MenuPublicationStatus> {
    const [row] = await this.rows<{ published_at: Date | string | null; published_by_name: string | null; pending: number }>(sql`
      SELECT p.published_at, pr.full_name AS published_by_name,
             private.menu_pending_changes(p.snapshot, private.menu_structure(private.current_restaurant_id())) AS pending
        FROM (SELECT 1) one
        LEFT JOIN LATERAL (
          SELECT published_at, published_by, snapshot FROM public.menu_publications
           ORDER BY published_at DESC, id DESC LIMIT 1) p ON TRUE
        LEFT JOIN public.profiles pr ON pr.id = p.published_by`);
    return { publishedAt: iso(row.published_at), publishedByName: row.published_by_name, pendingChanges: Number(row.pending) };
  }

  /** public.publish_menu(): the insert policy lets only an admin publish (42501 otherwise). */
  async publish(): Promise<MenuPublicationStatus> {
    try {
      await this.rows(sql`SELECT id FROM public.publish_menu()`);
    } catch (error) {
      throw sqlState(error) === '42501' ? new ForbiddenException(MENU_MESSAGES.publishForbidden) : error;
    }
    return this.status();
  }

  private async build(snapshot: MenuSnapshot | null, channel: MenuChannel): Promise<MenuTree> {
    const categories = this.structureCategories(await this.categories.list(), snapshot, await this.liveDishIds(snapshot));
    const shownCategories = new Set(categories.map((category) => category.id));
    const subcategories = this.structureSubcategories(await this.subcategories.list({ includeInactive: true }), snapshot).filter(
      (subcategory) => shownCategories.has(subcategory.categoryId),
    );
    const shownSubcategories = new Set(subcategories.map((subcategory) => subcategory.id));
    // A dish of an inactive (or unpublished) subcategory would have no tile to sit under.
    const dishes = this.structureDishes(await this.dishes.list({ active: true, pricing: 'promotions', channel }), snapshot).filter(
      (dish) =>
        (dish.categoryId === null || shownCategories.has(dish.categoryId)) &&
        (dish.subcategoryId === null || shownSubcategories.has(dish.subcategoryId)),
    );
    const available = await this.sales.availability(dishes.map((dish) => dish.id));
    const withStock = (dish: Dish): MenuTreeDish => ({ ...dish, available: available[dish.id] ?? false });
    return {
      categories: categories.map((category) => ({
        ...category,
        subcategories: subcategories.filter((subcategory) => subcategory.categoryId === category.id),
        dishes: dishes.filter((dish) => dish.categoryId === category.id).map(withStock),
      })),
      uncategorized: dishes.filter((dish) => dish.categoryId === null).map(withStock),
    };
  }

  /** Every live dish id (active or not), for hasSubcategories of a published category. */
  private async liveDishIds(snapshot: MenuSnapshot | null): Promise<Set<string>> {
    if (!snapshot) {
      return new Set();
    }
    return new Set((await this.rows<{ id: string }>(sql`SELECT id FROM public.dishes`)).map((row) => row.id));
  }

  private structureCategories(live: Category[], snapshot: MenuSnapshot | null, liveDishes: Set<string>): Category[] {
    if (!snapshot) {
      return live.filter((category) => category.active);
    }
    const split = new Set(
      Object.entries(snapshot.dishes)
        .filter(([id, dish]) => dish.subcategory_id !== null && liveDishes.has(id))
        .map(([, dish]) => dish.category_id),
    );
    const published = live.flatMap((category) => {
      const shape = snapshot.categories[category.id];
      return shape
        ? [{
            ...category,
            name: shape.name,
            icon: shape.icon,
            color: shape.color as CategoryColor,
            sortOrder: shape.sort_order,
            active: shape.active,
            hasSubcategories: split.has(category.id),
          }]
        : [];
    });
    return bySortOrder(published).filter((category) => category.active);
  }

  private structureSubcategories(live: Subcategory[], snapshot: MenuSnapshot | null): Subcategory[] {
    if (!snapshot) {
      return live.filter((subcategory) => subcategory.active);
    }
    const published = live.flatMap((subcategory) => {
      const shape = snapshot.subcategories[subcategory.id];
      return shape
        ? [{ ...subcategory, categoryId: shape.category_id, name: shape.name, sortOrder: shape.sort_order, active: shape.active }]
        : [];
    });
    return bySortOrder(published).filter((subcategory) => subcategory.active);
  }

  private structureDishes(live: Dish[], snapshot: MenuSnapshot | null): Dish[] {
    if (!snapshot) {
      return bySortOrder(live);
    }
    return bySortOrder(
      live.flatMap((dish) => {
        const shape = snapshot.dishes[dish.id];
        return shape
          ? [{ ...dish, name: shape.name, categoryId: shape.category_id, subcategoryId: shape.subcategory_id, sortOrder: shape.sort_order }]
          : [];
      }),
    );
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}

/** SQLSTATE of a `pg` error; Drizzle wraps it as `cause`. */
function sqlState(error: unknown): string | undefined {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const { code } = current as { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}
