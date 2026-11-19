"use client"

import { Check } from "lucide-react"
import type { Order } from "@/types"
import { cn } from "@/lib/utils"
import { sentGroups } from "@/lib/order-steps/details"
import { LINE_STAGE_LABEL, lineStage, type LineStage } from "@/lib/kitchen/order"
import { lineTotal } from "@/components/order-steps/OrderReview"
import { formatCurrency } from "@/utils/helpers"

// H-057 (S4): the kitchen's step of each line, shown read only. No toast,
// sound or notice: the waiter sees it when looking at the table.
const STAGE_CLASS: Record<LineStage, string> = {
  pending: "border-line bg-surface-2 text-fg-2",
  preparing: "border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg",
  ready: "border-status-ok-line bg-status-ok-bg text-status-ok-fg",
  served: "border-status-served-line bg-status-served-bg text-status-served-fg",
}

/**
 * "Pedido en curso" of the table panel (T29): what the kitchen already has,
 * grouped by send, read only. The new lines stay in the cart below.
 */
export function OrderInProgress({ order }: { order: Order }) {
  if (order.items.length === 0) return null
  return (
    <section aria-label="Pedido en curso" className="grid gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-fg-2">Pedido en curso</h3>
      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {sentGroups(order.items).map((group) => (
          <div key={group.time ?? "none"}>
            <p className="flex items-center gap-1 text-xs font-medium text-status-ok-fg">
              <Check className="h-3 w-3" aria-hidden />
              Enviado a cocina{group.time ? <span className="tabular-nums"> · {group.time}</span> : null}
            </p>
            <ul>
              {group.lines.map((line) => {
                // Any other status falls back to the kitchen look, as before (pending).
                const stage = line.status === "served" || line.status === "kitchen" ? lineStage(line) : "pending"
                return (
                  <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 py-1 text-sm">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="tabular-nums text-muted-fg">{line.quantity}×</span> {line.name}
                      {line.comments && <small className="block text-xs text-muted-fg">“{line.comments}”</small>}
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-5 items-center whitespace-nowrap rounded-pill border px-2 text-[11px] font-medium",
                        STAGE_CLASS[stage],
                      )}
                    >
                      {LINE_STAGE_LABEL[stage]}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {order.notes && (
        <p className="text-xs text-fg-2 [overflow-wrap:anywhere]">
          <span className="font-semibold">Nota:</span> {order.notes}
        </p>
      )}
      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <span className="text-sm text-fg-2">Total</span>
        {/* The bill total the cashier charges (tax and tip included); the line sum only before a bill exists. */}
        <b className="tabular-nums">{formatCurrency(order.bill?.total ? order.bill.total : lineTotal(order.items))}</b>
      </div>
    </section>
  )
}
