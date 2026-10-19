/**
 * Costing and structure rules for dish formulas and batch preparations. A
 * preparation ("prep") is an inventory item with its own stock, produced from
 * a formula with a yield; dish formulas consume it like any raw material.
 */

export interface FormulaItem {
  id: string
  name: string
  kind: "raw" | "prep"
  unit: string
  /** Cost per unit. */
  cost: number
  stock: number
}

export interface FormulaLine {
  ingredientId: string
  quantity: number
}

export interface PrepFormula {
  yieldQuantity: number
  lines: FormulaLine[]
}

export interface FormulaNode {
  item: FormulaItem | null
  ingredientId: string
  quantity: number
  cost: number
  children: FormulaNode[]
}

export function lineCost(line: FormulaLine, itemsById: Map<string, FormulaItem>): number {
  const item = itemsById.get(line.ingredientId)
  return item ? item.cost * line.quantity : 0
}

export function formulaCost(
  lines: FormulaLine[],
  itemsById: Map<string, FormulaItem>,
  yieldQuantity = 1,
): { total: number; perUnit: number; lines: { ingredientId: string; cost: number; share: number }[] } {
  const costs = lines.map((line) => ({ ingredientId: line.ingredientId, cost: lineCost(line, itemsById) }))
  const total = costs.reduce((sum, line) => sum + line.cost, 0)
  return {
    total,
    perUnit: yieldQuantity > 0 ? total / yieldQuantity : 0,
    lines: costs.map((line) => ({ ...line, share: total === 0 ? 0 : line.cost / total })),
  }
}

export function priceMetrics(
  cost: number,
  price: number,
  priceSuggestionPct: number,
): { suggestedPrice: number; margin: number; marginPct: number; costPct: number } {
  const margin = price - cost
  return {
    suggestedPrice: (cost * priceSuggestionPct) / 100,
    margin,
    marginPct: price === 0 ? 0 : (margin / price) * 100,
    costPct: price === 0 ? 0 : (cost / price) * 100,
  }
}

/** True when adding `candidateId` to the formula of `outputId` would close a cycle. */
export function wouldCreateCycle(
  outputId: string,
  candidateId: string,
  prepFormulas: Map<string, PrepFormula>,
): boolean {
  const visited = new Set<string>()
  const stack = [candidateId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (id === outputId) return true
    if (visited.has(id)) continue
    visited.add(id)
    for (const line of prepFormulas.get(id)?.lines ?? []) stack.push(line.ingredientId)
  }
  return false
}

export function explodeFormula(
  lines: FormulaLine[],
  itemsById: Map<string, FormulaItem>,
  prepFormulas: Map<string, PrepFormula>,
  maxDepth = 6,
): FormulaNode[] {
  return lines.map((line) => {
    const item = itemsById.get(line.ingredientId) ?? null
    const formula = prepFormulas.get(line.ingredientId)
    const children =
      formula && maxDepth > 0 && formula.yieldQuantity > 0
        ? explodeFormula(
            scaleLines(formula.lines, line.quantity / formula.yieldQuantity),
            itemsById,
            prepFormulas,
            maxDepth - 1,
          )
        : []
    return {
      item,
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      cost: lineCost(line, itemsById),
      children,
    }
  })
}

export function maxProducible(prep: PrepFormula, itemsById: Map<string, FormulaItem>): number {
  if (prep.lines.length === 0) return 0
  let batches = Infinity
  for (const line of prep.lines) {
    if (line.quantity <= 0) continue
    const stock = Math.max(itemsById.get(line.ingredientId)?.stock ?? 0, 0)
    batches = Math.min(batches, stock / line.quantity)
  }
  return Number.isFinite(batches) ? batches * prep.yieldQuantity : 0
}

export function scaleLines(lines: FormulaLine[], factor: number): FormulaLine[] {
  return lines.map((line) => ({ ...line, quantity: line.quantity * factor }))
}

export function mergeLine(lines: FormulaLine[], line: FormulaLine): FormulaLine[] {
  if (!lines.some((existing) => existing.ingredientId === line.ingredientId)) return [...lines, line]
  return lines.map((existing) =>
    existing.ingredientId === line.ingredientId
      ? { ...existing, quantity: existing.quantity + line.quantity }
      : existing,
  )
}
