import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { createPromotionSchema, Dish, Promotion, updatePromotionSchema } from './catalog.dto';
import { toDish, toPromotion } from './catalog.mappers';
import type { PricingPromotion } from './promotion-pricing';

const promotions = schema.promotions;
const promotionDishes = schema.promotionDishes;

type PromotionInput = z.infer<typeof updatePromotionSchema>;

/** Promotions of the caller's restaurant; RLS scopes every statement to it. */
@Injectable()
export class PromotionsService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<Promotion[]> {
    const rows = await this.uow.db.select().from(promotions).orderBy(sql`${promotions.createdAt} DESC`);
    return rows.map(toPromotion);
  }

  /** Active flag set and `startDate <= now <= endDate` on the API server clock. */
  async active(): Promise<Promotion[]> {
    return (await this.activeRows()).map(toPromotion);
  }

  /**
   * Active promotions in a stable order (oldest first): the pricing rule keeps
   * the first promotion on a tie, and the web read had no explicit order.
   */
  async activeForPricing(): Promise<PricingPromotion[]> {
    return (await this.active()).map(({ id, name, discountType, discountValue }) => ({ id, name, discountType, discountValue }));
  }

  async create(input: z.infer<typeof createPromotionSchema>): Promise<Promotion> {
    const [row] = await this.uow.db.insert(promotions).values(toColumns(input) as typeof promotions.$inferInsert).returning();
    return toPromotion(row);
  }

  async update(id: string, input: PromotionInput): Promise<Promotion> {
    const [row] = await this.uow.db
      .update(promotions)
      .set({ ...toColumns(input), updatedAt: sql`now()` })
      .where(eq(promotions.id, id))
      .returning();
    if (!row) {
      throw new NotFoundException('Promotion not found');
    }
    return toPromotion(row);
  }

  /** Deletes the promotion and its dish rows in the request transaction. */
  async remove(id: string): Promise<void> {
    await this.assertPromotion(id);
    await this.uow.db.delete(promotionDishes).where(eq(promotionDishes.promotionId, id));
    await this.uow.db.delete(promotions).where(eq(promotions.id, id));
  }

  async dishes(id: string): Promise<Dish[]> {
    await this.assertPromotion(id);
    const rows = await this.uow.db
      .select({ dish: schema.dishes })
      .from(promotionDishes)
      .innerJoin(schema.dishes, eq(schema.dishes.id, promotionDishes.dishId))
      .where(eq(promotionDishes.promotionId, id))
      .orderBy(schema.dishes.name);
    return rows.map((row) => toDish(row.dish));
  }

  /**
   * Replaces the dish set in the request transaction: delete, then insert the
   * dishes visible to the caller. A dish id that is unknown or belongs to
   * another restaurant inserts no row, which aborts the transaction, so the
   * previous set survives.
   */
  async setDishes(id: string, dishIds: readonly string[]): Promise<Dish[]> {
    await this.assertPromotion(id);
    const unique = [...new Set(dishIds)];
    await this.uow.db.delete(promotionDishes).where(eq(promotionDishes.promotionId, id));
    if (unique.length > 0) {
      const result = await this.uow.db.execute(sql`
        INSERT INTO public.promotion_dishes (promotion_id, dish_id)
        SELECT ${id}::uuid, d.id FROM public.dishes d WHERE d.id = ANY(${sql.param(unique)}::uuid[])`);
      if (result.rowCount !== unique.length) {
        throw new UnprocessableEntityException('Unknown dish');
      }
    }
    return this.dishes(id);
  }

  private async activeRows() {
    const now = new Date().toISOString();
    return this.uow.db
      .select()
      .from(promotions)
      .where(and(eq(promotions.active, true), sql`${promotions.startDate} <= ${now}`, sql`${promotions.endDate} >= ${now}`))
      .orderBy(promotions.createdAt, promotions.id);
  }

  private async assertPromotion(id: string): Promise<void> {
    const [row] = await this.uow.db.select({ id: promotions.id }).from(promotions).where(eq(promotions.id, id)).for('update');
    if (!row) {
      throw new NotFoundException('Promotion not found');
    }
  }
}

function toColumns(input: PromotionInput): Partial<typeof promotions.$inferInsert> {
  const { discountValue, startDate, endDate, ...rest } = input;
  // Dates are normalized to ISO so Postgres never sees a format only Date.parse accepts.
  const iso = (value: string | undefined) => (value === undefined ? undefined : new Date(value).toISOString());
  return {
    ...rest,
    discountValue: discountValue === undefined ? undefined : String(discountValue),
    startDate: iso(startDate),
    endDate: iso(endDate),
  };
}
