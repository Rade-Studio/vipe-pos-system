"use client"

import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * "Precio cambió" (T24): the order's bill changed while the cashier was
 * charging it. The tenders already added were dropped (or the payment was
 * refused), so nothing computed for the old amount is ever sent.
 */
export function BillChangedBanner({ notice, onDismiss }: { notice: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      aria-label="Precio cambió"
      className="flex items-start gap-3 rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <p>
          <b>La orden cambió mientras cobrabas.</b> <span>{notice}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 border-status-warning-line bg-surface text-fg"
          onClick={onDismiss}
        >
          Entendido
        </Button>
      </div>
    </div>
  )
}
