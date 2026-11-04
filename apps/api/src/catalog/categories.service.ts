import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { Category, createCategorySchema, updateCategorySchema } from './catalog.dto';
import { toCategory } from './catalog.mappers';

const categories = schema.categories;

/** Categories of the caller's restaurant; RLS scopes every statement to it. */
@Injectable()
export class CategoriesService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(active?: boolean): Promise<Category[]> {
    const rows = await this.uow.db
      .select()
      .from(categories)
      .where(active === undefined ? undefined : eq(categories.active, active))
      .orderBy(categories.name);
    return rows.map(toCategory);
  }

  async create(input: z.infer<typeof createCategorySchema>): Promise<Category> {
    const [row] = await this.uow.db.insert(categories).values(input).returning();
    return toCategory(row);
  }

  async update(id: string, input: z.infer<typeof updateCategorySchema>): Promise<Category> {
    const [row] = await this.uow.db
      .update(categories)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(categories.id, id))
      .returning();
    if (!row) {
      throw new NotFoundException('Category not found');
    }
    return toCategory(row);
  }

  /** Refuses with 409 while any dish references the category (was a client-side check in CategoryList). */
  async remove(id: string): Promise<void> {
    const db = this.uow.db;
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).for('update');
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    const [dish] = await db
      .select({ id: schema.dishes.id })
      .from(schema.dishes)
      .where(eq(schema.dishes.categoryId, id))
      .limit(1);
    if (dish) {
      throw new ConflictException('Category has dishes');
    }
    await db.delete(categories).where(eq(categories.id, id));
  }
}
