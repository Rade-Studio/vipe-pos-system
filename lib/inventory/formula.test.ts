import { describe, expect, it } from "vitest"

import {
  explodeFormula,
  formulaCost,
  lineCost,
  maxProducible,
  mergeLine,
  priceMetrics,
  scaleLines,
  wouldCreateCycle,
  type FormulaItem,
  type PrepFormula,
} from "./formula"

/**
 * T5 (S3, S4) — costing and structure rules for dish formulas and batch
 * preparations (sub-formulas with their own stock and yield).
 */

const item = (id: string, overrides: Partial<FormulaItem> = {}): FormulaItem => ({
  id,
  name: id,
  kind: "raw",
  unit: "g",
  cost: 1,
  stock: 0,
  ...overrides,
})

const byId = (...items: FormulaItem[]) => new Map(items.map((i) => [i.id, i]))

describe("lineCost", () => {
  it("multiplies quantity by unit cost and is 0 for unknown items", () => {
    const items = byId(item("tomate", { cost: 4 }))
    expect(lineCost({ ingredientId: "tomate", quantity: 250 }, items)).toBe(1000)
    expect(lineCost({ ingredientId: "nada", quantity: 250 }, items)).toBe(0)
  })
})

describe("formulaCost", () => {
  const items = byId(item("a", { cost: 2 }), item("b", { cost: 6 }))
  const lines = [
    { ingredientId: "a", quantity: 10 },
    { ingredientId: "b", quantity: 10 },
  ]

  it("totals lines, splits per yield unit and reports each share", () => {
    expect(formulaCost(lines, items, 4)).toEqual({
      total: 80,
      perUnit: 20,
      lines: [
        { ingredientId: "a", cost: 20, share: 0.25 },
        { ingredientId: "b", cost: 60, share: 0.75 },
      ],
    })
  })

  it("defaults the yield to 1", () => {
    expect(formulaCost(lines, items).perUnit).toBe(80)
  })

  it("reports share 0 when the total is 0", () => {
    const result = formulaCost([{ ingredientId: "nada", quantity: 1 }], items)
    expect(result).toEqual({ total: 0, perUnit: 0, lines: [{ ingredientId: "nada", cost: 0, share: 0 }] })
  })
})

describe("priceMetrics", () => {
  it("computes suggested price, margin and percentages", () => {
    expect(priceMetrics(3000, 10000, 300)).toEqual({
      suggestedPrice: 9000,
      margin: 7000,
      marginPct: 70,
      costPct: 30,
    })
  })

  it("returns 0 percentages when the price is 0", () => {
    expect(priceMetrics(3000, 0, 250)).toEqual({
      suggestedPrice: 7500,
      margin: -3000,
      marginPct: 0,
      costPct: 0,
    })
  })
})

describe("wouldCreateCycle", () => {
  const formulas = new Map<string, PrepFormula>([
    ["B", { yieldQuantity: 1, lines: [{ ingredientId: "A", quantity: 1 }] }],
    ["C", { yieldQuantity: 1, lines: [{ ingredientId: "B", quantity: 1 }] }],
    ["D", { yieldQuantity: 1, lines: [{ ingredientId: "raw", quantity: 1 }] }],
  ])

  it("rejects adding an item to its own formula", () => {
    expect(wouldCreateCycle("A", "A", formulas)).toBe(true)
  })

  it("rejects A → B when B already uses A, also transitively", () => {
    expect(wouldCreateCycle("A", "B", formulas)).toBe(true)
    expect(wouldCreateCycle("A", "C", formulas)).toBe(true)
  })

  it("allows candidates that do not reach the output", () => {
    expect(wouldCreateCycle("A", "D", formulas)).toBe(false)
    expect(wouldCreateCycle("A", "raw", formulas)).toBe(false)
  })

  it("terminates on an existing malformed cycle", () => {
    const malformed = new Map<string, PrepFormula>([
      ["X", { yieldQuantity: 1, lines: [{ ingredientId: "Y", quantity: 1 }] }],
      ["Y", { yieldQuantity: 1, lines: [{ ingredientId: "X", quantity: 1 }] }],
    ])
    expect(wouldCreateCycle("A", "X", malformed)).toBe(false)
  })
})

describe("explodeFormula", () => {
  // Salsa (prep, yields 2000 ml) uses 1000 g tomate + 1 base (prep, yields 4).
  // Base uses 2 cebolla.
  const items = byId(
    item("tomate", { cost: 2 }),
    item("cebolla", { unit: "unidad", cost: 500 }),
    item("salsa", { kind: "prep", unit: "ml", cost: 1.5 }),
    item("base", { kind: "prep", unit: "unidad", cost: 250 }),
  )
  const formulas = new Map<string, PrepFormula>([
    ["salsa", { yieldQuantity: 2000, lines: [
      { ingredientId: "tomate", quantity: 1000 },
      { ingredientId: "base", quantity: 1 },
    ] }],
    ["base", { yieldQuantity: 4, lines: [{ ingredientId: "cebolla", quantity: 2 }] }],
  ])

  it("explodes two levels with quantities scaled by line quantity / yield", () => {
    const tree = explodeFormula([{ ingredientId: "salsa", quantity: 200 }], items, formulas)
    expect(tree).toEqual([
      {
        item: items.get("salsa"),
        ingredientId: "salsa",
        quantity: 200,
        cost: 300,
        children: [
          {
            item: items.get("tomate"),
            ingredientId: "tomate",
            quantity: 100,
            cost: 200,
            children: [],
          },
          {
            item: items.get("base"),
            ingredientId: "base",
            quantity: 0.1,
            cost: 25,
            children: [
              {
                item: items.get("cebolla"),
                ingredientId: "cebolla",
                quantity: 0.05,
                cost: 25,
                children: [],
              },
            ],
          },
        ],
      },
    ])
  })

  it("keeps unknown items as leaves with null item and cost 0", () => {
    expect(explodeFormula([{ ingredientId: "nada", quantity: 3 }], items, formulas)).toEqual([
      { item: null, ingredientId: "nada", quantity: 3, cost: 0, children: [] },
    ])
  })

  it("stops children at maxDepth", () => {
    const tree = explodeFormula([{ ingredientId: "salsa", quantity: 200 }], items, formulas, 1)
    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children[1].children).toEqual([])
    expect(explodeFormula([{ ingredientId: "salsa", quantity: 200 }], items, formulas, 0)[0].children).toEqual([])
  })
})

describe("maxProducible", () => {
  it("is the minimum over lines of stock / quantity × yield", () => {
    const items = byId(item("a", { stock: 500 }), item("b", { stock: 3 }))
    const prep = { yieldQuantity: 2000, lines: [
      { ingredientId: "a", quantity: 1000 },
      { ingredientId: "b", quantity: 1 },
    ] }
    expect(maxProducible(prep, items)).toBe(1000)
  })

  it("is 0 with no lines, and negative or unknown stock counts as 0", () => {
    const items = byId(item("a", { stock: -5 }))
    expect(maxProducible({ yieldQuantity: 1, lines: [] }, items)).toBe(0)
    expect(maxProducible({ yieldQuantity: 1, lines: [{ ingredientId: "a", quantity: 1 }] }, items)).toBe(0)
    expect(maxProducible({ yieldQuantity: 1, lines: [{ ingredientId: "x", quantity: 1 }] }, items)).toBe(0)
  })
})

describe("scaleLines", () => {
  it("multiplies every quantity without mutating the input", () => {
    const lines = [{ ingredientId: "a", quantity: 2 }, { ingredientId: "b", quantity: 0.5 }]
    expect(scaleLines(lines, 3)).toEqual([
      { ingredientId: "a", quantity: 6 },
      { ingredientId: "b", quantity: 1.5 },
    ])
    expect(lines[0].quantity).toBe(2)
  })
})

describe("mergeLine", () => {
  const lines = [{ ingredientId: "a", quantity: 2 }, { ingredientId: "b", quantity: 1 }]

  it("sums the quantity of an ingredient already present, keeping order", () => {
    expect(mergeLine(lines, { ingredientId: "a", quantity: 3 })).toEqual([
      { ingredientId: "a", quantity: 5 },
      { ingredientId: "b", quantity: 1 },
    ])
    expect(lines[0].quantity).toBe(2)
  })

  it("appends a new ingredient", () => {
    expect(mergeLine(lines, { ingredientId: "c", quantity: 4 })).toEqual([
      ...lines,
      { ingredientId: "c", quantity: 4 },
    ])
  })
})
