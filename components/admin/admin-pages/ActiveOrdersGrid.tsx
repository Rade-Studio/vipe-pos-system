"use client"

import { useEffect, useId, useMemo, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { CircleCheck, ReceiptText, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { OrderDetailPanel } from "@/components/admin/orders/OrderDetailPanel"
import { OrdersTable } from "@/components/admin/orders/OrdersTable"
import { OrdersToolbar } from "@/components/admin/orders/OrdersToolbar"
import { DOCKED_PANEL_FROM, TABLE_FROM, useWindowWidth } from "@/components/admin/orders/order-ui"
import { useOrderRows, useTickingNow } from "@/components/admin/orders/use-order-rows"
import {
  ACTIVE_STATUS_INFO,
  DEFAULT_ROW_SORT,
  filterOrderRows,
  newOrderIdsAt,
  nextSort,
  sortOrderRows,
  statusCounts,
  type AdminOrder,
  type RowFilters,
  type RowSort,
} from "@/lib/admin/orders"

interface ActiveOrdersGridProps {
  orders: AdminOrder[]
  /** First load (nothing to show yet). A REFETCH keeps the rows on screen. */
  isLoading: boolean
  onDelete: (orderId: string) => void | Promise<void>
  onRefresh: () => void
}

const NO_FILTERS: RowFilters = { query: "", status: "all", type: "all" }

const CARD = "min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-sm"

function EmptyCard({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="text-muted-fg">{icon}</span>
      <p className="font-bold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-muted-fg">{text}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

/**
 * T28 — "Activas" of admin Órdenes (design/admin-orders/01): toolbar, the dense
 * sortable table and the detail panel, docked from 1280 px and an overlay
 * below (full screen on a phone). Two earlier invariants hold: a refresh never
 * blanks the list, and a row never pulses forever.
 */
export function ActiveOrdersGrid({ orders, isLoading, onDelete, onRefresh }: ActiveOrdersGridProps) {
  const nowMs = useTickingNow(true, 10_000)
  const rows = useOrderRows(orders, nowMs)
  const width = useWindowWidth()
  const docked = width >= DOCKED_PANEL_FROM
  const compact = width < TABLE_FROM

  const [filters, setFilters] = useState<RowFilters>(NO_FILTERS)
  const [sort, setSort] = useState<RowSort>(DEFAULT_ROW_SORT)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const titleId = useId()

  // The pulse set is recomputed from the data and the clock, never from the render timestamp.
  const pulsingIds = useMemo(() => newOrderIdsAt(orders, nowMs), [orders, nowMs])
  const counts = useMemo(() => statusCounts(rows), [rows])
  const visible = useMemo(() => sortOrderRows(filterOrderRows(rows, filters), sort), [rows, filters, sort])

  // Docked, the panel always shows an order: the selected one, else the first visible.
  const panelRow = visible.find((row) => row.id === selectedId) ?? (docked ? (visible[0] ?? null) : null)

  useEffect(() => {
    setConfirming(false)
  }, [panelRow?.id])

  // The order left the list (cancelled, paid): close its overlay.
  useEffect(() => {
    if (overlayOpen && !panelRow) setOverlayOpen(false)
  }, [overlayOpen, panelRow])

  const open = (id: string) => {
    setSelectedId(id)
    if (!docked) setOverlayOpen(true)
  }

  const focusRow = (id: string | undefined) => {
    if (!id) return
    document.querySelector<HTMLButtonElement>(`[data-testid="admin-order-${CSS.escape(id)}"] button`)?.focus()
  }

  const filtered = filters.query.trim() !== "" || filters.status !== "all" || filters.type !== "all"

  if (isLoading && orders.length === 0) {
    return (
      <div className={`${CARD} space-y-3 p-4`} data-testid="admin-orders-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <section className={CARD} aria-label="Órdenes activas">
        <EmptyCard
          icon={<CircleCheck aria-hidden className="h-7 w-7" />}
          title="No hay órdenes activas"
          text="Cuando un mesero envíe un pedido o entre un domicilio, aparecerá aquí en tiempo real."
          action={
            <Button variant="outline" className="min-h-[44px]" onClick={onRefresh}>
              <RefreshCw aria-hidden className="mr-2 h-4 w-4" />
              Verificar nuevamente
            </Button>
          }
        />
      </section>
    )
  }

  const hint = [
    filters.query.trim() && `para “${filters.query.trim()}”`,
    filters.status !== "all" && ACTIVE_STATUS_INFO[filters.status].label,
    filters.type !== "all" && (filters.type === "table" ? "solo mesas" : "solo domicilios"),
  ].filter(Boolean)

  const panel = (overlay: boolean) =>
    panelRow ? (
      <OrderDetailPanel
        row={panelRow}
        titleId={titleId}
        onClose={overlay ? () => setOverlayOpen(false) : undefined}
        onCancel={onDelete}
        confirming={confirming}
        onConfirmingChange={setConfirming}
      />
    ) : null

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <OrdersToolbar filters={filters} onChange={setFilters} counts={counts} />

      {filtered && (
        <p role="status" className="text-sm text-muted-fg">
          <b className="font-semibold text-fg tabular-nums">
            {visible.length} de {rows.length}
          </b>{" "}
          órdenes{hint.length > 0 && ` ${hint.join(" · ")}`} ·{" "}
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="inline-flex min-h-[44px] items-center font-medium text-brand underline underline-offset-2"
          >
            Quitar filtros
          </button>
        </p>
      )}

      <div className={docked ? "grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4" : "min-w-0"}>
        <section className={CARD} aria-label="Órdenes activas">
          {visible.length === 0 ? (
            <EmptyCard
              icon={<Search aria-hidden className="h-7 w-7" />}
              title={
                filters.query.trim() ? `Ninguna orden coincide con “${filters.query.trim()}”` : "Ninguna orden coincide con estos filtros"
              }
              text="Busca por número (#128), mesa (mesa 8), mesero o cliente de domicilio."
              action={
                <Button variant="outline" className="min-h-[44px]" onClick={() => setFilters(NO_FILTERS)}>
                  Quitar filtros
                </Button>
              }
            />
          ) : (
            <OrdersTable
              rows={visible}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
              selectedId={panelRow?.id ?? null}
              onOpen={open}
              onMove={setSelectedId}
              pulsingIds={pulsingIds}
              compact={compact}
            />
          )}
        </section>

        {docked && (
          <aside
            aria-label="Detalle de la orden"
            className={`${CARD} sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto p-5`}
          >
            {panel(false) ?? (
              <EmptyCard
                icon={<ReceiptText aria-hidden className="h-6 w-6" />}
                title="Selecciona una orden"
                text="El detalle aparece aquí sin salir de la lista."
              />
            )}
          </aside>
        )}
      </div>

      {!docked && (
        <DialogPrimitive.Root open={overlayOpen && Boolean(panelRow)} onOpenChange={setOverlayOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              aria-labelledby={titleId}
              aria-describedby={undefined}
              onEscapeKeyDown={(event) => {
                if (confirming) {
                  event.preventDefault()
                  setConfirming(false)
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                focusRow(panelRow?.id ?? selectedId ?? undefined)
              }}
              className="fixed inset-0 z-50 overflow-y-auto bg-canvas p-5 shadow-elevated sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] sm:border-l sm:border-line"
            >
              <DialogPrimitive.Title className="sr-only">Detalle de la orden</DialogPrimitive.Title>
              {panel(true)}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </div>
  )
}
