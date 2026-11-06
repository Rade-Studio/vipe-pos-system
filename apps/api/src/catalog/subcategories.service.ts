import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { type createSubcategorySchema, type Subcategory, SUBCATEGORY_MESSAGES, type updateSubcategorySchema } from './catalog.dto';

interface SubcategoryRow {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

const toSubcategory = (row: SubcategoryRow): Subcategory => ({
  id: row.id,
  categoryId: row.category_id,
  name: row.name,
  sortOrder: row.sort_order,
  active: row.active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Second order step of a category (menu tree, T8); RLS scopes every statement. */
@Injectable()
export class SubcategoriesService {
  constructor(private readonly uow: UnitOfWork) {}

  /** By category menu order, then sort_order and name; one category with `categoryId`. */
  async list(filter: { categoryId?: string; includeInactive: boolean }): Promise<Subcategory[]> {
    const conditions: SQL[] = [sql`TRUE`];
    if (filter.categoryId !== undefined) conditions.push(sql`s.category_id = ${filter.categoryId}`);
    if (!filter.includeInactive) conditions.push(sql`s.active`);
    return (
      await this.select(sql`
        JOIN public.categories c ON c.id = s.category_id
       WHERE ${sql.join(conditions, sql` AND `)}
       ORDER BY c.sort_order, c.name, c.id, s.sort_order, lower(s.name), s.id`)
    ).map(toSubcategory);
  }

  /** Without sortOrder the subcategory goes after the last one of its category. */
  async create(input: z.infer<typeof createSubcategorySchema>): Promise<Subcategory> {
    const [category] = await this.rows(sql`SELECT 1 FROM public.categories WHERE id = ${input.categoryId}`);
    if (!category) {
      throw new UnprocessableEntityException('Unknown category');
    }
    const sortOrder =
      input.sortOrder ?? sql`(SELECT COALESCE(max(sort_order) + 1, 0) FROM public.subcategories WHERE category_id = ${input.categoryId})`;
    const [row] = await this.write(sql`
      INSERT INTO public.subcategories (category_id, name, sort_order, active)
      VALUES (${input.categoryId}, ${input.name}, ${sortOrder}, ${input.active ?? true})
      RETURNING id`);
    return this.get(row.id);
  }

  async update(id: string, input: z.infer<typeof updateSubcategorySchema>): Promise<Subcategory> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
    if (input.sortOrder !== undefined) sets.push(sql`sort_order = ${input.sortOrder}`);
    if (input.active !== undefined) sets.push(sql`active = ${input.active}`);
    const [row] = await this.write(sql`UPDATE public.subcategories SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING id`);
    if (!row) {
      throw new NotFoundException('Subcategory not found');
    }
    return this.get(id);
  }

  /** 409 while a dish still sits in the subcategory (the foreign key is ON DELETE RESTRICT too). */
  async remove(id: string): Promise<void> {
    const [subcategory] = await this.rows(sql`SELECT 1 FROM public.subcategories WHERE id = ${id} FOR UPDATE`);
    if (!subcategory) {
      throw new NotFoundException('Subcategory not found');
    }
    const [dish] = await this.rows(sql`SELECT 1 FROM public.dishes WHERE subcategory_id = ${id} LIMIT 1`);
    if (dish) {
      throw new ConflictException(SUBCATEGORY_MESSAGES.hasDishes);
    }
    await this.uow.db.execute(sql`DELETE FROM public.subcategories WHERE id = ${id}`);
  }

  /**
   * Position i gets sort_order i, in the request transaction: an id of another
   * category or restaurant (Unknown subcategory) rolls back the rows already
   * written. Returns every subcategory of the category, inactive included.
   */
  async reorder(categoryId: string, ids: string[]): Promise<Subcategory[]> {
    for (const [index, id] of ids.entries()) {
      const [row] = await this.rows(sql`
        UPDATE public.subcategories SET sort_order = ${index}, updated_at = now()
         WHERE id = ${id} AND category_id = ${categoryId}
        RETURNING id`);
      if (!row) {
        throw new UnprocessableEntityException('Unknown subcategory');
      }
    }
    return this.list({ categoryId, includeInactive: true });
  }

  private async get(id: string): Promise<Subcategory> {
    const [row] = await this.select(sql`WHERE s.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Subcategory not found');
    }
    return toSubcategory(row);
  }

  private select(tail: SQL): Promise<SubcategoryRow[]> {
    return this.rows<SubcategoryRow>(sql`
      SELECT s.id, s.category_id, s.name, s.sort_order, s.active, s.created_at, s.updated_at
        FROM public.subcategories s
       ${tail}`);
  }

  /** A duplicate name in the category (subcategories_category_id_name_key) is a 409 in Spanish. */
  private async write(query: SQL): Promise<{ id: string }[]> {
    try {
      return await this.rows<{ id: string }>(query);
    } catch (error) {
      throw violates(error, 'subcategories_category_id_name_key')
        ? new ConflictException(SUBCATEGORY_MESSAGES.duplicateName)
        : error;
    }
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}

/** A unique violation of `constraint`; Drizzle wraps the `pg` error as `cause`. */
function violates(error: unknown, constraint: string): boolean {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const pg = current as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505') {
      return pg.constraint === constraint;
    }
    current = current.cause;
  }
  return false;
}
