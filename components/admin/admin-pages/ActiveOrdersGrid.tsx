"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { OrderCard } from "@/components/pos/OrderCard"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { newOrderIdsAt, type AdminOrder } from "@/lib/admin/orders"

/**
 * A clock that ticks only while `enabled`.
 *
 * The "new order" pulse used to be `new Date() - createdAt < 30000` evaluated
 * inside the render of every card, so its answer depended on WHEN the render
 * happened: a card that rendered once inside the window kept
 * `animate-pulse-light` forever. The window is now a function of the data and
 * this clock, so the class always comes back off.
 */
function useTickingNow(enabled: boolean, intervalMs = 10_000): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNowMs(Date.now()), intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs])

  return nowMs
}

interface ActiveOrdersGridProps {
  orders: AdminOrder[]
  /** First load (nothing to show yet). A REFETCH keeps the cards on screen. */
  isLoading: boolean
  onDelete: (orderId: string) => void
  onRefresh: () => void
}

const GRID_CLASS = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"

/**
 * "Órdenes en Cocina y Servidas": the card grid, its first-load skeleton and its
 * empty state. Kept apart from the page so the two invariants — a refresh never
 * blanks the grid, and a card never pulses forever — are testable on their own.
 */
export function ActiveOrdersGrid({ orders, isLoading, onDelete, onRefresh }: ActiveOrdersGridProps) {
  const profiles = useProfileStore((s) => s.profiles)
  const nowMs = useTickingNow(true, 10_000)

  // The pulse set is recomputed from the data and the clock, never from the
  // render timestamp.
  const pulsingOrderIds = useMemo(() => newOrderIdsAt(orders, nowMs), [orders, nowMs])

  if (isLoading && orders.length === 0) {
    return (
      <div className={GRID_CLASS} data-testid="admin-orders-skeleton">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No hay órdenes activas en este momento"
        description="Las nuevas órdenes aparecen aquí en tiempo real."
        action={
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            <span>Verificar nuevamente</span>
          </Button>
        }
      />
    )
  }

  return (
    <div className={GRID_CLASS}>
      {orders.map((order) => {
        // D6 Rule A variant: `OrderCard` (out of scope, components/pos/*)
        // requires the full `Table` object, so a primitive projection
        // does not apply here. No subscription is taken; getState() is
        // read fresh on every render this component already performs
        // for unrelated reasons (order data), which is safe because a
        // table's `number` never changes after creation.
        const table = useTableStore.getState().getTableById(order.tableId)
        const waiter = profiles?.find((p) => p.id === order.waiter)

        return (
          <div
            key={order.id}
            className={pulsingOrderIds.has(order.id) ? "animate-pulse-light" : ""}
            data-testid={`admin-order-${order.id}`}
          >
            <OrderCard
              order={order}
              table={table}
              waiter={waiter}
              isAdmin={true}
              showActions={true}
              onDelete={onDelete}
            />
          </div>
        )
      })}
    </div>
  )
}
