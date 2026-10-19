"use client"

import { RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AdminOrder } from "@/lib/admin/orders"
import { ActiveOrdersGrid } from "./ActiveOrdersGrid"

interface OrdersPageProps {
  description: string
  orders: AdminOrder[]
  isLoading: boolean
  isFetching: boolean
  realtimeConnected: boolean
  newOrdersCount: number
  onRefresh: () => void
  onDelete: (orderId: string) => void
  selectedDate: Date | undefined
  onDateChange: (date: Date | undefined) => void
}

export function OrdersPage({
  description,
  orders,
  isLoading,
  isFetching,
  realtimeConnected,
  newOrdersCount,
  onRefresh,
  onDelete,
  selectedDate,
  onDateChange,
}: OrdersPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Órdenes"
        description={description}
        actions={
          <>
            {realtimeConnected && (
              <span className="flex items-center text-xs text-muted-foreground">
                <span className="relative mr-1.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Tiempo real activo
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span>Actualizar</span>
              {newOrdersCount > 0 && (
                <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground tabular-nums">
                  {newOrdersCount}
                </span>
              )}
            </Button>
          </>
        }
      />

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList className={segmentedListClass}>
          <TabsTrigger value="active" className={segmentedTriggerClass}>
            Activas
          </TabsTrigger>
          <TabsTrigger value="completed" className={segmentedTriggerClass}>
            Completadas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-0">
          <ActiveOrdersGrid orders={orders} isLoading={isLoading} onDelete={onDelete} onRefresh={onRefresh} />
        </TabsContent>
        <TabsContent value="completed" className="mt-0">
          <CompletedOrdersTable
            selectedDate={selectedDate}
            toolbar={<DatePicker date={selectedDate} onDateChange={onDateChange} />}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
