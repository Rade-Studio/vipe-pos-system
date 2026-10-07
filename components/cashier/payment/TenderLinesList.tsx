"use client"

import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import type { ComputedTenderLine } from "@/lib/payments/types"

interface TenderLinesListProps {
  lines: ComputedTenderLine[]
  methodName: (methodId: string) => string
  onRemove: (lineIndex: number) => void
  /** Disable the remove button while submitting. */
  disabled?: boolean
}

/**
 * Renders the cashier's running list of tender lines (one per row,
 * from oldest to newest). Each row shows the method, the amount the
 * customer handed over (or the amount that will be charged for
 * electronic), the applied amount, and any change. The "applied"
 * column is what the cashier wants to see most: it tells them the
 * line covered its share of the bill.
 */
export function TenderLinesList({ lines, methodName, onRemove, disabled }: TenderLinesListProps) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aún no hay líneas de pago. Selecciona un método e ingresa el monto.
      </p>
    )
  }
  return (
    <ul className="divide-y rounded-md border">
      {lines.map((line, index) => (
        <li key={index} className="flex items-center gap-3 p-3">
          <div className="flex-1">
            <div className="font-medium">{methodName(line.methodId)}</div>
            <div className="text-xs text-muted-foreground">
              {line.kind === "cash" ? "Efectivo" : "Electrónico"} · Recibido{" "}
              {formatCurrency(line.tendered)} · Aplicado {formatCurrency(line.applied)}
              {line.change > 0 && ` · Cambio ${formatCurrency(line.change)}`}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Eliminar línea ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
