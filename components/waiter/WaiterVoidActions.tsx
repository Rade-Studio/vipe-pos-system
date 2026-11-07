"use client"

import { useState } from "react"
import { Ban } from "lucide-react"
import type { Order } from "@/types"
import { Button } from "@/components/ui/button"
import { VoidFlow, type VoidResult } from "@/components/voids/VoidFlow"
import type { VoidLine, VoidTarget } from "@/components/voids/flow"
import { formatCurrency } from "@/utils/helpers"
import { useTerminal } from "@/components/terminal/terminal-context"

interface WaiterVoidActionsProps {
  /** The table's open order; only its sent lines are listed (unsent ones live in the cart). */
  order: Order
  tableNumber: number | undefined
  onDone?: (result: VoidResult) => void
}

const linesOf = (order: Order): VoidLine[] =>
  order.items.map((item) => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity, comments: item.comments }))

/**
 * F3 — the waiter's "Anular plato" per sent line and "Cancelar orden"
 * (design/anulaciones/01, mesero celular): everything on the server was sent to
 * the kitchen, so each one goes through the supervisor step sheet.
 */
export function WaiterVoidActions({ order, tableNumber, onDone }: WaiterVoidActionsProps) {
  const [target, setTarget] = useState<VoidTarget | null>(null)
  // F4b: on a shared terminal the waiter identifies with their PIN first, so
  // the authorization and the void are requested as them.
  const terminal = useTerminal()
  const open = async (next: VoidTarget) => {
    const label = tableNumber !== undefined ? `Mesa ${tableNumber}` : "Anular o cancelar"
    if (terminal && !(await terminal.ensureIdentity({ tableId: order.tableId ?? undefined, label }))) return
    setTarget(next)
  }
  // Every line may be voided and the order still open: it can always be cancelled.
  if (order.status === "paid" || order.status === "cancelled") return null
  const label = [order.orderNumber ? `#${order.orderNumber}` : null, tableNumber !== undefined ? `Mesa ${tableNumber}` : null]
    .filter(Boolean)
    .join(" · ")
  const lines = linesOf(order)

  return (
    <section aria-label="Anular o cancelar" className="grid gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-fg-2">Anular o cancelar</h3>
      <p className="text-xs text-muted-fg">Todo ya se envió · anular necesita supervisor</p>
      {lines.length > 0 && (
      <ul className="grid gap-1">
        {lines.map((line) => (
          <li key={line.id} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <span className="tabular-nums text-muted-fg">{line.quantity}×</span> {line.name}
            </span>
            <span className="whitespace-nowrap tabular-nums text-fg-2">{formatCurrency(line.price * line.quantity)}</span>
            <Button
              variant="ghost"
              className="h-11 flex-none px-2.5 text-status-danger-fg hover:text-status-danger-fg"
              aria-label={`Anular ${line.name}`}
              onClick={() => void open({ action: "item", orderId: order.id, label, lines, lineId: line.id })}
            >
              Anular plato
            </Button>
          </li>
        ))}
      </ul>
      )}
      <Button
        variant="outline"
        className="h-11 border-status-danger-line text-status-danger-fg hover:bg-status-danger-bg hover:text-status-danger-fg"
        onClick={() => void open({ action: "order", orderId: order.id, label, lines, total: order.bill?.total ?? 0 })}
      >
        <Ban className="mr-1.5 h-4 w-4" aria-hidden />
        Cancelar orden
      </Button>
      <VoidFlow target={target} onClose={() => setTarget(null)} onDone={onDone} />
    </section>
  )
}
