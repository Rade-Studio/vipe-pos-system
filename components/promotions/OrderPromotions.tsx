import type { ReactNode } from "react"

import type { DiscountRow, QuickAdd, WindowWarning } from "@/lib/promotions/waiter"
import { formatCurrency } from "@/utils/helpers"
import { Button } from "@/components/ui/button"

/** The order panel's share of the promotions (S11): what each line saves and the nudges. */
export interface OrderPricing {
  /** Discounts of a new (unsent) cart line, from the preview. */
  newDiscounts: (lineId: string) => DiscountRow[]
  /** Discounts of a sent line: the order item's own, "fijado HH:MM". */
  sentDiscounts: (lineId: string) => DiscountRow[]
  /** The table's total after discounts; absent without a preview. */
  total?: number
  /** "Ahorro con promociones". */
  savings: number
  /** Nudge and warning, under the lines. */
  notices?: ReactNode
}

/** "Happy hour 2x1 · fijado 18:12  −$24.000" under a line. */
export function DiscountRows({ rows }: { rows: readonly DiscountRow[] }) {
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((row) => (
        <span
          key={row.label}
          className="col-span-full flex justify-between gap-2 border-l-2 border-status-ok-line pl-2.5 text-[13px] text-status-ok-fg"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {row.label}
            {row.fixedAt ? ` · fijado ${row.fixedAt}` : ""}
          </span>
          <span className="flex-none tabular-nums">−{formatCurrency(row.amount)}</span>
        </span>
      ))}
    </>
  )
}

export function SavingsRow({ savings }: { savings: number }) {
  if (savings <= 0) return null
  return (
    <div className="flex items-baseline justify-between text-[13.5px] tabular-nums text-status-ok-fg">
      <span>Ahorro con promociones</span>
      <span>{formatCurrency(savings)}</span>
    </div>
  )
}

interface NudgeProps {
  message: string
  adds: readonly QuickAdd[]
  onQuickAdd: (add: QuickAdd) => void
}

/** "Falta 1 … para otro 2x1." with one-tap adds of the promotion's dishes. */
export function PromotionNudge({ message, adds, onQuickAdd }: NudgeProps) {
  return (
    <div role="status" aria-live="polite" className="grid gap-2 rounded-[14px] border border-brand-line bg-brand-tint p-3 text-[13.5px]">
      <b className="font-semibold text-brand-strong">{message}</b>
      {adds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {adds.map((add) => (
            <Button key={add.dish.id} variant="outline" className="h-11 px-3 text-[13px]" onClick={() => onQuickAdd(add)}>
              + {add.dish.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Envía antes de las 19:00." while unsent lines would still get the promotion. */
export function WindowEndingWarning({ warning }: { warning: WindowWarning }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[14px] border border-status-warning-line bg-status-warning-bg p-3 text-[13.5px] text-status-warning-fg"
    >
      <b className="font-semibold">Envía antes de las {warning.endsAt}.</b> Quedan {warning.minutesLeft} min; lo que no se envíe a esa hora va a
      precio normal.
    </div>
  )
}
