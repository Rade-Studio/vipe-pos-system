/**
 * Formulas of dishes and preparations. One read for the whole tenant, with
 * the server's `unitCost` per formula (stored costs, as `save_formula`
 * computes them); writes go through `save_formula` (atomic replace).
 */

import { api } from "@/lib/api/client"
import { defined, required } from "./shared"
import type { FormulaIndex, SaveFormulaInput, SaveFormulaResult } from "./types"

export async function listFormulas(): Promise<FormulaIndex> {
  const { data } = await api.GET("/api/inventory/formulas")
  return required(data)
}

export async function saveFormula(input: SaveFormulaInput): Promise<SaveFormulaResult> {
  const { data } = await api.PUT("/api/inventory/formulas", { body: defined({ ...input }) })
  return required(data)
}
