"use client"

import { Chip, Money } from "@/components/cashier/cashier-ui"
import { Skeleton } from "@/components/ui/skeleton"
import { cancelledTotals, clock, plural } from "@/lib/admin/voids"
import type { CancelledOrderDto } from "@/lib/api/orders"
import { formatCurrency } from "@/utils/helpers"

interface CancelledOrdersTableProps {
  orders: CancelledOrderDto[]
  isLoading: boolean
  isError: boolean
  /** Opens admin Anulaciones (each dish's detail). */
  onOpenAudit: () => void
}

const CARD = "min-w-0 overflow-x-auto rounded-card border border-line bg-surface shadow-sm"
const TH = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-fg"
const TD = "px-3 py-3 align-top text-sm text-fg"
const NOT_RECORDED = <span className="text-muted-fg">Sin registro</span>

/**
 * F3 — "Canceladas" of admin Órdenes (design/anulaciones/01): the day's
 * cancelled orders from GET /orders/cancelled with the bill each had when it
 * was cancelled. They never count as sales. Domicilios (F3b) come with their
 * customer; one cancelled before the audit existed (`legacy`) has no recorded
 * reason, actor or supervisor and says "Sin registro" instead of inventing one.
 */
export function CancelledOrdersTable({ orders, isLoading, isError, onOpenAudit }: CancelledOrdersTableProps) {
  if (isLoading) {
    return (
      <div className={`${CARD} space-y-3 p-4`} aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (isError) return <p className="text-sm text-status-danger-fg">No se pudieron cargar las órdenes canceladas.</p>
  if (orders.length === 0) {
    return (
      <div className={`${CARD} px-6 py-12 text-center`}>
        <p className="font-bold text-fg">No hay órdenes canceladas este día.</p>
        <p className="mt-1 text-sm text-muted-fg">Cuando se cancele una orden aparecerá aquí con su motivo y quién la autorizó.</p>
      </div>
    )
  }

  const totals = cancelledTotals(orders)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="rounded-card border border-status-reserved-line bg-status-reserved-bg px-4 py-3 text-sm text-status-reserved-fg">
        <b>
          {plural(totals.count, "orden cancelada", "órdenes canceladas")} · {formatCurrency(totals.total)}.
        </b>{" "}
        No suman a las ventas. El detalle de cada plato está en{" "}
        <button type="button" onClick={onOpenAudit} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2">
          Anulaciones
        </button>
        .
      </div>
      <div className={CARD}>
        <table className="w-full min-w-[820px] border-collapse" aria-label="Órdenes canceladas">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Orden</th>
              <th className={TH}>Mesa</th>
              <th className={TH}>Mesero</th>
              <th className={TH}>Cancelada</th>
              <th className={TH}>Motivo</th>
              <th className={TH}>Canceló</th>
              <th className={TH}>Autorizó</th>
              <th className={`${TH} text-right`}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const c = order.cancellation
              return (
                <tr key={order.id} className="border-b border-line">
                  <td className={`${TD} font-semibold tabular-nums`}>#{order.orderNumber}</td>
                  <td className={TD}>
                    {order.orderType === "delivery" ? (
                      <>
                        <Chip tone="reserved">Domicilio</Chip>
                        {order.delivery && <small className="mt-1 block break-words text-xs text-muted-fg">{order.delivery.customerName}</small>}
                      </>
                    ) : order.tableNumber != null ? (
                      `Mesa ${order.tableNumber}`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD}>{order.waiterName ?? <span className="text-muted-fg">No asignado</span>}</td>
                  <td className={`${TD} tabular-nums`}>{clock(c.cancelledAt)}</td>
                  <td className={`${TD} break-words`}>
                    {c.legacy ? <span className="text-muted-fg">{c.reasonLabel}</span> : c.reasonText ? `${c.reasonLabel}: «${c.reasonText}»` : c.reasonLabel}
                  </td>
                  <td className={`${TD} break-words`}>{c.cancelledBy?.name ?? NOT_RECORDED}</td>
                  <td className={TD}>
                    <span className="block">
                      {c.authorizedBy?.name ?? (c.legacy ? NOT_RECORDED : <span className="text-muted-fg">No hizo falta</span>)}
                    </span>
                    {c.selfAuthorized && (
                      <Chip tone="warning" className="mt-1">
                        Autoautorizada
                      </Chip>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Money className="text-muted-fg line-through">{formatCurrency(c.total)}</Money>
                  </td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={7} className={`${TD} font-bold`}>
                Total cancelado
              </td>
              <td className={`${TD} text-right font-bold`}>
                <Money>{formatCurrency(totals.total)}</Money>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
