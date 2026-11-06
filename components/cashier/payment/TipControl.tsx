"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/utils/helpers"
import { cn } from "@/lib/utils"
import { Money, focusRing } from "@/components/cashier/cashier-ui"

interface TipControlProps {
  tip: number
  suggestedTip: number
  showSurplusAsTip: boolean
  /** Amount the tip would become if the cashier applied "el excedente es propina". */
  surplusTipPreview: number
  submitting: boolean
  onSetNone: () => void
  onSetSuggested: () => void
  onSetCustom: (amount: number) => void
  onApplySurplus: () => void
}

export const optionClass = (pressed: boolean) =>
  cn(
    "inline-flex min-h-[44px] items-center justify-center gap-1 whitespace-nowrap rounded-pill border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:opacity-50",
    focusRing,
    pressed ? "border-brand bg-brand-tint text-fg" : "border-line bg-surface text-fg hover:bg-surface-2",
  )

/**
 * The four tip modes the cashier already had (none, suggested, custom amount,
 * surplus-as-tip) as option chips, plus the live tip. Surplus-as-tip is only
 * rendered when the bill actually has cash change to convert.
 */
export function TipControl({
  tip,
  suggestedTip,
  showSurplusAsTip,
  surplusTipPreview,
  submitting,
  onSetNone,
  onSetSuggested,
  onSetCustom,
  onApplySurplus,
}: TipControlProps) {
  const [customText, setCustomText] = useState<string>("")

  const applyCustom = () => {
    const parsed = Number.parseInt(customText.replace(/[^\d]/g, ""), 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      onSetCustom(parsed)
    }
  }

  const isNone = tip === 0
  const isSuggested = suggestedTip > 0 && tip === suggestedTip

  return (
    <section className="space-y-2" aria-labelledby="tip-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="tip-heading" className="text-sm font-semibold text-fg">
          Propina
        </h3>
        <Money className="text-base font-bold text-fg">
          <span data-testid="current-tip">{formatCurrency(tip)}</span>
        </Money>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Propina">
        <button type="button" className={optionClass(isNone)} aria-pressed={isNone} onClick={onSetNone} disabled={submitting}>
          Sin propina
        </button>
        <button
          type="button"
          className={optionClass(isSuggested)}
          aria-pressed={isSuggested}
          onClick={onSetSuggested}
          disabled={submitting || suggestedTip === 0}
        >
          Sugerida (<Money>{formatCurrency(suggestedTip)}</Money>)
        </button>
        {showSurplusAsTip && (
          <button type="button" className={optionClass(false)} onClick={onApplySurplus} disabled={submitting}>
            El excedente es propina (<Money>{formatCurrency(surplusTipPreview)}</Money>)
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="Otro valor"
          value={customText}
          onChange={(e) => setCustomText(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={applyCustom}
          disabled={submitting}
          aria-label="Propina personalizada"
          className="h-11 min-w-0 flex-1 tabular-nums"
        />
        <button
          type="button"
          className={optionClass(false)}
          onClick={applyCustom}
          disabled={submitting || customText === ""}
        >
          Aplicar
        </button>
      </div>
    </section>
  )
}
