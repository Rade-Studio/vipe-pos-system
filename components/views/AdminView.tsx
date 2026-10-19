"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Order, Profile } from "@/types"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useShallow } from "zustand/react/shallow"
import { useOrderStore } from "@/store/useOrderStore"
import { SalesChart } from "@/components/admin/SalesChart"
import { PopularDishesChart } from "@/components/admin/PopularDishesChart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderCard } from "@/components/pos/OrderCard"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"
import { IngredientList } from "@/components/admin/inventory/IngredientList"
import { CategoryList } from "@/components/admin/menu/CategoryList"
import { DishList } from "@/components/admin/menu/DishList"
import { DatePicker } from "@/components/ui/date-picker"
import { RegisterHistoryTable } from "@/components/cashier/RegisterHistoryTable"
import { CashRegisterSummary } from "@/components/admin/CashRegisterSummary"
import { TransactionsByRegisterId } from "@/components/admin/TransactionsByRegisterId"
import { orderService } from "@/lib/supabase/service"
import { dashboardService } from "@/lib/supabase/dashboard-service"
import { log } from "@/lib/log"
import { AlertCircle, ChefHat, DollarSign, RefreshCw, Table2, Users } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import { LowStockIngredients } from "@/components/admin/inventory/LowStockIngredients"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
// Importar el servicio realtime
import { realtimeService } from "@/lib/supabase/realtime-service"
import { hasTable, isDeliveryOrder, orderTypeFromRow } from "@/lib/delivery/kitchen"
import { mergeOrdersList, wireRowToPartialOrder, type OrderChange } from "@/lib/realtime/order-merge"
import { PromotionList } from "@/components/admin/promotions/PromotionList"
import { tableService } from "@/lib/supabase/service"
import { AdminShell } from "@/components/admin/shell/AdminShell"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { StatCard } from "@/components/admin/common/StatCard"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { BusinessSettings } from "@/components/admin/settings/BusinessSettings"
import { TaxSettings } from "@/components/admin/settings/TaxSettings"
import { InventorySettings } from "@/components/admin/settings/InventorySettings"
import {
  DeliverySettings,
  PaymentMethodsSettings,
  StaffSettings,
} from "@/components/admin/settings/ManagedSettings"
import { useHashSection } from "@/hooks/use-hash-section"
import { getAdminSection, type AdminSectionId } from "@/lib/admin/navigation"
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

  // Which admin section is open (URL hash, see lib/admin/navigation.ts).
  // T9 (S1): the dashboard reads and the active-orders read are gated on it,
  // so nothing loads for a section nobody is looking at, and everything that
  // IS open is served from the query cache.
  const [section, navigate] = useHashSection()
  const isDashboardOpen = section === "overview"
  const isOrdersTabOpen = section === "orders"

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
    // Only the Órdenes section renders this list, so only it needs the read.
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

  const renderDashboard = () =>
    isDashboardLoading ? (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-7 w-24" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="h-64">
                <Skeleton className="h-full w-full rounded-md" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    ) : (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Ventas del Mes"
            icon={DollarSign}
            value={formatCurrency(monthSales)}
            hint={new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
          />
          <StatCard
            title="Órdenes en Cocina"
            icon={ChefHat}
            value={kitchenOrdersCount}
            hint="Pendientes de preparación"
          />
          <StatCard
            title="Mesas Disponibles"
            icon={Table2}
            value={`${availableTables} / ${totalTables}`}
            hint="Listas para asignar"
          />
          <StatCard
            title="Meseros Activos"
            icon={Users}
            value={activeWaiters}
            hint={`${assignedTables} mesas asignadas`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SalesChart data={dailySales} />
          <PopularDishesChart data={popularDishes} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <AlertCircle className="h-4 w-4 mr-2 text-destructive" />
              Alertas de Inventario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LowStockIngredients />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado de Mesas</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {[
                  ["Disponibles", tableStatusCounts.available],
                  ["Reservadas", tableStatusCounts.reserved],
                  ["En cocina", tableStatusCounts.kitchen],
                  ["Servidas", tableStatusCounts.served],
                ].map(([label, count]) => (
                  <div key={label} className="flex justify-between items-center">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Órdenes Activas</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">En cocina</dt>
                  <dd className="font-medium tabular-nums">{kitchenCount}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">Entregadas (pendientes de pago)</dt>
                  <dd className="font-medium tabular-nums">{deliveredCount}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">Completadas hoy</dt>
                  <dd className="font-medium tabular-nums">{paidTodayCount}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 xl:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Meseros Activos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {profiles
                  ?.filter((p) => p.role === "waiter")
                  .map((waiter) => {
                    const assignedTablesCount = assignedTableCountByWaiter[waiter.id] ?? 0
                    return (
                      <div key={waiter.id} className="flex justify-between items-center rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium">{waiter.name}</span>
                        <Badge variant={assignedTablesCount > 0 ? "default" : "secondary"}>
                          {assignedTablesCount > 0 ? `${assignedTablesCount} mesas` : "Disponible"}
                        </Badge>
                      </div>
                    )
                  })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )

  const refreshButton = (
    <div className="flex items-center gap-3">
      {realtimeConnected && (
        <span className="flex items-center text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2 mr-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Tiempo real activo
        </span>
      )}
      <Button variant="outline" size="sm" onClick={handleRefreshActiveOrders} disabled={isFetchingActiveOrders}>
        <RefreshCw className={`h-4 w-4 mr-2 ${isFetchingActiveOrders ? "animate-spin" : ""}`} />
        <span>Actualizar</span>
        {newOrdersCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-destructive text-destructive-foreground rounded-full">
            {newOrdersCount}
          </span>
        )}
      </Button>
    </div>
  )

  const dateFilter = (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Fecha</span>
      <DatePicker date={selectedDate} onDateChange={setSelectedDate} />
    </div>
  )

  const renderSection = (id: AdminSectionId) => {
    const meta = getAdminSection(id)

    switch (id) {
      case "overview":
        return (
          <>
            <PageHeader title="Resumen" description={meta.description} />
            {renderDashboard()}
          </>
        )
      case "orders":
        return (
          <>
            <PageHeader title="Órdenes" description={meta.description} />
            <Tabs defaultValue="active">
              <TabsList className="mb-4">
                <TabsTrigger value="active">Activas</TabsTrigger>
                <TabsTrigger value="completed">Completadas</TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold">Órdenes en Cocina y Servidas</h2>
                  {refreshButton}
                </div>
                <ActiveOrdersGrid
                  orders={combinedActiveOrders}
                  isLoading={isLoadingActiveOrders}
                  onDelete={handleDeleteOrder}
                  onRefresh={handleRefreshActiveOrders}
                />
              </TabsContent>
              <TabsContent value="completed" className="space-y-4">
                {dateFilter}
                <CompletedOrdersTable selectedDate={selectedDate} />
              </TabsContent>
            </Tabs>
          </>
        )
      case "tables":
        return (
          <>
            <PageHeader title="Mesas" description={meta.description} />
            <TableManagementPanel />
          </>
        )
      case "cash":
        return (
          <>
            <PageHeader title="Caja" description={meta.description} actions={dateFilter} />
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
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Historial de Aperturas de Caja</h2>
              <RegisterHistoryTable changeRegisterDetails={handleChangeRegisterDetails} />
            </section>
          </>
        )
      case "menu":
        return (
          <>
            <PageHeader title="Menú" description={meta.description} />
            <div className="space-y-6">
              <CategoryList />
              <DishList />
              <PromotionList />
            </div>
          </>
        )
      case "inventory/items":
        return (
          <>
            <PageHeader title="Artículos" description={meta.description} />
            <IngredientList />
          </>
        )
      case "settings/business":
        return <BusinessSettings />
      case "settings/taxes":
        return <TaxSettings />
      case "settings/inventory":
        return <InventorySettings />
      case "settings/payment-methods":
        return <PaymentMethodsSettings />
      case "settings/delivery":
        return <DeliverySettings />
      case "settings/staff":
        return <StaffSettings />
      default:
        // Fórmulas and the inventory logistics modules arrive in later tasks
        // of odd/tasks/admin-dashboard-inventario.md.
        return (
          <>
            <PageHeader title={meta.label} description={meta.description} />
            <EmptyState
              title="Módulo en construcción"
              description="Este módulo llega con la nueva logística de inventario y fórmulas."
            />
          </>
        )
    }
  }

  return (
    <AdminShell
      profile={profile}
      authRole={authRole}
      onChangeProfile={onChangeProfile}
      section={section}
      onNavigate={navigate}
    >
      {renderSection(section)}
    </AdminShell>
  )
}
