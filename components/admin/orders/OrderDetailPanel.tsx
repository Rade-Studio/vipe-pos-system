"use client"

import type { ReactNode } from "react"
import { Ban, Bike, Check, Clock, MapPin, ReceiptText, StickyNote, Undo2, X } from "lucide-react"
import { Chip, Money, focusRing } from "@/components/cashier/cashier-ui"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import type { AdminOrderRow } from "@/lib/admin/orders"
import type { VoidLine, VoidTarget } from "@/components/voids/flow"
import { OrderStatusPill, clockTime } from "./order-ui"

interface OrderDetailPanelProps {
  row: AdminOrderRow
  /** Id of the heading, so the dialog/aside can be labelled by it. */
  titleId: string
  /** Shown in the overlay (below 1280 px): "Cerrar detalle". */
  onClose?: () => void
  /** F3: open the step sheet (design/anulaciones/01) for this order. */
  onVoid: (target: VoidTarget) => void
}

function Meta({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-xs text-muted-fg">{label}</dt>
      <dd className="break-words text-sm text-fg">{children}</dd>
    </div>
  )
}

const missing = (text: string) => <span className="text-muted-fg">{text}</span>

/** "#128 · En cocina", place, people, items with their state, totals, "Anular plato" and "Cancelar orden". */
export function OrderDetailPanel({ row, titleId, onClose, onVoid }: OrderDetailPanelProps) {
  const { order } = row
  const items = order.items ?? []
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const pending = items.reduce((sum, item) => sum + (item.status === "served" ? 0 : item.quantity), 0)
  const opened = `${clockTime(order.createdAt)} · hace ${row.minutes} min`
  const bill = order.bill

  const voidLabel = row.isDelivery ? row.label : `${row.label} · ${row.place}`
  const lines: VoidLine[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    comments: item.comments,
  }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-2xl font-bold tabular-nums text-fg">
            {row.label}
            <OrderStatusPill status={order.status} />
          </h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-fg">
            {row.isDelivery ? <Bike aria-hidden className="h-4 w-4 flex-none" /> : <MapPin aria-hidden className="h-4 w-4 flex-none" />}
            <span className="truncate">
              {row.isDelivery ? "Domicilio" : row.place}
              {row.isDelivery ? (row.place !== "Domicilio" ? ` · ${row.place}` : "") : row.placeDetail ? ` · ${row.placeDetail}` : ""}
            </span>
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className={cn(
              "inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line text-fg-2 hover:text-fg",
              focusRing,
            )}
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        )}
      </div>

      {order.notes && (
        <div className="flex gap-2 rounded-lg border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg">
          <StickyNote aria-hidden className="mt-0.5 h-4 w-4 flex-none" />
          <span className="min-w-0 break-words">{order.notes}</span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {row.isDelivery ? (
          <>
            <Meta label="Cliente">{row.place !== "Domicilio" ? row.place : missing("Sin datos")}</Meta>
            <Meta label="Domiciliario">{row.courierName ?? missing("Sin asignar")}</Meta>
            <Meta label="Dirección" wide>
              {row.address ?? missing("Sin datos")}
            </Meta>
            <Meta label="Tomada por">{row.waiterName ?? missing("No asignado")}</Meta>
            <Meta label="Abierta">
              <span className="tabular-nums">{opened}</span>
            </Meta>
          </>
        ) : (
          <>
            <Meta label="Mesero">{row.waiterName ?? missing("No asignado")}</Meta>
            <Meta label="Comensales">
              {order.guests ? <span className="tabular-nums">{order.guests}</span> : missing("Sin indicar")}
            </Meta>
            <Meta label="Abierta">
              <span className="tabular-nums">{opened}</span>
            </Meta>
            <Meta label="Zona">{row.placeDetail ?? missing("Sin zona")}</Meta>
          </>
        )}
      </dl>

      <section aria-label="Platos">
        <h3 className="flex justify-between border-b border-line pb-2 text-xs font-semibold uppercase tracking-wide text-fg-2">
          <span>Platos · {count}</span>
          <span>{count === 0 ? "" : pending ? `${pending} pendientes` : "Todo servido"}</span>
        </h3>
        {items.length === 0 ? (
          <p className="py-3 text-sm text-muted-fg">Sin platos todavía.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 py-3 text-sm">
                <span className="font-semibold tabular-nums text-fg">{item.quantity}x</span>
                <span className="min-w-0 break-words text-fg">
                  {item.name}
                  {item.comments && <small className="block text-xs text-muted-fg">“{item.comments}”</small>}
                </span>
                <Money className="text-right text-fg">{formatCurrency(item.price * item.quantity)}</Money>
                <span className="col-start-2">
                  {item.status === "served" ? (
                    <Chip tone="served">
                      <Check aria-hidden className="h-3 w-3" />
                      Servido
                    </Chip>
                  ) : (
                    <Chip tone="reserved">
                      <Clock aria-hidden className="h-3 w-3" />
                      Pendiente
                    </Chip>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
        <div className="flex justify-between gap-3 text-fg-2">
          <dt>Subtotal</dt>
          <dd>
            <Money>{formatCurrency(bill.subtotal)}</Money>
          </dd>
        </div>
        {bill.totalDiscounts > 0 && (
          <div className="flex justify-between gap-3 text-fg-2">
            <dt>Descuentos</dt>
            <dd>
              <Money>-{formatCurrency(bill.totalDiscounts)}</Money>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 text-fg-2">
          <dt>Impuesto ({bill.taxPercentage}%)</dt>
          <dd>
            <Money>{formatCurrency(bill.tax)}</Money>
          </dd>
        </div>
        {(bill.tip > 0 || bill.tipPercentage > 0) && (
          <div className="flex justify-between gap-3 text-fg-2">
            <dt>Propina ({bill.tipPercentage}%)</dt>
            <dd>
              <Money>{formatCurrency(bill.tip)}</Money>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 pt-1 text-lg font-bold text-fg">
          <dt>Total</dt>
          <dd>
            <Money>{formatCurrency(bill.total)}</Money>
          </dd>
        </div>
      </dl>

      {row.isDelivery ? (
        <p className="flex items-start gap-2 border-t border-line pt-4 text-xs text-muted-fg">
          <ReceiptText aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Los domicilios se cancelan desde Domicilios.
        </p>
      ) : order.status === "paid" ? (
        <p className="flex items-start gap-2 border-t border-line pt-4 text-xs text-muted-fg">
          <ReceiptText aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Para corregir una orden pagada, anula su pago en Caja → Pagadas.
        </p>
      ) : (
        <section aria-label="Anular o cancelar" className="space-y-2 border-t border-line pt-4">
          <p className="flex items-start gap-2 text-xs text-muted-fg">
            <ReceiptText aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
            Nada se borra: queda en Anulaciones con su motivo y quién autorizó.
          </p>
          <div className="flex flex-wrap gap-2">
            {lines.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => onVoid({ action: "item", orderId: order.id, label: voidLabel, lines })}
              >
                <Undo2 aria-hidden className="mr-1.5 h-4 w-4" />
                Anular plato
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] border-status-danger-line text-status-danger-fg hover:bg-status-danger-bg hover:text-status-danger-fg"
              onClick={() => onVoid({ action: "order", orderId: order.id, label: voidLabel, lines, total: bill.total })}
            >
              <Ban aria-hidden className="mr-1.5 h-4 w-4" />
              Cancelar orden
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
