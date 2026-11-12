"use client"

import { useMemo, useState } from "react"
import { Ban, Gift, Printer, Receipt, SplitSquareVertical, Trash2, Undo2, X } from "lucide-react"
import { usePrintingEnabled } from "@/lib/api/printing"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"
import { billLineKey, entryHeader, type QueueEntry, type QueueTotals } from "@/lib/cashier/queue"
import { ModifierLines } from "@/components/modifiers/ModifierLines"
import { cashierBill, type CashierDiscountLine } from "@/lib/cashier/discounts"
import { useManualPromotions, useOrderDiscounts } from "@/hooks/use-order-discounts"
import { DiscountSheet, type DiscountSheetTarget } from "./DiscountSheet"
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

function DiscountRows({ discounts, onRemove }: { discounts: CashierDiscountLine[]; onRemove: (discount: CashierDiscountLine) => void }) {
  if (discounts.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {discounts.map((discount) => (
        <li
          key={discount.id}
          aria-label={discount.label}
          className="flex items-center justify-between gap-2 border-l-2 border-status-ok-line pl-3 text-[13px] text-status-ok-fg"
        >
          <span className="min-w-0 break-words">
            {discount.label}
            {discount.note && <small className="ml-1.5 text-xs text-muted-fg">{discount.note}</small>}
          </span>
          <span className="flex flex-none items-center gap-1">
            <Money>−{formatCurrency(discount.amount)}</Money>
            {discount.manual && (
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-muted-fg"
                aria-label={`Quitar ${discount.label}`}
                onClick={() => onRemove(discount)}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Centre pane: what the customer ordered and what the bill adds up to (S13: at list price, with its discounts). */
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
  // S2 (F6): without thermal printers the same action shows the invoice on screen.
  const printingEnabled = usePrintingEnabled()
  const { orders: dtos, refresh, isError: discountsFailed, retry: retryDiscounts } = useOrderDiscounts(entry.orders)
  const promotions = useManualPromotions()
  const noPinPromotionIds = useMemo(
    () => new Set((promotions.data ?? []).filter((promotion) => promotion.mode === "manual").map((promotion) => promotion.id)),
    [promotions.data],
  )
  const bill = dtos ? cashierBill(dtos, { noPinPromotionIds }) : null
  // Without discounts the lines stay grouped as before (same dish and options, one row).
  const discounted = bill !== null && bill.totalDiscounts > 0
  const [removing, setRemoving] = useState<DiscountSheetTarget | null>(null)
  const [adding, setAdding] = useState(false)
  // Built on render, so promotions that arrive after opening still show.
  const sheet: DiscountSheetTarget | null =
    adding && bill
      ? {
          mode: "add",
          label: entry.label,
          billOrderId: entry.payOrder.id,
          promotions: promotions.data ?? [],
          lines: bill.lines.map((line) => ({
            itemId: line.itemId,
            orderId: line.orderId,
            name: line.name,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
          })),
        }
      : removing
  const closeSheet = () => {
    setAdding(false)
    setRemoving(null)
  }
  const openRemove = (discount: CashierDiscountLine) =>
    setRemoving({
      mode: "remove",
      label: entry.label,
      discount,
      requiresPin: discount.promotionId === null || !noPinPromotionIds.has(discount.promotionId),
    })
  const totalRows: { label: string; amount: number; discount?: boolean; strong?: boolean }[] = discounted
    ? [
        { label: "Subtotal (precio de lista)", amount: bill.grossSubtotal },
        ...bill.discountRows.map((row) => ({ ...row, discount: true })),
        { label: "Base", amount: bill.subtotal },
        { label: bill.taxPercentage !== null ? `Impuestos ${bill.taxPercentage} %` : "Impuestos", amount: bill.tax },
        ...(bill.tip > 0 ? [{ label: "Propina", amount: bill.tip }] : []),
        { label: "Total de la cuenta", amount: bill.total, strong: true },
      ]
    : [
        { label: "Consumo", amount: totals.subtotal },
        { label: totals.taxPercentage !== null ? `Impuestos ${totals.taxPercentage} %` : "Impuestos", amount: totals.tax },
        ...(totals.tip > 0 ? [{ label: "Propina", amount: totals.tip }] : []),
        { label: "Total de la cuenta", amount: totals.total, strong: true },
      ]
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
            {printingEnabled ? <Printer aria-hidden="true" className="h-4 w-4" /> : <Receipt aria-hidden="true" className="h-4 w-4" />}
            {printingEnabled ? "Reimprimir" : "Ver factura"}
          </Button>
          {bill && bill.lines.length > 0 && (
            <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
              <Gift aria-hidden="true" className="h-4 w-4" />
              Agregar cortesía o descuento
            </Button>
          )}
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
          {discounted
            ? bill.lines.map((line) => (
                <tr key={line.key} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-2">
                    <span className="block break-words font-semibold text-fg">{line.name}</span>
                    <ModifierLines modifiers={line.modifiers} className="my-0.5" />
                    {line.comments && <span className="block break-words text-xs italic text-muted-fg">{line.comments}</span>}
                    <span className="block text-xs text-muted-fg min-[1180px]:hidden">
                      <Money>{formatCurrency(line.unitPrice)}</Money> c/u
                    </span>
                    <DiscountRows discounts={line.discounts} onRemove={openRemove} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="hidden py-2 text-right min-[1180px]:table-cell">
                    <Money>{formatCurrency(line.unitPrice)}</Money>
                  </td>
                  <td className="py-2 pl-2 text-right font-semibold">
                    <Money>{formatCurrency(line.total)}</Money>
                  </td>
                </tr>
              ))
            : items.map((item) => (
                <tr key={billLineKey(item)} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-2">
                    <span className="block break-words font-semibold text-fg">{item.name}</span>
                    <ModifierLines modifiers={item.modifiers} className="my-0.5" />
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

      {discounted && bill.billDiscounts.length > 0 && (
        <div className="ml-auto w-full max-w-sm">
          <DiscountRows discounts={bill.billDiscounts} onRemove={openRemove} />
        </div>
      )}

      {discountsFailed ? (
        <div
          role="alert"
          className="ml-auto flex w-full max-w-sm flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger-line bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg"
        >
          <span>No se pudieron cargar los descuentos de la cuenta.</span>
          <Button variant="outline" className="h-11" onClick={retryDiscounts}>
            Reintentar
          </Button>
        </div>
      ) : (
      <ul aria-label="Totales de la cuenta" className="ml-auto w-full max-w-sm space-y-1 text-sm">
        {totalRows.map((row) => (
          <li
            key={row.label}
            className={
              row.strong
                ? "flex justify-between gap-3 border-t border-line pt-2 text-base font-bold text-fg"
                : row.discount
                  ? "flex justify-between gap-3 text-status-ok-fg"
                  : "flex justify-between gap-3"
            }
          >
            <span className={row.strong || row.discount ? undefined : "text-muted-fg"}>{row.label}</span>
            <Money>{row.discount ? "−" : ""}{formatCurrency(row.amount)}</Money>
          </li>
        ))}
      </ul>
      )}

      <DiscountSheet target={sheet} onClose={closeSheet} onApplied={refresh} />
    </div>
  )
}
