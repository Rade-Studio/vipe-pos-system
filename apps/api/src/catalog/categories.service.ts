import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { eq, schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { type Category, CATEGORY_MESSAGES, type createCategorySchema, type updateCategorySchema } from './catalog.dto';
import { toCategory } from './catalog.mappers';

const categories = schema.categories;

type CategoryRow = typeof categories.$inferSelect;

/** Categories of the caller's restaurant; RLS scopes every statement to it. */
@Injectable()
export class CategoriesService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Menu order: sort_order, then name. */
  async list(active?: boolean): Promise<Category[]> {
    const rows = await this.uow.db
      .select()
      .from(categories)
      .where(active === undefined ? undefined : eq(categories.active, active))
      .orderBy(categories.sortOrder, categories.name, categories.id);
    return this.withSubcategoryFlag(rows);
  }

  /** Without sortOrder the category goes after the last one. */
  async create(input: z.infer<typeof createCategorySchema>): Promise<Category> {
    const sortOrder = input.sortOrder ?? sql`(SELECT COALESCE(max(sort_order) + 1, 0) FROM public.categories)`;
    const [row] = await this.uow.db
      .insert(categories)
      .values({ ...input, sortOrder })
      .returning();
    return (await this.withSubcategoryFlag([row]))[0];
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
    return (await this.withSubcategoryFlag([row]))[0];
  }

  /**
   * The menu tree editor's reorder: position i gets sort_order i, in the
   * request transaction, so an id the caller cannot see (Unknown category)
   * rolls back the rows already written. Returns every category.
   */
  async reorder(ids: string[]): Promise<Category[]> {
    for (const [index, id] of ids.entries()) {
      const updated = await this.uow.db
        .update(categories)
        .set({ sortOrder: index, updatedAt: sql`now()` })
        .where(eq(categories.id, id))
        .returning({ id: categories.id });
      if (updated.length === 0) {
        throw new UnprocessableEntityException('Unknown category');
      }
    }
    return this.list();
  }

  /**
   * Refuses with 409 while any dish references the category (was a client-side
   * check in CategoryList) or while it has subcategories (ON DELETE RESTRICT).
   */
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
    const [subcategory] = await db
      .select({ id: schema.subcategories.id })
      .from(schema.subcategories)
      .where(eq(schema.subcategories.categoryId, id))
      .limit(1);
    if (subcategory) {
      throw new ConflictException(CATEGORY_MESSAGES.hasSubcategories);
    }
    await db.delete(categories).where(eq(categories.id, id));
  }

  /**
   * `hasSubcategories`: any dish of the category, active or not, sits in a
   * subcategory. Derived like "sin subcategorías" in migration 0013, so it
   * cannot disagree with the rows; an empty subcategory does not count.
   */
  private async withSubcategoryFlag(rows: CategoryRow[]): Promise<Category[]> {
    if (rows.length === 0) {
      return [];
    }
    const split = await this.uow.db
      .selectDistinct({ categoryId: schema.dishes.categoryId })
      .from(schema.dishes)
      .where(
        sql`${schema.dishes.subcategoryId} IS NOT NULL AND ${schema.dishes.categoryId} = ANY(${sql.param(rows.map((row) => row.id))}::uuid[])`,
      );
    const ids = new Set(split.map((row) => row.categoryId));
    return rows.map((row) => toCategory(row, ids.has(row.id)));
  }
}
