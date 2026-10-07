"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Banknote, HandCoins } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"

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

/**
 * Quick-action buttons for the four tip modes the cashier uses most
 * (none, suggested, custom amount, surplus-as-tip) plus a small live
 * label of the current tip. Surplus-as-tip is only rendered when the
 * bill actually has cash change to convert, so the cashier never sees
 * a useless button.
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

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Propina</Label>
        <div className="text-lg font-semibold" data-testid="current-tip">
          {formatCurrency(tip)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          onClick={onSetNone}
          disabled={submitting}
        >
          <Banknote className="mr-2 h-4 w-4" />
          Sin propina
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onSetSuggested}
          disabled={submitting || suggestedTip === 0}
        >
          Sugerida ({formatCurrency(suggestedTip)})
        </Button>
        <div className="col-span-2 flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Monto"
            value={customText}
            onChange={(e) => setCustomText(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={applyCustom}
            disabled={submitting}
            aria-label="Propina personalizada"
          />
          <Button
            type="button"
            variant="outline"
            onClick={applyCustom}
            disabled={submitting || customText === ""}
          >
            Aplicar
          </Button>
        </div>
      </div>
      {showSurplusAsTip && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={onApplySurplus}
          disabled={submitting}
        >
          <HandCoins className="mr-2 h-4 w-4" />
          El excedente es propina ({formatCurrency(surplusTipPreview)})
        </Button>
      )}
    </div>
  )
}
