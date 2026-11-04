import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { createDishSchema, Dish, dishListQuerySchema, updateDishSchema } from './catalog.dto';
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
    const [row] = await this.uow.db.insert(dishes).values(toColumns(input) as typeof dishes.$inferInsert).returning();
    return toDish(row);
  }

  async update(id: string, input: DishInput): Promise<Dish> {
    await this.assertCategory(input.categoryId);
    const [row] = await this.uow.db
      .update(dishes)
      .set({ ...toColumns(input), updatedAt: sql`now()` })
      .where(eq(dishes.id, id))
      .returning();
    if (!row) {
      throw new NotFoundException('Dish not found');
    }
    return toDish(row);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.uow.db.delete(dishes).where(eq(dishes.id, id)).returning({ id: dishes.id });
    if (deleted.length === 0) {
      throw new NotFoundException('Dish not found');
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

function toColumns(input: DishInput): Partial<typeof dishes.$inferInsert> {
  const { price, ...rest } = input;
  return price === undefined ? rest : { ...rest, price: String(price) };
}
