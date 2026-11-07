"use client"

import { Ban, Printer, SplitSquareVertical, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"
import { entryHeader, type QueueEntry, type QueueTotals } from "@/lib/cashier/queue"
import { Chip, Eyebrow, Money } from "./cashier-ui"

interface OrderDetailProps {
  entry: QueueEntry
  items: CartItem[]
  totals: QueueTotals
  /** Tables: open the split dialog. Undefined for partials. */
  onSplit?: () => void
  splitDisabledReason?: string
  /** Partials: return the items to the parent order. */
  onUndoSplit?: () => void
  undoBusy?: boolean
  onReprint: () => void
  /** F3: open the step sheet to void dishes of the charged order / cancel it. */
  onVoidItem?: () => void
  onCancelOrder?: () => void
}

/** Centre pane: what the customer ordered and what the bill adds up to. */
export function OrderDetail({
  entry,
  items,
  totals,
  onSplit,
  splitDisabledReason,
  onUndoSplit,
  undoBusy,
  onReprint,
  onVoidItem,
  onCancelOrder,
}: OrderDetailProps) {
  const header = entryHeader(entry)
  return (
    <div className="flex min-h-0 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{header.eyebrow}</Eyebrow>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-fg">
            <span className="min-w-0 break-words">{entry.label}</span>
            <Chip tone={entry.status.tone}>{entry.status.label}</Chip>
          </h2>
          <p className="text-sm text-muted-fg">{header.meta}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onSplit && (
            <Button
              variant="outline"
              className="h-11"
              onClick={onSplit}
              disabled={!!splitDisabledReason}
              title={splitDisabledReason ?? ""}
            >
              <SplitSquareVertical aria-hidden="true" className="h-4 w-4" />
              Dividir
            </Button>
          )}
          {onUndoSplit && (
            <Button variant="outline" className="h-11" onClick={onUndoSplit} disabled={undoBusy}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Eliminar
            </Button>
          )}
          <Button variant="outline" className="h-11" onClick={onReprint}>
            <Printer aria-hidden="true" className="h-4 w-4" />
            Reimprimir
          </Button>
          {onVoidItem && (
            <Button variant="outline" className="h-11" onClick={onVoidItem}>
              <Undo2 aria-hidden="true" className="h-4 w-4" />
              Anular plato
            </Button>
          )}
          {onCancelOrder && (
            <Button
              variant="outline"
              className="h-11 border-status-danger-line text-status-danger-fg hover:bg-status-danger-bg hover:text-status-danger-fg"
              onClick={onCancelOrder}
            >
              <Ban aria-hidden="true" className="h-4 w-4" />
              Cancelar orden
            </Button>
          )}
        </div>
      </div>

      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Productos de la orden</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-fg">
            <th scope="col" className="py-2 pr-2 font-semibold">Producto</th>
            <th scope="col" className="w-12 py-2 text-right font-semibold">Cant.</th>
            <th scope="col" className="hidden w-28 py-2 text-right font-semibold min-[1180px]:table-cell">Precio</th>
            <th scope="col" className="w-28 py-2 pl-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.name}-${item.comments || ""}`} className="border-b border-line align-top last:border-0">
              <td className="py-2 pr-2">
                <span className="block break-words font-semibold text-fg">{item.name}</span>
                {item.comments && <span className="block break-words text-xs italic text-muted-fg">{item.comments}</span>}
                <span className="block text-xs text-muted-fg min-[1180px]:hidden">
                  <Money>{formatCurrency(item.price)}</Money> c/u
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">{item.quantity}</td>
              <td className="hidden py-2 text-right min-[1180px]:table-cell">
                <Money>{formatCurrency(item.price)}</Money>
              </td>
              <td className="py-2 pl-2 text-right font-semibold">
                <Money>{formatCurrency(item.price * item.quantity)}</Money>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto w-full max-w-sm space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-fg">Consumo</dt>
          <dd><Money>{formatCurrency(totals.subtotal)}</Money></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-fg">{totals.taxPercentage !== null ? `Impuestos ${totals.taxPercentage} %` : "Impuestos"}</dt>
          <dd><Money>{formatCurrency(totals.tax)}</Money></dd>
        </div>
        {totals.tip > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-fg">Propina</dt>
            <dd><Money>{formatCurrency(totals.tip)}</Money></dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-line pt-2 text-base font-bold text-fg">
          <dt>Total de la cuenta</dt>
          <dd><Money>{formatCurrency(totals.total)}</Money></dd>
        </div>
      </dl>
    </div>
  )
}
