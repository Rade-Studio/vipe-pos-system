import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type createModifierGroupSchema,
  type createModifierOptionSchema,
  type DishModifierGroup,
  MODIFIER_MESSAGES,
  type ModifierGroup,
  type ModifierOption,
  type updateModifierGroupSchema,
  type updateModifierOptionSchema,
} from './modifiers.dto';

type Json = Record<string, unknown>;
type GroupPatch = z.infer<typeof updateModifierGroupSchema>;
type OptionPatch = z.infer<typeof updateModifierOptionSchema>;

const iso = (value: unknown) => (value === null || value === undefined ? null : new Date(String(value)).toISOString());
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const toOption = (row: Json): ModifierOption => ({
  id: String(row.id),
  groupId: String(row.group_id),
  name: String(row.name),
  price: Number(row.price),
  ingredientId: row.ingredient_id === null ? null : String(row.ingredient_id),
  ingredientQty: numOrNull(row.ingredient_qty),
  sortOrder: Number(row.sort_order),
  isActive: row.is_active === true,
});

const toGroup = (row: Json): ModifierGroup => ({
  id: String(row.id),
  name: String(row.name),
  required: row.required === true,
  minSelect: Number(row.min_select),
  maxSelect: numOrNull(row.max_select),
  sortOrder: Number(row.sort_order),
  isActive: row.is_active === true,
  options: ((row.options as Json[] | null) ?? []).map(toOption),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Options of a group as jsonb, in menu order; `onlyActive` drops the inactive ones. */
const optionsOf = (group: SQL, onlyActive: boolean) => sql`
  coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.sort_order, lower(o.name), o.id)
              FROM public.modifier_options o
             WHERE o.group_id = ${group} ${onlyActive ? sql`AND o.is_active` : sql``}), '[]'::jsonb)`;

/**
 * Reusable modifier groups, their options and the groups each dish offers
 * (F7, 0023). RLS lets staff read and only an admin write; the controllers
 * also require the admin role on writes, so a 403 comes before the database.
 */
@Injectable()
export class ModifiersService {
  constructor(private readonly uow: UnitOfWork) {}

  /** By sortOrder, then name; inactive groups and options only with `includeInactive`. */
  async listGroups(includeInactive: boolean): Promise<ModifierGroup[]> {
    const rows = await this.rows<{ row: Json }>(sql`
      SELECT to_jsonb(g) || jsonb_build_object('options', ${optionsOf(sql`g.id`, !includeInactive)}) AS row
        FROM public.modifier_groups g
       ${includeInactive ? sql`` : sql`WHERE g.is_active`}
       ORDER BY g.sort_order, lower(g.name), g.id`);
    return rows.map((r) => toGroup(r.row));
  }

  async createGroup(input: z.infer<typeof createModifierGroupSchema>): Promise<ModifierGroup> {
    const rules = selectRules(input, { required: false, minSelect: 0, maxSelect: null });
    const sortOrder = input.sortOrder ?? sql`(SELECT coalesce(max(sort_order) + 1, 0) FROM public.modifier_groups)`;
    const [row] = await this.write<{ id: string }>(
      sql`
      INSERT INTO public.modifier_groups (name, required, min_select, max_select, sort_order, is_active)
      VALUES (${input.name}, ${rules.required}, ${rules.minSelect}, ${rules.maxSelect}, ${sortOrder}, ${input.isActive ?? true})
      RETURNING id`,
      MODIFIER_MESSAGES.duplicateGroup,
    );
    return this.group(row.id);
  }

  async updateGroup(id: string, patch: GroupPatch): Promise<ModifierGroup> {
    const [current] = await this.rows<{ required: boolean; min_select: number; max_select: number | null }>(sql`
      SELECT required, min_select, max_select FROM public.modifier_groups WHERE id = ${id} FOR UPDATE`);
    if (!current) {
      throw new NotFoundException('Modifier group not found');
    }
    const rules = selectRules(patch, { required: current.required, minSelect: current.min_select, maxSelect: current.max_select });
    const sets: SQL[] = [
      sql`required = ${rules.required}`,
      sql`min_select = ${rules.minSelect}`,
      sql`max_select = ${rules.maxSelect}`,
    ];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.sortOrder !== undefined) sets.push(sql`sort_order = ${patch.sortOrder}`);
    if (patch.isActive !== undefined) sets.push(sql`is_active = ${patch.isActive}`);
    await this.write(sql`UPDATE public.modifier_groups SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`, MODIFIER_MESSAGES.duplicateGroup);
    return this.group(id);
  }

  /** Deletes its options and its dish links (ON DELETE CASCADE); sent lines keep their snapshot. */
  async removeGroup(id: string): Promise<void> {
    const deleted = await this.rows(sql`DELETE FROM public.modifier_groups WHERE id = ${id} RETURNING id`);
    if (deleted.length === 0) {
      throw new NotFoundException('Modifier group not found');
    }
  }

  async createOption(groupId: string, input: z.infer<typeof createModifierOptionSchema>): Promise<ModifierOption> {
    const [group] = await this.rows(sql`SELECT 1 FROM public.modifier_groups WHERE id = ${groupId}`);
    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }
    const ingredient = await this.ingredientRule(input, { ingredientId: null, ingredientQty: null });
    const sortOrder =
      input.sortOrder ?? sql`(SELECT coalesce(max(sort_order) + 1, 0) FROM public.modifier_options WHERE group_id = ${groupId})`;
    const [row] = await this.write<{ row: Json }>(
      sql`
      INSERT INTO public.modifier_options (group_id, name, price, ingredient_id, ingredient_qty, sort_order, is_active)
      VALUES (${groupId}, ${input.name}, ${input.price}, ${ingredient.ingredientId}, ${ingredient.ingredientQty}, ${sortOrder}, ${input.isActive ?? true})
      RETURNING to_jsonb(modifier_options) AS row`,
      MODIFIER_MESSAGES.duplicateOption,
    );
    return toOption(row.row);
  }

  async updateOption(id: string, patch: OptionPatch): Promise<ModifierOption> {
    const [current] = await this.rows<{ ingredient_id: string | null; ingredient_qty: string | null }>(sql`
      SELECT ingredient_id, ingredient_qty FROM public.modifier_options WHERE id = ${id} FOR UPDATE`);
    if (!current) {
      throw new NotFoundException('Modifier option not found');
    }
    const ingredient = await this.ingredientRule(patch, {
      ingredientId: current.ingredient_id,
      ingredientQty: numOrNull(current.ingredient_qty),
    });
    const sets: SQL[] = [sql`ingredient_id = ${ingredient.ingredientId}`, sql`ingredient_qty = ${ingredient.ingredientQty}`];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.price !== undefined) sets.push(sql`price = ${patch.price}`);
    if (patch.sortOrder !== undefined) sets.push(sql`sort_order = ${patch.sortOrder}`);
    if (patch.isActive !== undefined) sets.push(sql`is_active = ${patch.isActive}`);
    const [row] = await this.write<{ row: Json }>(
      sql`UPDATE public.modifier_options SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING to_jsonb(modifier_options) AS row`,
      MODIFIER_MESSAGES.duplicateOption,
    );
    return toOption(row.row);
  }

  async removeOption(id: string): Promise<void> {
    const deleted = await this.rows(sql`DELETE FROM public.modifier_options WHERE id = ${id} RETURNING id`);
    if (deleted.length === 0) {
      throw new NotFoundException('Modifier option not found');
    }
  }

  /** Group ids of the dish in order, inactive included (the admin dish form). */
  async dishGroupIds(dishId: string): Promise<string[]> {
    await this.assertDish(dishId);
    const rows = await this.rows<{ group_id: string }>(sql`
      SELECT group_id FROM public.dish_modifier_groups WHERE dish_id = ${dishId} ORDER BY sort_order, group_id`);
    return rows.map((row) => row.group_id);
  }

  /** Replaces the dish's groups; position i gets sort_order i. An unknown group (another restaurant) is a 422. */
  async setDishGroups(dishId: string, groupIds: string[]): Promise<string[]> {
    await this.assertDish(dishId);
    const known = await this.rows<{ id: string }>(sql`
      SELECT id FROM public.modifier_groups WHERE id = ANY(${sql.param(groupIds)}::uuid[])`);
    if (known.length !== groupIds.length) {
      throw new UnprocessableEntityException(MODIFIER_MESSAGES.unknownGroup);
    }
    await this.uow.db.execute(sql`DELETE FROM public.dish_modifier_groups WHERE dish_id = ${dishId}`);
    if (groupIds.length > 0) {
      await this.uow.db.execute(sql`
        INSERT INTO public.dish_modifier_groups (dish_id, group_id, sort_order)
        SELECT ${dishId}::uuid, g.id, g.ord - 1
          FROM unnest(${sql.param(groupIds)}::uuid[]) WITH ORDINALITY AS g(id, ord)`);
    }
    return this.dishGroupIds(dishId);
  }

  /**
   * Dish.modifierGroups for many dishes in one query: the active groups each
   * dish offers, in its order, with their active options and live prices.
   */
  async groupsForDishes(dishIds: string[]): Promise<Map<string, DishModifierGroup[]>> {
    const result = new Map<string, DishModifierGroup[]>(dishIds.map((id) => [id, []]));
    if (dishIds.length === 0) {
      return result;
    }
    const rows = await this.rows<{ dish_id: string; row: Json }>(sql`
      SELECT dg.dish_id, to_jsonb(g) || jsonb_build_object('options', ${optionsOf(sql`g.id`, true)}) AS row
        FROM public.dish_modifier_groups dg
        JOIN public.modifier_groups g ON g.id = dg.group_id
       WHERE dg.dish_id = ANY(${sql.param(dishIds)}::uuid[]) AND g.is_active
       ORDER BY dg.dish_id, dg.sort_order, lower(g.name), g.id`);
    for (const { dish_id: dishId, row } of rows) {
      const { id, name, required, minSelect, maxSelect, options } = toGroup(row);
      result.get(dishId)?.push({ id, name, required, minSelect, maxSelect, options });
    }
    return result;
  }

  private async group(id: string): Promise<ModifierGroup> {
    const [row] = await this.rows<{ row: Json }>(sql`
      SELECT to_jsonb(g) || jsonb_build_object('options', ${optionsOf(sql`g.id`, false)}) AS row
        FROM public.modifier_groups g WHERE g.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Modifier group not found');
    }
    return toGroup(row.row);
  }

  private async assertDish(dishId: string): Promise<void> {
    const [dish] = await this.rows(sql`SELECT 1 FROM public.dishes WHERE id = ${dishId}`);
    if (!dish) {
      throw new NotFoundException('Dish not found');
    }
  }

  /** ingredientId and ingredientQty set together or not at all; the ingredient must be one of the restaurant (RLS). */
  private async ingredientRule(
    patch: OptionPatch,
    current: { ingredientId: string | null; ingredientQty: number | null },
  ): Promise<{ ingredientId: string | null; ingredientQty: number | null }> {
    let ingredientId = patch.ingredientId !== undefined ? patch.ingredientId : current.ingredientId;
    let ingredientQty = patch.ingredientQty !== undefined ? patch.ingredientQty : current.ingredientQty;
    if (patch.ingredientId === null && patch.ingredientQty === undefined) {
      ingredientQty = null;
    }
    if (patch.ingredientQty === null && patch.ingredientId === undefined) {
      ingredientId = null;
    }
    if ((ingredientId === null) !== (ingredientQty === null)) {
      throw new UnprocessableEntityException(MODIFIER_MESSAGES.ingredient);
    }
    if (ingredientId !== null && patch.ingredientId !== undefined) {
      const [ingredient] = await this.rows(sql`SELECT 1 FROM public.ingredients WHERE id = ${ingredientId}`);
      if (!ingredient) {
        throw new UnprocessableEntityException(MODIFIER_MESSAGES.unknownIngredient);
      }
    }
    return { ingredientId, ingredientQty };
  }

  /** A unique violation (the case-insensitive name keys) is a 409 in Spanish. */
  private async write<T = Json>(query: SQL, duplicate: string): Promise<T[]> {
    try {
      return await this.rows<T>(query);
    } catch (error) {
      throw pgCode(error) === '23505' ? new ConflictException(duplicate) : error;
    }
  }

  private async rows<T = Json>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

/**
 * modifier_groups_select_check with Spanish 422s: required exactly when
 * minSelect >= 1, maxSelect null or >= minSelect. A field left out follows the
 * other one (required -> at least 1, minSelect >= 1 -> required).
 */
function selectRules(
  patch: GroupPatch,
  current: { required: boolean; minSelect: number; maxSelect: number | null },
): { required: boolean; minSelect: number; maxSelect: number | null } {
  let { required, minSelect } = current;
  if (patch.required !== undefined && patch.minSelect !== undefined) {
    ({ required, minSelect } = { required: patch.required, minSelect: patch.minSelect });
  } else if (patch.required !== undefined) {
    required = patch.required;
    minSelect = required ? Math.max(1, minSelect) : 0;
  } else if (patch.minSelect !== undefined) {
    minSelect = patch.minSelect;
    required = minSelect >= 1;
  }
  const maxSelect = patch.maxSelect !== undefined ? patch.maxSelect : current.maxSelect;
  if (required !== minSelect >= 1) {
    throw new UnprocessableEntityException(MODIFIER_MESSAGES.required);
  }
  if (maxSelect !== null && maxSelect < minSelect) {
    throw new UnprocessableEntityException(MODIFIER_MESSAGES.minMax);
  }
  return { required, minSelect, maxSelect };
}

/** SQLSTATE of a `pg` error; Drizzle wraps it as `cause`. */
function pgCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const { code } = current as { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}
