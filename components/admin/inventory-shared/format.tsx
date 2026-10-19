import { Badge } from "@/components/ui/badge"
import { quantityPresets, unitFamily } from "@/lib/inventory/units"

const MONEY = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const MONEY_PRECISE = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })

/** Peso amount; values under $100 keep two decimals (per-gram costs). */
export function formatMoney(value: number): string {
  return Math.abs(value) > 0 && Math.abs(value) < 100 ? MONEY_PRECISE.format(value) : MONEY.format(value)
}

/** First quantity proposed when an item is added: 1 for counted units, a mid preset otherwise. */
export function defaultQuantity(unit: string): number {
  const family = unitFamily(unit)
  if (family === "count" || family === "standalone" || family === null) return 1
  const presets = quantityPresets(unit)
  return presets[Math.floor(presets.length / 2)]
}

export type MarginLevel = "good" | "fair" | "low"

/** Margin % bands: ≥ 60 good, ≥ 40 fair, otherwise low. */
export function marginLevel(marginPct: number): MarginLevel {
  if (marginPct >= 60) return "good"
  if (marginPct >= 40) return "fair"
  return "low"
}

const MARGIN_VARIANT = { good: "default", fair: "warning", low: "destructive" } as const

export function MarginBadge({ marginPct, className }: { marginPct: number; className?: string }) {
  const level = marginLevel(marginPct)
  return (
    <Badge variant={MARGIN_VARIANT[level]} className={className} aria-label={`Margen ${Math.round(marginPct)} %`}>
      {Math.round(marginPct)} %
    </Badge>
  )
}
