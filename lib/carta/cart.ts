import type { Carta } from "./types"

/**
 * The guest's lines (S11, S12). One state shape for every ordering path:
 * `list` ("Mi lista", kept on the phone, nothing is sent) and, on a table QR
 * of a restaurant with `settings.tableOrderingEnabled`, `propose` ("Mi
 * pedido", sent to the waiter as a proposal); the components only ask for
 * the mode.
 */

export type OrderingMode = "list" | "propose"

export function orderingMode(carta: Carta): OrderingMode {
  return carta.table && carta.settings.tableOrderingEnabled ? "propose" : "list"
}

export interface CartOption {
  groupId: string
  optionId: string
  name: string
  price: number
}

export interface CartLine {
  /** Same dish + same options + same note = same line. */
  key: string
  dishId: string
  name: string
  qty: number
  /** Unit price with the options, at the time it was added. */
  unitPrice: number
  options: CartOption[]
  note: string | null
}

export type CartAction =
  | { type: "add"; line: Omit<CartLine, "key" | "qty"> }
  | { type: "increment"; key: string }
  | { type: "decrement"; key: string }
  | { type: "removeDish"; dishId: string }
  | { type: "replace"; lines: CartLine[] }

export function lineKey(line: Pick<CartLine, "dishId" | "options" | "note">): string {
  const options = line.options.map((o) => o.optionId).sort().join(",")
  return `${line.dishId}|${options}|${line.note ?? ""}`
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      const key = lineKey(action.line)
      if (lines.some((l) => l.key === key)) {
        return lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      }
      return [...lines, { ...action.line, key, qty: 1 }]
    }
    case "increment":
      return lines.map((l) => (l.key === action.key ? { ...l, qty: l.qty + 1 } : l))
    case "decrement":
      return lines.flatMap((l) => (l.key !== action.key ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))
    case "removeDish":
      return lines.filter((l) => l.dishId !== action.dishId)
    case "replace":
      return action.lines
  }
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
}

export function dishCount(lines: CartLine[], dishId: string): number {
  return lines.filter((l) => l.dishId === dishId).reduce((sum, l) => sum + l.qty, 0)
}

/* ---------------------------------------------------------------- storage */

/** One list per restaurant on the phone. */
export function storageKey(slug: string): string {
  return `vipe:carta:list:${slug}`
}

function isLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false
  const l = value as Record<string, unknown>
  return (
    typeof l.key === "string" &&
    typeof l.dishId === "string" &&
    typeof l.name === "string" &&
    typeof l.qty === "number" &&
    l.qty > 0 &&
    typeof l.unitPrice === "number" &&
    Array.isArray(l.options)
  )
}

export function loadLines(storage: Pick<Storage, "getItem"> | undefined, slug: string): CartLine[] {
  try {
    const raw = storage?.getItem(storageKey(slug))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isLine) : []
  } catch {
    return []
  }
}

export function saveLines(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, slug: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) storage?.removeItem(storageKey(slug))
    else storage?.setItem(storageKey(slug), JSON.stringify(lines))
  } catch {
    // Private mode or a full quota: the list still works for this visit.
  }
}
