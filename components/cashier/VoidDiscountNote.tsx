import { formatCurrency } from "@/utils/helpers"
import { Money } from "./cashier-ui"

/** S1: the order after the void, from the void-aware pricing preview. */
export interface VoidNotePreview {
  quantity: number
  name: string
  /** The promotion the voided line carries; null when it has none. */
  promotionName: string | null
  totalDiscounts: number
  /** The new order total; omitted when the preview has none. */
  total?: number
  netSubtotal?: number
}

/**
 * S13/S1 (design/promociones/03, the void note): the void sheet warns that the
 * order's promotions are recomputed. With the void-aware preview it shows the
 * recomputed discounts and the new total; while the preview loads or when it
 * fails, the generic note with the current discounts.
 */
export function VoidDiscountNote({ totalDiscounts, preview }: { totalDiscounts: number; preview?: VoidNotePreview }) {
  if (totalDiscounts <= 0) return null
  const className =
    "grid gap-1 rounded-lg border border-status-warning-line bg-status-warning-bg px-3 py-2.5 text-sm text-status-warning-fg"
  if (preview) {
    const recomputed = preview.promotionName ? `el ${preview.promotionName} se recalcula` : "las promociones se recalculan"
    return (
      <div role="note" className={className}>
        <b>
          Si anulas {preview.quantity} {preview.name}, {recomputed}.
        </b>
        <span>
          Descuentos: <Money>−{formatCurrency(preview.totalDiscounts)}</Money>
          {preview.total !== undefined ? (
            <>
              {" · "}Total: <Money>{formatCurrency(preview.total)}</Money>
            </>
          ) : preview.netSubtotal !== undefined ? (
            <>
              {" · "}Base: <Money>{formatCurrency(preview.netSubtotal)}</Money>
            </>
          ) : null}
        </span>
      </div>
    )
  }
  return (
    <div role="note" className={className}>
      <b>Las promociones se recalculan al anular</b>
      <span>
        Descuentos actuales: <Money>−{formatCurrency(totalDiscounts)}</Money>. El nuevo total se ve al terminar la anulación.
      </span>
    </div>
  )
}
