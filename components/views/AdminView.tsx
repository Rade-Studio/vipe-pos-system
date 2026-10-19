"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Order, Profile } from "@/types"
import { useOrderStore } from "@/store/useOrderStore"
import { orderService, tableService } from "@/lib/supabase/service"
import { log } from "@/lib/log"
import { useToast } from "@/hooks/use-toast"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { hasTable, isDeliveryOrder, orderTypeFromRow } from "@/lib/delivery/kitchen"
import { mergeOrdersList, wireRowToPartialOrder, type OrderChange } from "@/lib/realtime/order-merge"
import { AdminShell } from "@/components/admin/shell/AdminShell"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { OverviewPage } from "@/components/admin/admin-pages/OverviewPage"
import { OrdersPage } from "@/components/admin/admin-pages/OrdersPage"
import { TablesPage } from "@/components/admin/admin-pages/TablesPage"
import { CashPage } from "@/components/admin/admin-pages/CashPage"
import { MenuPage } from "@/components/admin/admin-pages/MenuPage"
import { FormulasPage } from "@/components/admin/formulas/FormulasPage"
import { ItemsPage } from "@/components/admin/stock/ItemsPage"
import { MovementsPage } from "@/components/admin/stock/MovementsPage"
import { LocationsPage } from "@/components/admin/stock/LocationsPage"
import { PurchasesPage } from "@/components/admin/purchasing/PurchasesPage"
import { ProductionPage } from "@/components/admin/production/ProductionPage"
import { CountsPage } from "@/components/admin/counts/CountsPage"
import { BusinessSettings } from "@/components/admin/settings/BusinessSettings"
import { TaxSettings } from "@/components/admin/settings/TaxSettings"
import { InventorySettings } from "@/components/admin/settings/InventorySettings"
import {
  DeliverySettings,
  PaymentMethodsSettings,
  StaffSettings,
} from "@/components/admin/settings/ManagedSettings"
import { useHashSection } from "@/hooks/use-hash-section"
import { getAdminSection, isAdminSectionId, type AdminSectionId } from "@/lib/admin/navigation"
import {
  adminOrdersQueryKey,
  fetchActiveAdminOrders,
  gridOrdersFromStore,
  mergeOrderLists,
  withoutOrder,
  type AdminOrder,
} from "@/lib/admin/orders"

export { ActiveOrdersGrid } from "@/components/admin/admin-pages/ActiveOrdersGrid"

interface AdminViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

/** Stable empty array: `useQuery` defaults must not be a new identity per render. */
const EMPTY_ORDERS: AdminOrder[] = []

export function AdminView({ profile, onChangeProfile, authRole }: AdminViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())

  // Which admin section is open (URL hash, see lib/admin/navigation.ts).
  // T9 (S1): the dashboard reads and the active-orders read are gated on it,
  // so nothing loads for a section nobody is looking at, and everything that
  // IS open is served from the query cache.
  const [section, navigate] = useHashSection()
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

  // Añadir estados para el manejo de realtime
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false)
  const [newOrdersCount, setNewOrdersCount] = useState<number>(0)

  const handleChangeRegisterDetails = (registerDate: Date) => {
    setSelectedDate(registerDate)
  }

  const storeOrders = useOrderStore((s) => s.orders)

  // The grid list: the store orders the admin listed before (kitchen, delivered
  // and paid) plus everything the query read, de-duplicated by id and memoised.
  const combinedActiveOrders = useMemo(
    () => mergeOrderLists(gridOrdersFromStore(storeOrders), adminOrdersData),
    [storeOrders, adminOrdersData],
  )

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

  // Pages link to each other by section id (e.g. a preparation's "Producir").
  const navigateTo = (sectionId: string) => {
    if (isAdminSectionId(sectionId)) navigate(sectionId)
  }

  const renderSection = (id: AdminSectionId) => {
    const meta = getAdminSection(id)

    switch (id) {
      case "overview":
        return <OverviewPage description={meta.description} activeOrders={combinedActiveOrders} />
      case "orders":
        return (
          <OrdersPage
            description={meta.description}
            orders={combinedActiveOrders}
            isLoading={isLoadingActiveOrders}
            isFetching={isFetchingActiveOrders}
            realtimeConnected={realtimeConnected}
            newOrdersCount={newOrdersCount}
            onRefresh={handleRefreshActiveOrders}
            onDelete={handleDeleteOrder}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
          />
        )
      case "tables":
        return <TablesPage description={meta.description} />
      case "cash":
        return (
          <CashPage
            description={meta.description}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            onRegisterDate={handleChangeRegisterDetails}
          />
        )
      case "menu":
        return <MenuPage description={meta.description} />
      case "formulas":
        return <FormulasPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/items":
        return <ItemsPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/movements":
        return <MovementsPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/locations":
        return <LocationsPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/purchases":
        return <PurchasesPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/production":
        return <ProductionPage description={meta.description} onNavigate={navigateTo} />
      case "inventory/counts":
        return <CountsPage description={meta.description} onNavigate={navigateTo} />
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
