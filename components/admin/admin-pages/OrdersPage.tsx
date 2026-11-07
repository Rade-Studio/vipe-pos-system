"use client"

import { format, isSameDay } from "date-fns"
import { es } from "date-fns/locale"
import { RefreshCw } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { CancelledOrdersTable } from "@/components/admin/orders/CancelledOrdersTable"
import type { VoidResult } from "@/components/voids/VoidFlow"
import { localDayKey } from "@/lib/admin/dates"
import { getCancelledOrders } from "@/lib/api/orders"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"
import { useCompletedOrders } from "@/components/admin/orders/use-completed-orders"
import { Chip, Eyebrow, focusRing } from "@/components/cashier/cashier-ui"
import { useOrderRows, useTickingNow } from "@/components/admin/orders/use-order-rows"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { ordersSummary, type AdminOrder } from "@/lib/admin/orders"
import { ActiveOrdersGrid } from "./ActiveOrdersGrid"

interface OrdersPageProps {
  description: string
  orders: AdminOrder[]
  isLoading: boolean
  isFetching: boolean
  realtimeConnected: boolean
  newOrdersCount: number
  onRefresh: () => void
  /** F3: a cancellation or void was stored through the step sheet. */
  onVoided: (result: VoidResult) => void
  /** Opens admin Anulaciones. */
  onOpenAudit?: () => void
  selectedDate: Date | undefined
  onDateChange: (date: Date | undefined) => void
}

export const cancelledOrdersQueryKey = (day: string) => ["orders", "cancelled", day] as const

const TAB_CLASS = cn(
  "inline-flex min-h-[40px] flex-1 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-sm font-medium text-muted-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm sm:flex-none",
  focusRing,
)

/**
 * T28 — admin Órdenes (design/admin-orders/01-tabla-densa-con-panel.html):
 * date eyebrow, summary line, Activas | Completadas tabs with counts, the
 * realtime chip and Actualizar; "Activas" is the dense table with its panel.
 */
export function OrdersPage({
  description,
  orders,
  isLoading,
  isFetching,
  realtimeConnected,
  newOrdersCount,
  onRefresh,
  onVoided,
  onOpenAudit = () => {},
  selectedDate,
  onDateChange,
}: OrdersPageProps) {
  const nowMs = useTickingNow(true, 10_000)
  const rows = useOrderRows(orders, nowMs)
  const { orders: completed } = useCompletedOrders(selectedDate)
  const today = new Date(nowMs)
  const day = localDayKey(selectedDate ?? today)
  const cancelled = useQuery({ queryKey: cancelledOrdersQueryKey(day), queryFn: () => getCancelledOrders(day) })
  const cancelledLabel = !selectedDate || isSameDay(selectedDate, today) ? "Canceladas" : `Canceladas ${format(selectedDate, "dd/MM")}`
  const completedLabel =
    !selectedDate || isSameDay(selectedDate, today) ? "Completadas hoy" : `Completadas ${format(selectedDate, "dd/MM")}`

  return (
    <Tabs defaultValue="active" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Eyebrow className="text-brand-strong tracking-[0.2em]">{format(today, "EEEE d 'de' MMMM", { locale: es })}</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Órdenes</h1>
          <p className="text-sm text-muted-fg">
            {isLoading && orders.length === 0 ? description : ordersSummary(rows)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {realtimeConnected && (
            <Chip tone="ok" dot>
              Tiempo real
            </Chip>
          )}
          <Button variant="outline" className="min-h-[44px]" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw aria-hidden className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
            <span>Actualizar</span>
            {newOrdersCount > 0 && (
              <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground tabular-nums">
                {newOrdersCount}
              </span>
            )}
          </Button>
          <TabsList className="h-auto w-full rounded-pill border border-line bg-surface-2 p-1 sm:w-auto">
            <TabsTrigger value="active" className={TAB_CLASS}>
              Activas <span className="text-xs tabular-nums text-muted-fg">{rows.length}</span>
            </TabsTrigger>
            <TabsTrigger value="completed" className={TAB_CLASS}>
              {completedLabel} <span className="text-xs tabular-nums text-muted-fg">{completed.length}</span>
            </TabsTrigger>
            <TabsTrigger value="cancelled" className={TAB_CLASS}>
              {cancelledLabel} <span className="text-xs tabular-nums text-muted-fg">{cancelled.data?.length ?? 0}</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="active" className="mt-0 min-w-0">
        <ActiveOrdersGrid orders={orders} isLoading={isLoading} onVoided={onVoided} onRefresh={onRefresh} />
      </TabsContent>
      <TabsContent value="completed" className="mt-0 min-w-0">
        <CompletedOrdersTable
          selectedDate={selectedDate}
          toolbar={<DatePicker date={selectedDate} onDateChange={onDateChange} />}
        />
      </TabsContent>
      <TabsContent value="cancelled" className="mt-0 min-w-0 space-y-3">
        <DatePicker date={selectedDate} onDateChange={onDateChange} />
        <CancelledOrdersTable
          orders={cancelled.data ?? []}
          isLoading={cancelled.isLoading}
          isError={cancelled.isError}
          onOpenAudit={onOpenAudit}
        />
      </TabsContent>
    </Tabs>
  )
}
