"use client"

import { X } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import type { ComputedTenderLine } from "@/lib/payments/types"
import { Money, focusRing } from "@/components/cashier/cashier-ui"
import { cn } from "@/lib/utils"

interface TenderLinesListProps {
  lines: ComputedTenderLine[]
  methodName: (methodId: string) => string
  onRemove: (lineIndex: number) => void
  /** Disable the remove button while submitting. */
  disabled?: boolean
}

/**
 * The cashier's running list of tender lines (oldest first). Each row shows
 * the method, what the customer handed over and the change; the applied
 * amount is the figure on the right because it tells the cashier the line
 * covered its share of the bill.
 */
export function TenderLinesList({ lines, methodName, onRemove, disabled }: TenderLinesListProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-fg">Aún no hay líneas de pago. Selecciona un método e ingresa el monto.</p>
    )
  }
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {lines.map((line, index) => (
        <li key={index} className="flex items-center gap-3 py-1 pl-3 pr-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{methodName(line.methodId)}</div>
            <div className="break-words text-xs text-muted-fg">
              {line.kind === "cash" ? "Efectivo" : "Electrónico"} · Recibido{" "}
              <Money>{formatCurrency(line.tendered)}</Money>
              {line.kind !== "cash" && line.reference && <> · Ref. {line.reference}</>}
              {line.change > 0 && (
                <>
                  {" "}
                  · Cambio <Money>{formatCurrency(line.change)}</Money>
                </>
              )}
            </div>
          </div>
          <Money className="text-sm font-bold text-fg">{formatCurrency(line.applied)}</Money>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Eliminar línea ${index + 1}`}
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-fg hover:bg-surface-2 hover:text-fg disabled:opacity-50",
              focusRing,
            )}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  )
}
