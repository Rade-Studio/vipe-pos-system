"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Order, Profile } from "@/types"
import { Header } from "@/components/layout/Header"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useShallow } from "zustand/react/shallow"
import { useOrderStore } from "@/store/useOrderStore"
import { SalesChart } from "@/components/admin/SalesChart"
import { PopularDishesChart } from "@/components/admin/PopularDishesChart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderCard } from "@/components/pos/OrderCard"
import { ConfigurationPanel } from "@/components/admin/ConfigurationPanel"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"
import { IngredientList } from "@/components/admin/inventory/IngredientList"
import { CategoryList } from "@/components/admin/menu/CategoryList"
import { DishList } from "@/components/admin/menu/DishList"
import { WaiterList } from "@/components/admin/staff/WaiterList"
import { DatePicker } from "@/components/ui/date-picker"
import { CashRegisterStatus } from "@/components/cashier/CashRegisterStatus"
import { RegisterHistoryTable } from "@/components/cashier/RegisterHistoryTable"
import { CashRegisterSummary } from "@/components/admin/CashRegisterSummary"
import { TransactionsByRegisterId } from "@/components/admin/TransactionsByRegisterId"
import { orderService } from "@/lib/supabase/service"
import { dashboardService } from "@/lib/supabase/dashboard-service"
import { log } from "@/lib/log"
import { AlertCircle, RefreshCw } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import { LowStockIngredients } from "@/components/admin/inventory/LowStockIngredients"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
// Importar el servicio realtime
import { realtimeService } from "@/lib/supabase/realtime-service"
import { hasTable, isDeliveryOrder, orderTypeFromRow } from "@/lib/delivery/kitchen"
import { mergeOrdersList, wireRowToPartialOrder, type OrderChange } from "@/lib/realtime/order-merge"
import { PromotionList } from "@/components/admin/promotions/PromotionList"
import { tableService } from "@/lib/supabase/service"
import { PaymentMethodsManager } from "@/components/admin/payment-methods/PaymentMethodsManager"
import { CouriersManager } from "@/components/admin/couriers/CouriersManager"
import { DeliveryFeeSetting } from "@/components/admin/couriers/DeliveryFeeSetting"
import {
  adminOrdersQueryKey,
  countOrdersByStatus,
  countPaidOrdersOn,
  fetchActiveAdminOrders,
  gridOrdersFromStore,
  mergeOrderLists,
  newOrderIdsAt,
  withoutOrder,
  type AdminOrder,
} from "@/lib/admin/orders"
import {
  DAILY_SALES_DAYS,
  DASHBOARD_STALE_MS,
  POPULAR_DISHES_DAYS,
  POPULAR_DISHES_LIMIT,
  dashboardDailySalesKey,
  dashboardKitchenOrdersKey,
  dashboardMonthSalesKey,
  dashboardPopularDishesKey,
} from "@/lib/admin/dashboard"
import { daysAgoIso, monthStartIso, startOfLocalDayMs } from "@/lib/admin/dates"

interface AdminViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

/** Stable empty arrays: `useQuery` defaults must not be a new identity per render. */
const EMPTY_ORDERS: AdminOrder[] = []
const EMPTY_DAILY_SALES: never[] = []
const EMPTY_POPULAR_DISHES: never[] = []

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

/**
 * "Órdenes en Cocina y Servidas": the card grid, its first-load skeleton and its
 * empty state. Split out of `AdminView` so the two invariants this task is about
 * — a refresh never blanks the grid, and a card never pulses forever — are
 * testable without the whole panel.
 */
export function ActiveOrdersGrid({ orders, isLoading, onDelete, onRefresh }: ActiveOrdersGridProps) {
  const profiles = useProfileStore((s) => s.profiles)
  const nowMs = useTickingNow(true, 10_000)

  // The pulse set is recomputed from the data and the clock, never from the
  // render timestamp.
  const pulsingOrderIds = useMemo(() => newOrderIdsAt(orders, nowMs), [orders, nowMs])

  if (isLoading && orders.length === 0) {
    return (
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="admin-orders-skeleton"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex justify-between">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <Skeleton className="h-9 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-10 bg-muted/20 rounded-lg">
        <p className="text-muted-foreground">No hay órdenes activas en este momento</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          <span>Verificar nuevamente</span>
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

export function AdminView({ profile, onChangeProfile, authRole }: AdminViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())

  // Which top-level tab is open. T9 (S1): the dashboard reads and the
  // active-orders read are gated on it, so nothing loads for a tab nobody is
  // looking at, and everything that IS open is served from the query cache.
  const [activeTab, setActiveTab] = useState<string>("dashboard")
  const isDashboardOpen = activeTab === "dashboard"
  const isOrdersTabOpen = activeTab === "orders"

  const { toast } = useToast()
  const queryClient = useQueryClient()

  // The ONE active-orders read (it replaces `fetchAdminOrders`,
  // `loadActiveOrdersFromDB` and the store's three-call `loadOrders`).
  const {
    data: adminOrdersData = EMPTY_ORDERS,
    isLoading: isLoadingActiveOrders,
    isFetching: isFetchingActiveOrders,
    isError: isActiveOrdersError,
    refetch: refetchActiveOrders,
  } = useQuery<AdminOrder[]>({
    queryKey: adminOrdersQueryKey,
    queryFn: fetchActiveAdminOrders,
    // Only the Órdenes tab renders this list, so only that tab needs the read.
    enabled: isOrdersTabOpen,
    staleTime: 15_000,
  })

  useEffect(() => {
    if (!isActiveOrdersError) return
    log.error("Error al cargar órdenes activas:", { error: "fetchActiveAdminOrders failed" })
    toast({
      title: "Error",
      description: "No se pudieron cargar las órdenes activas",
      variant: "destructive",
    })
  }, [isActiveOrdersError, toast])

  // Dashboard reads: four independent queries, so React Query runs them in
  // parallel and each one is cached and skipped while the tab is closed. The
  // tables / waiters numbers are NOT read again here: the shell already loaded
  // both for the admin (lib/shell/startup-loads.ts) and the two cards below the
  // charts render from those same stores.
  const monthStart = monthStartIso(new Date())
  const popularDishesSince = daysAgoIso(new Date(), POPULAR_DISHES_DAYS)

  const { data: monthSales = 0, isLoading: isLoadingMonthSales } = useQuery({
    queryKey: dashboardMonthSalesKey(monthStart),
    queryFn: () => dashboardService.getMonthSales(monthStart),
    enabled: isDashboardOpen,
    staleTime: DASHBOARD_STALE_MS,
  })
  const { data: kitchenOrdersCount = 0, isLoading: isLoadingKitchenOrders } = useQuery({
    queryKey: dashboardKitchenOrdersKey(),
    queryFn: () => dashboardService.countOrdersByStatus("kitchen"),
    enabled: isDashboardOpen,
    staleTime: DASHBOARD_STALE_MS,
  })
  const { data: dailySales = EMPTY_DAILY_SALES, isLoading: isLoadingDailySales } = useQuery({
    queryKey: dashboardDailySalesKey(DAILY_SALES_DAYS),
    queryFn: () => dashboardService.getDailySales(DAILY_SALES_DAYS),
    enabled: isDashboardOpen,
    staleTime: DASHBOARD_STALE_MS,
  })
  const { data: popularDishes = EMPTY_POPULAR_DISHES, isLoading: isLoadingPopularDishes } = useQuery({
    queryKey: dashboardPopularDishesKey(POPULAR_DISHES_DAYS, POPULAR_DISHES_LIMIT),
    queryFn: () => dashboardService.getPopularDishes(POPULAR_DISHES_LIMIT, popularDishesSince),
    enabled: isDashboardOpen,
    staleTime: DASHBOARD_STALE_MS,
  })

  const isDashboardLoading =
    isLoadingMonthSales || isLoadingKitchenOrders || isLoadingDailySales || isLoadingPopularDishes

  // Añadir estados para el manejo de realtime
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false)
  const [newOrdersCount, setNewOrdersCount] = useState<number>(0)

  const handleChangeRegisterDetails = (registerDate: Date) => {
    setSelectedDate(registerDate)
  }

  // D6 Rule B: render-path counts project to primitives, never to the full
  // `tables` array — see design.md D6. Combined into one object per site so a
  // single shallow comparison covers the whole projection. `total` and
  // `assigned` come from the SAME slice the shell already loaded, so the
  // "Mesas Disponibles x / y" card no longer needs its own `tables` read.
  const tableStatusCounts = useTableStore(
    useShallow((s) => ({
      available: s.tables.filter((t) => t.status === "available").length,
      reserved: s.tables.filter((t) => t.status === "reserved").length,
      kitchen: s.tables.filter((t) => t.status === "kitchen").length,
      served: s.tables.filter((t) => t.status === "served").length,
      total: s.tables.length,
      assigned: s.tables.filter((t) => t.waiter).length,
    })),
  )
  const availableTables = tableStatusCounts.available
  const totalTables = tableStatusCounts.total
  const assignedTables = tableStatusCounts.assigned
  const assignedTableCountByWaiter = useTableStore(
    useShallow((s) => {
      const counts: Record<string, number> = {}
      for (const t of s.tables) {
        if (t.waiter) counts[t.waiter] = (counts[t.waiter] ?? 0) + 1
      }
      return counts
    }),
  )
  const isTableAccessibleByWaiter = useTableStore((s) => s.isTableAccessibleByWaiter)
  const reserveTable = useTableStore((s) => s.reserveTable)
  const releaseTable = useTableStore((s) => s.releaseTable)

  const storeOrders = useOrderStore((s) => s.orders)

  const profiles = useProfileStore((s) => s.profiles)

  // "Meseros Activos": the shell loads exactly `role = waiter AND active` for
  // the admin, and the card below this one already lists that slice.
  const activeWaiters = useMemo(
    () => (profiles ?? []).filter((p) => p.role === "waiter").length,
    [profiles],
  )

  // The grid list: the store orders the admin listed before (kitchen, delivered
  // and paid) plus everything the query read, de-duplicated by id and memoised.
  const combinedActiveOrders = useMemo(
    () => mergeOrderLists(gridOrdersFromStore(storeOrders), adminOrdersData),
    [storeOrders, adminOrdersData],
  )

  // Dashboard "Órdenes Activas" counters, over the very same list the grid
  // renders (before: the store snapshot alone, refreshed only by a full reload).
  const kitchenCount = useMemo(
    () => countOrdersByStatus(combinedActiveOrders, ["kitchen"]),
    [combinedActiveOrders],
  )
  const deliveredCount = useMemo(
    () => countOrdersByStatus(combinedActiveOrders, ["delivered"]),
    [combinedActiveOrders],
  )
  const paidTodayCount = useMemo(
    () => countPaidOrdersOn(combinedActiveOrders, startOfLocalDayMs(new Date())),
    [combinedActiveOrders],
  )

  // Category mapping
  const categoryMap: Record<string, string> = {
    "1": "Entradas",
    "2": "Platos Principales",
    "3": "Postres",
    "4": "Bebidas",
    "5": "Café",
  }

  // Admin can access all tables
  const checkTableAccess = () => true

  /**
   * "Actualizar": ONE read of the active orders (the query it refetches). It
   * used to run its own `orders` query AND the store's three-call `loadOrders`,
   * and blanked the whole grid with skeletons while it did.
   */
  const handleRefreshActiveOrders = async () => {
    setNewOrdersCount(0)
    const result = await refetchActiveOrders()

    if (result.isError) {
      // Reported by the `isError` effect above, exactly once.
      return
    }

    toast({
      title: "Órdenes actualizadas",
      description: `Se han cargado ${result.data?.length ?? 0} órdenes activas`,
    })
  }

  const handleDeleteOrder = async (orderId: string) => {
    try {
      // Verificar si la orden existe
      const order = combinedActiveOrders.find((candidate) => candidate.id === orderId)
      if (!order) return

      // Eliminar la orden de la base de datos
      await orderService.deleteOrder(orderId)

      // Actualizar la lista que se está pintando (la del query, en su cache).
      // The store copy, if there is one, is dropped by the same patch.
      queryClient.setQueryData<AdminOrder[]>(
        adminOrdersQueryKey,
        (prev: AdminOrder[] | undefined) => (prev ? withoutOrder(prev, orderId) : prev),
      )
      useOrderStore.setState((state) => ({
        orders: withoutOrder(state.orders, orderId),
      }))

      // Delivery orders have no table to release.
      if (hasTable(order)) {
        await tableService.update(order.tableId, {
          status: "available",
          waiter_id: null,
        } as any)
      }

      // Mantener este toast ya que es una acción importante iniciada por el usuario
      toast({
        title: "Orden eliminada",
        description: "La orden ha sido eliminada correctamente",
      })
    } catch (error) {
      log.error("Error al eliminar la orden:", { error: String(error) })

      // Mantener este toast ya que es un error importante
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      })
    }
  }

  // Suscribirse a cambios en tiempo real
  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    const setupRealtimeSubscription = async () => {
      try {
        log.info("Configurando suscripción en tiempo real para órdenes...")

        // Función para manejar cambios en órdenes
        const handleOrderChange = async (payload: any, _isNewOrder?: boolean) => {
          log.info("Cambio en orden detectado:", { eventType: payload.eventType, newId: payload.new?.id })

          // Incrementar contador de nuevas órdenes si es una inserción
          if (payload.eventType === "INSERT") {
            setNewOrdersCount((prev) => prev + 1)

            // Solo mostrar toast para nuevas órdenes (información realmente necesaria)
            const place = isDeliveryOrder({ orderType: orderTypeFromRow(payload.new) })
              ? "Domicilio"
              : `Mesa ${payload.new.table_id}`
            toast({
              title: "Nueva orden recibida",
              description: `${place}, ${payload.new.order_items?.length || 0} productos`,
            })
          }

          // Decrementar contador de nuevas órdenes si es una eliminación
          if (payload.eventType === "DELETE") {
            setNewOrdersCount((prev) => prev - 1)

            // Mostrar toast para eliminaciones de órdenes
            toast({
              title: "Orden eliminada",
              description: `Se ha eliminado la orden #${payload.old.id.substring(0, 8)}`,
            })
          }

          // S5: replace the per-event invalidateQueries with a cache patch
          // through mergeOrdersList. D7 consequence 2: only carry the fields
          // the broadcast actually sent; mergeOrdersList's reference-stable
          // contract preserves untouched subtrees (items/bill/waiter in the
          // cache) on no-op ids.
          // `wireRowToPartialOrder` is the shared wire→app mapping; it maps
          // `orderType: orderTypeFromRow(row)` exactly like the initial-load
          // mapper, so a domicilio arriving by realtime lands in the cache
          // with its delivery flag instead of being labelled "Mesa ?"
          // (odd/tasks/domicilios.md S14).
          const conv: OrderChange = {
            eventType: payload.eventType,
            new: payload.new ? wireRowToPartialOrder(payload.new) : null,
            old: (payload.old as any)?.id ? { id: (payload.old as any).id } : null,
          }
          queryClient.setQueryData<Order[]>(adminOrdersQueryKey, (prev: Order[] | undefined) =>
            prev ? mergeOrdersList(prev, conv) : prev,
          )
        }

        // Suscribirse a cambios en órdenes
        unsubscribe = realtimeService.subscribeToOrders(handleOrderChange)
        setRealtimeConnected(true)

        // Eliminar el toast de conexión
        // toast({
        //   title: "Conectado en tiempo real",
        //   description: "Las órdenes se actualizarán automáticamente",
        // })
      } catch (error) {
        log.error("Error al configurar suscripción en tiempo real:", { error: String(error) })
        setRealtimeConnected(false)

        // Mantener este toast ya que es un error importante que el usuario debe conocer
        toast({
          title: "Error de conexión",
          description: "No se pudo establecer la conexión en tiempo real",
          variant: "destructive",
        })
      }
    }

    setupRealtimeSubscription()

    // Limpiar suscripción al desmontar (sin mostrar toast)
    return () => {
      if (unsubscribe) {
        log.info("Cancelando suscripción en tiempo real")
        unsubscribe()
        setRealtimeConnected(false)
      }
    }
  }, [toast])

  return (
    <div className="flex flex-col h-screen p-4">
      <Header profile={profile} onChangeProfile={onChangeProfile} authRole={authRole} title="Panel de Administración" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="tables">Mesas</TabsTrigger>
          <TabsTrigger value="orders">Órdenes</TabsTrigger>
          <TabsTrigger value="cash">Caja</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          {isDashboardLoading ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton className="h-5 w-32" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-24 mb-1" />
                      <Skeleton className="h-4 w-32" />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-40" />
                    </CardHeader>
                    <CardContent className="h-64">
                      <div className="flex items-center justify-center h-full">
                        <Skeleton className="h-full w-full rounded-md" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <Skeleton className="h-5 w-32 mb-2" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                            <Skeleton className="h-6 w-6 rounded-full" />
                          </div>
                          <div className="mt-4">
                            <Skeleton className="h-4 w-full mb-2" />
                            <Skeleton className="h-4 w-3/4" />
                          </div>
                          <Skeleton className="h-8 w-full mt-4 rounded-md" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Resumen general */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Ventas del Mes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(monthSales)}</div>
                    <p className="text-xs text-muted-foreground">
                      {new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Órdenes en Cocina</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kitchenOrdersCount}</div>
                    <p className="text-xs text-muted-foreground">Pendientes de preparación</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Mesas Disponibles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {availableTables} / {totalTables}
                    </div>
                    <p className="text-xs text-muted-foreground">Listas para asignar</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Meseros Activos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{activeWaiters}</div>
                    <p className="text-xs text-muted-foreground">{assignedTables} mesas asignadas</p>
                  </CardContent>
                </Card>
              </div>

              {/* Gráficas 2 columnas la primera con 3 partes y la segunda con 1 partes */}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SalesChart data={dailySales} />
                <PopularDishesChart data={popularDishes} />
              </div>

              {/* Alertas de inventario */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
                    Alertas de Inventario
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LowStockIngredients />
                </CardContent>
              </Card>

              {/* Estado de mesas y meseros */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Estado de Mesas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span>Disponibles:</span>
                        <span className="font-medium">{tableStatusCounts.available}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Reservadas:</span>
                        <span className="font-medium">{tableStatusCounts.reserved}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>En cocina:</span>
                        <span className="font-medium">{tableStatusCounts.kitchen}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Servidas:</span>
                        <span className="font-medium">{tableStatusCounts.served}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Meseros Activos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {profiles
                        ?.filter((p) => p.role === "waiter")
                        .map((waiter) => {
                          const assignedTablesCount = assignedTableCountByWaiter[waiter.id] ?? 0
                          return (
                            <div
                              key={waiter.id}
                              className="flex justify-between items-center p-2 rounded-md bg-muted/50"
                            >
                              <span className="font-medium">{waiter.name}</span>
                              <div className="flex items-center">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs ${assignedTablesCount > 0 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"}`}
                                >
                                  {assignedTablesCount > 0 ? `${assignedTablesCount} mesas` : "Disponible"}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Órdenes activas */}
              <Card>
                <CardHeader>
                  <CardTitle>Órdenes Activas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>En cocina:</span>
                      <span className="font-medium">{kitchenCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Entregadas (pendientes de pago):</span>
                      <span className="font-medium">{deliveredCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Completadas hoy:</span>
                      <span className="font-medium">{paidTodayCount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tables">
          <div className="space-y-6">
            {/* Panel de gestión de mesas */}
            <TableManagementPanel />
          </div>
        </TabsContent>

        <TabsContent value="orders">
          <Tabs defaultValue="active">
            <TabsList className="mb-4">
              <TabsTrigger value="active">Órdenes Activas</TabsTrigger>
              <TabsTrigger value="completed">Órdenes Completadas</TabsTrigger>
            </TabsList>

            <TabsContent value="active">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Órdenes en Cocina y Servidas</h2>
                <div className="flex items-center gap-2">
                  {realtimeConnected && (
                    <span className="flex items-center text-xs text-green-600 dark:text-green-400">
                      <span className="relative flex h-2 w-2 mr-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Tiempo real activo
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshActiveOrders}
                    disabled={isFetchingActiveOrders}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isFetchingActiveOrders ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                    {newOrdersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                        {newOrdersCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              <ActiveOrdersGrid
                orders={combinedActiveOrders}
                isLoading={isLoadingActiveOrders}
                onDelete={handleDeleteOrder}
                onRefresh={handleRefreshActiveOrders}
              />
            </TabsContent>

            <TabsContent value="completed">
              <div className="mb-4 flex items-center gap-2">
                <span>Filtrar por fecha:</span>
                <DatePicker date={selectedDate} onDateChange={setSelectedDate} />
              </div>
              <CompletedOrdersTable selectedDate={selectedDate} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="cash">
          <div className="space-y-6">
            <div className="mb-4 flex items-center gap-2">
              <span>Filtrar por fecha:</span>
              <DatePicker date={selectedDate} onDateChange={setSelectedDate} />
            </div>

            <Tabs defaultValue="summary">
              <TabsList className="mb-4">
                <TabsTrigger value="summary">Resumen</TabsTrigger>
                <TabsTrigger value="transactions">Transacciones</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                <CashRegisterSummary selectedDate={selectedDate} />
              </TabsContent>

              <TabsContent value="transactions">
                <TransactionsByRegisterId selectedDate={selectedDate} />
              </TabsContent>
            </Tabs>

            <h2 className="text-xl font-semibold mt-8 mb-4">Historial de Aperturas de Caja</h2>
            <RegisterHistoryTable changeRegisterDetails={handleChangeRegisterDetails} />
          </div>
        </TabsContent>

        <TabsContent value="config">
          <Tabs defaultValue="menu">
            <TabsList className="mb-4">
              <TabsTrigger value="menu">Menú</TabsTrigger>
              <TabsTrigger value="inventory">Inventario</TabsTrigger>
              <TabsTrigger value="payment-methods">Métodos de pago</TabsTrigger>
              <TabsTrigger value="couriers">Repartidores</TabsTrigger>
              <TabsTrigger value="waiters">Personal</TabsTrigger>
              <TabsTrigger value="settings">Ajustes</TabsTrigger>
            </TabsList>

            <TabsContent value="menu">
              <div className="space-y-6">
                <CategoryList />
                <DishList />
                <PromotionList />
              </div>
            </TabsContent>

            <TabsContent value="inventory">
              <div className="space-y-6">
                <IngredientList />
              </div>
            </TabsContent>

            <TabsContent value="payment-methods">
              <div className="space-y-6">
                <PaymentMethodsManager />
              </div>
            </TabsContent>

            <TabsContent value="couriers">
              <div className="space-y-6">
                <CouriersManager />
                <DeliveryFeeSetting />
              </div>
            </TabsContent>

            <TabsContent value="waiters">
              <div className="space-y-6">
                <WaiterList />
              </div>
            </TabsContent>

            <TabsContent value="settings">
              <div className="space-y-6">
                <ConfigurationPanel />
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  )
}
