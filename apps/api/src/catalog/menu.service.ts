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
import type { MenuChannel, MenuDataSource, MenuSnapshot } from './menu-data-source';
import { SubcategoriesService } from './subcategories.service';

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
 * The rows come from a MenuDataSource: the caller's (RLS) for staff, or the
 * public carta's (treeFrom), so both menus run this one set of rules.
 */
@Injectable()
export class MenuService {
  /** The caller's rows under RLS, through the request unit of work. */
  private readonly staff: MenuDataSource = {
    snapshot: async () => {
      const [latest] = await this.rows<{ snapshot: MenuSnapshot }>(sql`
        SELECT snapshot FROM public.menu_publications ORDER BY published_at DESC, id DESC LIMIT 1`);
      return latest?.snapshot ?? null;
    },
    categories: () => this.categories.list(),
    subcategories: () => this.subcategories.list({ includeInactive: true }),
    dishes: (channel) => this.dishes.list({ active: true, pricing: 'promotions', channel }),
    liveDishIds: async () => new Set((await this.rows<{ id: string }>(sql`SELECT id FROM public.dishes`)).map((row) => row.id)),
    availability: (dishIds) => this.sales.availability(dishIds),
  };

  constructor(
    private readonly uow: UnitOfWork,
    private readonly categories: CategoriesService,
    private readonly subcategories: SubcategoriesService,
    private readonly dishes: DishesService,
    private readonly sales: SalesService,
  ) {}

  /** What waiters and delivery see: the published structure. */
  tree(channel: MenuChannel = 'dine_in'): Promise<MenuTree> {
    return this.treeFrom(this.staff, channel);
  }

  /** tree() over another restaurant-scoped source: the public carta's guest rows. */
  async treeFrom(source: MenuDataSource, channel: MenuChannel): Promise<MenuTree> {
    return this.build(source, await source.snapshot(), channel);
  }

  /** The admin editor's preview: the live structure, what the next publication would serve. */
  draft(channel: MenuChannel = 'dine_in'): Promise<MenuTree> {
    return this.build(this.staff, null, channel);
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

  private async build(source: MenuDataSource, snapshot: MenuSnapshot | null, channel: MenuChannel): Promise<MenuTree> {
    // Every live dish id (active or not), for hasSubcategories of a published category.
    const liveDishes = snapshot ? await source.liveDishIds() : new Set<string>();
    const categories = this.structureCategories(await source.categories(), snapshot, liveDishes);
    const shownCategories = new Set(categories.map((category) => category.id));
    const subcategories = this.structureSubcategories(await source.subcategories(), snapshot).filter(
      (subcategory) => shownCategories.has(subcategory.categoryId),
    );
    const shownSubcategories = new Set(subcategories.map((subcategory) => subcategory.id));
    // A dish of an inactive (or unpublished) subcategory would have no tile to sit under.
    const dishes = this.structureDishes(await source.dishes(channel), snapshot).filter(
      (dish) =>
        (dish.categoryId === null || shownCategories.has(dish.categoryId)) &&
        (dish.subcategoryId === null || shownSubcategories.has(dish.subcategoryId)),
    );
    const available = await source.availability(dishes.map((dish) => dish.id));
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
