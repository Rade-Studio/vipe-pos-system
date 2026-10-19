/**
 * Formulas of dishes and preparations. Reads are two queries for the whole
 * tenant (recipes, recipe_ingredients) joined in memory, never one per
 * product; writes go through `save_formula` (atomic replace).
 */

import { db, num, rpc, unwrap } from "./shared"
import type { Formula, FormulaIndex, FormulaTargetType, SaveFormulaInput, SaveFormulaResult } from "./types"

interface RecipeRow {
  id: string
  dish_id: string | null
  ingredient_id: string | null
  yield_quantity: number | string
  notes: string | null
}

interface RecipeLineRow {
  recipe_id: string
  ingredient_id: string
  quantity: number | string
}

export async function listFormulas(): Promise<FormulaIndex> {
  const [recipes, lines] = await Promise.all([
    unwrap<RecipeRow[] | null>(db.from("recipes").select("id, dish_id, ingredient_id, yield_quantity, notes")),
    unwrap<RecipeLineRow[] | null>(
      db.from("recipe_ingredients").select("recipe_id, ingredient_id, quantity").order("created_at", { ascending: true }),
    ),
  ])

  const linesByRecipe = new Map<string, Formula["lines"]>()
  for (const l of lines ?? []) {
    const list = linesByRecipe.get(l.recipe_id) ?? []
    list.push({ ingredientId: l.ingredient_id, quantity: num(l.quantity) })
    linesByRecipe.set(l.recipe_id, list)
  }

  const index: FormulaIndex = { byDish: {}, byPrep: {} }
  for (const r of recipes ?? []) {
    const targetType: FormulaTargetType = r.dish_id ? "dish" : "prep"
    const targetId = (r.dish_id ?? r.ingredient_id) as string
    if (!targetId) continue
    const formula: Formula = {
      recipeId: r.id,
      targetType,
      targetId,
      yieldQuantity: num(r.yield_quantity) || 1,
      notes: r.notes,
      lines: linesByRecipe.get(r.id) ?? [],
    }
    if (targetType === "dish") index.byDish[targetId] = formula
    else index.byPrep[targetId] = formula
  }
  return index
}

export async function saveFormula(input: SaveFormulaInput): Promise<SaveFormulaResult> {
  const r = await rpc<Record<string, unknown>>("save_formula", {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_yield_quantity: input.yieldQuantity,
    p_lines: input.lines.map((l) => ({ ingredient_id: l.ingredientId, quantity: l.quantity })),
    p_notes: input.notes ?? null,
  })
  return {
    recipeId: r.recipe_id as string,
    targetType: r.target_type as FormulaTargetType,
    targetId: r.target_id as string,
    yieldQuantity: num(r.yield_quantity),
    linesCount: num(r.lines_count),
    totalCost: num(r.total_cost),
    unitCost: num(r.unit_cost),
  }
}
