import { describe, expect, it } from "vitest"

import { formulaCost, type FormulaItem, type PrepFormula } from "@/lib/inventory/formula"
import type { FormulaIndex } from "@/lib/api/inventory/types"

import { costedItems } from "./use-formula-data"

/**
 * T10 (S4) — the editor costs a saved preparation at its stored
 * `ingredients.cost`, as `save_formula` and `GET /inventory/formulas` do
 * (so the list's server `unitCost` and the editor agree); only the drafts open
 * in the editor are costed live.
 */

const item = (id: string, kind: "raw" | "prep", cost: number): FormulaItem => ({ id, name: id, kind, unit: "g", cost, stock: 0 })

const formula = (id: string, yieldQuantity: number, lines: PrepFormula["lines"], unitCost: number) => ({
  recipeId: `r-${id}`, targetType: "prep" as const, targetId: id, yieldQuantity, notes: null, lines, unitCost,
})

const ITEMS = [item("tomate", "raw", 4), item("aderezo", "prep", 6), item("base", "prep", 9)]

describe("costedItems", () => {
  it("keeps the stored cost of every saved preparation, with no live recursion", () => {
    const costed = costedItems(ITEMS, new Map())
    expect(costed.get("aderezo")?.cost).toBe(6)
    expect(costed.get("base")?.cost).toBe(9)
    expect(costed.get("tomate")?.cost).toBe(4)
  })

  it("costs a dish over a saved prep at the prep's stored cost, not its formula unitCost (verifier D1)", () => {
    const items = [item("t", "raw", 10), item("a", "prep", 25)]
    // Its saved formula's server unitCost (10) is for the list only.
    const index: FormulaIndex = { byDish: {}, byPrep: { a: formula("a", 500, [{ ingredientId: "t", quantity: 500 }], 10) } }
    expect(index.byPrep.a.unitCost).toBe(10)
    const costed = costedItems(items, new Map())
    expect(formulaCost([{ ingredientId: "a", quantity: 100 }], costed, 1).perUnit).toBe(2500)
  })

  it("costs only the open drafts live, over the stored cost of their saved children", () => {
    const drafts = new Map<string, PrepFormula>([["base", { yieldQuantity: 100, lines: [{ ingredientId: "aderezo", quantity: 100 }] }]])
    const costed = costedItems(ITEMS, drafts)
    expect(costed.get("base")?.cost).toBe(6)
    expect(costed.get("aderezo")?.cost).toBe(6)
  })

  it("chains drafts that use other drafts", () => {
    const drafts = new Map<string, PrepFormula>([
      ["aderezo", { yieldQuantity: 100, lines: [{ ingredientId: "tomate", quantity: 50 }] }],
      ["base", { yieldQuantity: 10, lines: [{ ingredientId: "aderezo", quantity: 10 }] }],
    ])
    const costed = costedItems(ITEMS, drafts)
    expect(costed.get("aderezo")?.cost).toBe(2)
    expect(costed.get("base")?.cost).toBe(2)
  })
})
