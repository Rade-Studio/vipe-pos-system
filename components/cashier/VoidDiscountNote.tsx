import { formatCurrency } from "@/utils/helpers"
import { Money } from "./cashier-ui"

/**
 * S13 (design/promociones/03, the void note): the void sheet warns that the
 * order's promotions are recomputed. POST /orders/pricing-preview only adds
 * draft lines to an order and cannot price it minus a voided quantity, so v1
 * shows the generic note with the current discounts, not the new total.
 */
export function VoidDiscountNote({ totalDiscounts }: { totalDiscounts: number }) {
  if (totalDiscounts <= 0) return null
  return (
    <div
      role="note"
      className="grid gap-1 rounded-lg border border-status-warning-line bg-status-warning-bg px-3 py-2.5 text-sm text-status-warning-fg"
    >
      <b>Las promociones se recalculan al anular</b>
      <span>
        Descuentos actuales: <Money>−{formatCurrency(totalDiscounts)}</Money>. El nuevo total se ve al terminar la anulación.
      </span>
    </div>
  )
}
