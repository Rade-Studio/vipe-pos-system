import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { FormulaIndex, SaveFormulaResult, saveFormulaSchema } from './inventory.dto';
import { rows, rpc } from './inventory-sql';
import { toFormula, toSaveFormulaResult } from './inventory.mappers';

type Json = Record<string, unknown>;

/**
 * Formulas of dishes and preparations. The read is one query for the whole
 * tenant; `unit_cost` repeats the costing `save_formula` returns
 * (round(sum(quantity x COALESCE(ingredients.cost, 0)) / yield_quantity, 4)),
 * so the web no longer costs preparations itself. Writes go through
 * `save_formula` (atomic replace, cycle guard).
 */
@Injectable()
export class FormulasService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<FormulaIndex> {
    const result = await rows<{ formula: Json }>(this.uow, sql`
      SELECT jsonb_build_object(
               'id', r.id, 'dish_id', r.dish_id, 'ingredient_id', r.ingredient_id,
               'yield_quantity', r.yield_quantity, 'notes', r.notes,
               'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('ingredient_id', ri.ingredient_id, 'quantity', ri.quantity)
                                                   ORDER BY ri.created_at, ri.ctid)
                                    FROM public.recipe_ingredients ri WHERE ri.recipe_id = r.id), '[]'::jsonb),
               'unit_cost', (SELECT round(COALESCE(sum(ri.quantity * COALESCE(i.cost, 0)), 0) / r.yield_quantity, 4)
                               FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id = ri.ingredient_id
                              WHERE ri.recipe_id = r.id)) AS formula
        FROM public.recipes r
       WHERE r.dish_id IS NOT NULL OR r.ingredient_id IS NOT NULL`);
    const index: FormulaIndex = { byDish: {}, byPrep: {} };
    for (const row of result) {
      const formula = toFormula(row.formula);
      (formula.targetType === 'dish' ? index.byDish : index.byPrep)[formula.targetId] = formula;
    }
    return index;
  }

  async save(input: z.infer<typeof saveFormulaSchema>): Promise<SaveFormulaResult> {
    const lines = input.lines.map((line) => ({ ingredient_id: line.ingredientId, quantity: line.quantity }));
    return toSaveFormulaResult(
      await rpc(this.uow, sql`
        SELECT public.save_formula(
          p_target_type => ${input.targetType}::text,
          p_target_id => ${input.targetId}::uuid,
          p_yield_quantity => ${input.yieldQuantity}::numeric,
          p_lines => ${JSON.stringify(lines)}::jsonb,
          p_notes => ${input.notes ?? null}::text) AS result`),
    );
  }
}
