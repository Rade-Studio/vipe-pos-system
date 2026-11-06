import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { type createDishSchema, type Dish, DISH_MESSAGES, type dishListQuerySchema, type updateDishSchema } from './catalog.dto';
import { toDish } from './catalog.mappers';
import { applyPromotionsToDishes } from './promotion-pricing';
import { PromotionsService } from './promotions.service';

const dishes = schema.dishes;

type DishInput = z.infer<typeof updateDishSchema>;

/** Dishes of the caller's restaurant; RLS scopes every statement to it. */
@Injectable()
export class DishesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly promotions: PromotionsService,
  ) {}

  /** Ordered by name; `pricing: 'promotions'` applies the promotions active now (server clock). */
  async list(query: z.infer<typeof dishListQuerySchema>): Promise<Dish[]> {
    const rows = await this.uow.db
      .select()
      .from(dishes)
      .where(
        and(
          query.categoryId === undefined ? undefined : eq(dishes.categoryId, query.categoryId),
          query.subcategoryId === undefined ? undefined : eq(dishes.subcategoryId, query.subcategoryId),
          query.active === undefined ? undefined : eq(dishes.active, query.active),
        ),
      )
      .orderBy(dishes.name);
    const list = rows.map(toDish);
    if (query.pricing !== 'promotions' || list.length === 0) {
      return list;
    }
    const active = await this.promotions.activeForPricing();
    if (active.length === 0) {
      return list;
    }
    const links = await this.uow.db
      .select({ dishId: schema.promotionDishes.dishId, promotionId: schema.promotionDishes.promotionId })
      .from(schema.promotionDishes)
      .where(
        and(
          sql`${schema.promotionDishes.dishId} = ANY(${sql.param(list.map((dish) => dish.id))}::uuid[])`,
          sql`${schema.promotionDishes.promotionId} = ANY(${sql.param(active.map((promotion) => promotion.id))}::uuid[])`,
        ),
      );
    return applyPromotionsToDishes(list, links, active);
  }

  async create(input: z.infer<typeof createDishSchema>): Promise<Dish> {
    await this.assertCategory(input.categoryId);
    await this.assertSubcategory(input, { categoryId: null, subcategoryId: null });
    // After the last dish of its group, as categories and subcategories are created.
    const sortOrder = afterLast(input.categoryId ?? null, input.subcategoryId ?? null);
    const [row] = await guardSubcategory(
      this.uow.db
        .insert(dishes)
        .values({ ...(toColumns(input) as typeof dishes.$inferInsert), sortOrder })
        .returning(),
    );
    return toDish(row);
  }

  async update(id: string, input: DishInput): Promise<Dish> {
    await this.assertCategory(input.categoryId);
    const [current] = await this.uow.db
      .select({ categoryId: dishes.categoryId, subcategoryId: dishes.subcategoryId })
      .from(dishes)
      .where(eq(dishes.id, id))
      .for('update');
    if (!current) {
      throw new NotFoundException('Dish not found');
    }
    await this.assertSubcategory(input, current);
    const categoryId = input.categoryId !== undefined ? input.categoryId : current.categoryId;
    const subcategoryId = input.subcategoryId !== undefined ? input.subcategoryId : current.subcategoryId;
    // A dish moved to another group goes after its last dish, as on create; its old order would tie there.
    const moved = categoryId !== current.categoryId || subcategoryId !== current.subcategoryId;
    const [row] = await guardSubcategory(
      this.uow.db
        .update(dishes)
        .set({ ...toColumns(input), ...(moved ? { sortOrder: afterLast(categoryId, subcategoryId) } : {}), updatedAt: sql`now()` })
        .where(eq(dishes.id, id))
        .returning(),
    );
    if (!row) {
      throw new NotFoundException('Dish not found');
    }
    return toDish(row);
  }

  /**
   * The menu editor's dish reorder inside one (category, subcategory) group:
   * position i gets sort_order i, in the request transaction, so an id of
   * another group or restaurant (Unknown dish) rolls back the rows already
   * written. Returns every dish of the group, inactive included, in the new order.
   */
  async reorder(group: { categoryId: string | null; subcategoryId: string | null }, ids: string[]): Promise<Dish[]> {
    const inGroup = and(
      sql`${dishes.categoryId} IS NOT DISTINCT FROM ${group.categoryId}::uuid`,
      sql`${dishes.subcategoryId} IS NOT DISTINCT FROM ${group.subcategoryId}::uuid`,
    );
    for (const [index, id] of ids.entries()) {
      const updated = await this.uow.db
        .update(dishes)
        .set({ sortOrder: index, updatedAt: sql`now()` })
        .where(and(eq(dishes.id, id), inGroup))
        .returning({ id: dishes.id });
      if (updated.length === 0) {
        throw new UnprocessableEntityException('Unknown dish');
      }
    }
    const rows = await this.uow.db.select().from(dishes).where(inGroup).orderBy(dishes.sortOrder, dishes.name, dishes.id);
    return rows.map(toDish);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.uow.db.delete(dishes).where(eq(dishes.id, id)).returning({ id: dishes.id });
    if (deleted.length === 0) {
      throw new NotFoundException('Dish not found');
    }
  }

  /**
   * The dishes_subcategory_id_fkey / dishes_subcategory_category_check rules
   * as 422s in Spanish, checked before the write: a dish with a subcategory
   * needs a category, the subcategory must be one of that category (of this
   * restaurant: RLS hides the others), and moving a dish to another category
   * needs a subcategory of the new one or null.
   */
  private async assertSubcategory(
    input: DishInput,
    current: { categoryId: string | null; subcategoryId: string | null },
  ): Promise<void> {
    const categoryId = input.categoryId !== undefined ? input.categoryId : current.categoryId;
    const subcategoryId = input.subcategoryId !== undefined ? input.subcategoryId : current.subcategoryId;
    if (!subcategoryId) {
      return;
    }
    if (!categoryId) {
      throw new UnprocessableEntityException(DISH_MESSAGES.noCategory);
    }
    if (input.subcategoryId === undefined) {
      if (categoryId !== current.categoryId) {
        throw new UnprocessableEntityException(DISH_MESSAGES.move);
      }
      return;
    }
    const [subcategory] = await this.uow.db
      .select({ id: schema.subcategories.id })
      .from(schema.subcategories)
      .where(and(eq(schema.subcategories.id, subcategoryId), eq(schema.subcategories.categoryId, categoryId)));
    if (!subcategory) {
      throw new UnprocessableEntityException(DISH_MESSAGES.otherCategory);
    }
  }

  /** The foreign key alone would accept another restaurant's category; RLS on the read does not. */
  private async assertCategory(categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) {
      return;
    }
    const [category] = await this.uow.db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, categoryId));
    if (!category) {
      throw new UnprocessableEntityException('Unknown category');
    }
  }
}

/** sort_order after the last dish of the (category, subcategory) group. */
function afterLast(categoryId: string | null, subcategoryId: string | null) {
  return sql`(SELECT COALESCE(max(d.sort_order) + 1, 0) FROM public.dishes d
     WHERE d.category_id IS NOT DISTINCT FROM ${categoryId}::uuid
       AND d.subcategory_id IS NOT DISTINCT FROM ${subcategoryId}::uuid)`;
}

/** The database guards behind assertSubcategory, should a write race past it. */
async function guardSubcategory<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    const constraint = pgConstraint(error);
    if (constraint === 'dishes_subcategory_id_fkey') {
      throw new UnprocessableEntityException(DISH_MESSAGES.otherCategory);
    }
    if (constraint === 'dishes_subcategory_category_check') {
      throw new UnprocessableEntityException(DISH_MESSAGES.noCategory);
    }
    throw error;
  }
}

/** Constraint name of a `pg` error; Drizzle wraps it as `cause`. */
function pgConstraint(error: unknown): string | undefined {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const { constraint } = current as { constraint?: unknown };
    if (typeof constraint === 'string') {
      return constraint;
    }
    current = current.cause;
  }
  return undefined;
}

function toColumns(input: DishInput): Partial<typeof dishes.$inferInsert> {
  const { price, ...rest } = input;
  return price === undefined ? rest : { ...rest, price: String(price) };
}
