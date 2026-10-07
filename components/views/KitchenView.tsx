"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Profile, Order } from "@/types"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

type RealtimePayload = RealtimePostgresChangesPayload<any>
import { Header } from "@/components/layout/Header"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { OrderCard } from "@/components/pos/OrderCard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TablesSection } from "@/components/pos/TablesSection"
import { WaiterSelectionModal } from "@/components/pos/WaiterSelectionModal"
import { orderService } from "@/lib/supabase/service"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { log } from "@/lib/log"
import { useToast } from "@/hooks/use-toast"
import { Bell, RefreshCw, Wifi, WifiOff, Filter } from "lucide-react"
import { useActiveDeliveries, activeDeliveriesQueryKey } from "@/hooks/use-active-deliveries"
import { listActiveDeliveries, setDeliveryStatus } from "@/lib/supabase/delivery-service"
import type { DeliveryOrderWithBill } from "@/lib/supabase/delivery-service"
import {
  hasTable,
  isDeliveryOrder,
  matchesPlaceFilter,
  orderHeading,
  orderPlaceText,
  servedOrderMessage,
  shouldMarkDeliveryReady,
  type PlaceFilter,
} from "@/lib/delivery/kitchen"
import { DeliveryOrderBanner } from "@/components/kitchen/DeliveryOrderBanner"
import { kitchenOrderFromRow, kitchenOrdersFromRows, type DbOrderRow } from "@/lib/kitchen/order"
import {
  addNewItems,
  dropNewItems,
  mergeKitchenOrders,
  mergeNewItems,
  removeNewItems,
} from "@/lib/kitchen/hydration"
import type { KitchenItemBatch } from "@/lib/kitchen/realtime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface KitchenViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

export function KitchenView({ profile, onChangeProfile, authRole }: KitchenViewProps) {
  const [activeTab, setActiveTab] = useState<"orders" | "tables">("orders")
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [showWaiterDialog, setShowWaiterDialog] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [newOrderAlert, setNewOrderAlert] = useState(false)
  const [newOrderCount, setNewOrderCount] = useState(0)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [newItems, setNewItems] = useState<Record<string, string[]>>({}) // Mapeo de orderId -> array de itemIds nuevos
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [orderToDeliver, setOrderToDeliver] = useState<string | null>(null)
  const [filterWaiter, setFilterWaiter] = useState<string | null>(null)
  const [filterTable, setFilterTable] = useState<PlaceFilter>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // The kitchen queue, and ONLY the kitchen queue: an order that reaches the
  // kitchen with something left to cook. No `delivered` read and no read at all
  // for the tables tab (the shell owns the tables).
  const fetchKitchenOrders = async () => {
    const kitchenRows = await orderService.getByStatus("kitchen")
    return kitchenOrdersFromRows(
      kitchenRows.filter((order) => order.order_items?.some((item) => item.status === "kitchen")) as DbOrderRow[],
    )
  }

  const { data: kitchenOrdersData } = useQuery({
    queryKey: ['orders', 'kitchen'],
    queryFn: fetchKitchenOrders,
  })

  // Customer names and delivery status for the delivery orders in the queue.
  const { data: deliveries = [] } = useActiveDeliveries()
  const deliveriesRef = useRef(new Map<string, DeliveryOrderWithBill>())
  deliveriesRef.current = new Map(deliveries.map((row) => [row.delivery.orderId, row]))

  // D6 Rule C: the table-filter dropdown below (~line 950) genuinely lists every
  // non-available table, so it keeps the full-array subscription; that re-render
  // is correct, not a defect (see design.md D6). Because this legitimate Rule C
  // dependency already exists in this component, the render-path table lookups
  // that also consume `tables` (order card table numbers, the table-number
  // filter) are left on the same subscription rather than narrowed separately —
  // narrowing them would add a shallow-compare projection with zero additional
  // re-render reduction, since this component already re-renders on every table
  // write regardless. The realtime-event handlers below are handler-only reads
  // and use Rule A (`getState()`) instead, independent of this subscription.
  const tables = useTableStore((s) => s.tables)
  // Realtime handlers are bound once at mount: read tables through a ref.
  const tablesRef = useRef(tables)
  tablesRef.current = tables
  const updateTableStatus = useTableStore((s) => s.updateTableStatus)
  const assignWaiterToTable = useTableStore((s) => s.assignWaiterToTable)
  const setActiveTable = useTableStore((s) => s.setActiveTable)

  const orders = useOrderStore((s) => s.orders)
  const setOrders = useOrderStore((s) => s.setOrders)
  const addOrder = useOrderStore((s) => s.addOrder)
  const updateOrder = useOrderStore((s) => s.updateOrder)
  const removeOrder = useOrderStore((s) => s.removeOrder)
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus)

  const profiles = useProfileStore((s) => s.profiles)

  // Referencia para la función de cancelación de suscripción
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // T7: replace the queue in ONE store write that keeps the identity of every
  // order whose content did not change. The board used to `setOrders([])` and
  // re-add the orders one by one, so every refresh blanked it and every card
  // was a new element (S2). `mergeNewItems` keeps the "new product" highlights
  // of the orders that are still on the queue.
  useEffect(() => {
    if (!kitchenOrdersData) return
    setOrders(mergeKitchenOrders(useOrderStore.getState().orders, kitchenOrdersData))
    setNewItems((previous) => mergeNewItems(previous, kitchenOrdersData.map((order) => order.id)))
    kitchenOrdersData.forEach((order) => {
      realtimeService.registerItems(order.id, order.items.map((item) => item.id))
    })
  }, [kitchenOrdersData, setOrders])

  // Configurar suscripción en tiempo real al montar
  useEffect(() => {
    setupRealtimeSubscription()

    // Limpiar la suscripción al desmontar
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  // Table number (dine-in) or customer (delivery) for headings and toasts
  const placeOf = (order: Order) => ({
    orderType: order.orderType,
    tableNumber: tablesRef.current.find((t) => t.id === order.tableId)?.number ?? null,
  })
  const placeText = (order: Order) =>
    orderPlaceText(placeOf(order), deliveriesRef.current.get(order.id)?.delivery)

  // Configurar suscripción en tiempo real
  const setupRealtimeSubscription = () => {
    try {
      log.info("Configurando suscripción en tiempo real para cocina...")

      // Suscribirse a eventos de cocina. `subscribeToKitchen` does the ONE
      // order read per burst of events and hands it over here: the view never
      // reads an order again (T7).
      const unsubscribe = realtimeService.subscribeToKitchen(
        // Callback para órdenes eliminadas
        handleOrderDeleted,
        // Callback para el lote de items (y de la orden nueva)
        handleItemBatch,
        // Callback para estado de conexión
        handleConnectionStatus,
      )

      // Guardar la función de cancelación
      unsubscribeRef.current = unsubscribe

      log.info("Suscripción configurada correctamente")
    } catch (error) {
      log.error("Error al configurar suscripción en tiempo real:", { error: String(error) })
      setRealtimeConnected(false)
      toast({
        title: "Error de conexión",
        description: "No se pudo establecer la conexión en tiempo real. Las actualizaciones podrían retrasarse.",
        variant: "destructive",
      })
    }
  }

  // Manejar la eliminación de una orden (evento DELETE, sin lectura)
  const handleOrderDeleted = (payload: RealtimePayload) => {
    const orderId = (payload.old as { id?: string } | undefined)?.id
    if (!orderId) return
    log.info("Orden eliminada de cocina:", { orderId })
    removeOrder(orderId)
    setNewItems((previous) => dropNewItems(previous, orderId))
    realtimeService.unregisterOrder(orderId)
  }

  // Aplicar el lote de una orden: el servicio ya la leyó una única vez por
  // ráfaga de eventos (una orden nueva con cinco items, dos productos
  // entregados a la vez, ...), así que aquí no hay ninguna lectura: solo se
  // parchea esa orden y se ajustan los avisos de "nuevo".
  const handleItemBatch = (batch: KitchenItemBatch<DbOrderRow>) => {
    const { orderId, newItemIds, servedItemIds } = batch
    const storeOrder = kitchenOrderFromRow(batch.order)
    const known = useOrderStore.getState().orders.some((order) => order.id === orderId)

    // Lo que salió de cocina deja de estar marcado como nuevo.
    setNewItems((previous) => removeNewItems(previous, orderId, servedItemIds))

    if (!storeOrder) {
      // La orden ya no tiene nada pendiente en cocina.
      if (known) removeOrder(orderId)
      setNewItems((previous) => dropNewItems(previous, orderId))
      realtimeService.unregisterOrder(orderId)
      return
    }

    // Solo se parchea la orden del lote; las demás órdenes del panel
    // conservan su identidad. Un lote que solo trae bajas para una orden que
    // esta cocina nunca tuvo no tiene nada que pintar.
    const bringsOrder = newItemIds.length > 0 || batch.isNewOrder
    if (known) {
      updateOrder(orderId, storeOrder)
    } else if (bringsOrder) {
      addOrder(storeOrder)
    } else {
      return
    }

    if (newItemIds.length === 0) return

    setNewItems((previous) => addNewItems(previous, orderId, newItemIds))
    setNewOrderCount((previous) => previous + 1)
    setNewOrderAlert(true)

    // D6 Rule A: la etiqueta de lugar del aviso viene de
    // `placeText(storeOrder)` → `placeOf`, que lee el espejo `tablesRef`
    // (seguro en handlers), así que este toast no necesita otra suscripción.
    toast(
      known
        ? {
            title: "¡Nuevo producto en cocina!",
            description: `Se ha agregado un nuevo producto a la orden de ${placeText(storeOrder)}.`,
          }
        : {
            title: "¡Nueva orden!",
            description: `Nueva orden recibida para ${placeText(storeOrder)}.`,
          },
    )
  }

  // Manejar estado de conexión
  const handleConnectionStatus = (status: boolean) => {
    setRealtimeConnected(status)

    if (status) {
      log.info("Conexión en tiempo real establecida")
    } else {
      log.info("Conexión en tiempo real perdida")
    }
  }

  // Refrescar manualmente las órdenes
  const handleRefreshOrders = async () => {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['orders', 'kitchen'] })

      // Desactivar la alerta de nuevas órdenes al refrescar manualmente
      setNewOrderAlert(false)
      setNewOrderCount(0)

      toast({
        title: "Órdenes actualizadas",
        description: "Las órdenes se han actualizado correctamente.",
      })
    } catch (error) {
      log.error("Error al actualizar órdenes:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudieron actualizar las órdenes.",
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  // Reconectar suscripción en tiempo real
  const handleReconnect = async () => {
    try {
      // Cancelar la suscripción actual
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      // Configurar nueva suscripción
      setupRealtimeSubscription()

      // Una sola lectura de la cola: se invalida LA MISMA query del panel en
      // vez de disparar una segunda carga en paralelo (`loadKitchenOrders`,
      // que además vaciaba el store antes de re-llenarlo).
      await queryClient.invalidateQueries({ queryKey: ['orders', 'kitchen'] })

      toast({
        title: "Reconectando",
        description: "Intentando restablecer la conexión en tiempo real...",
      })
    } catch (error) {
      log.error("Error al reconectar:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudo restablecer la conexión. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  // Obtener órdenes activas con items en cocina
  const kitchenOrders = orders // Ahora usamos las órdenes que ya vienen filtradas por el store

  // Aplicar filtros a las órdenes
  const filteredOrders = kitchenOrders.filter((order) => {
    // Filtrar por mesero si hay un filtro activo
    if (filterWaiter && order.waiter !== filterWaiter) {
      return false
    }

    // Filtrar por mesa o domicilios si hay un filtro activo
    return matchesPlaceFilter(placeOf(order), filterTable)
  })

  const waiters = profiles.filter((p) => p.role === "waiter" && p.id !== "waiter-1")

  // Limpiar filtros
  const clearFilters = () => {
    setFilterWaiter(null)
    setFilterTable(null)
  }

  // Moves a delivery to "ready" once the kitchen served everything. Never
  // throws: a failure only surfaces a toast. Resolves true only when the
  // server accepted the transition.
  const markDeliveryReady = async (orderId: string): Promise<boolean> => {
    try {
      // Fresh read: the operator may have moved the delivery meanwhile.
      const rows = await queryClient.fetchQuery({
        queryKey: activeDeliveriesQueryKey,
        queryFn: () => listActiveDeliveries(),
        staleTime: 0,
      })
      const row = rows.find((r) => r.delivery.orderId === orderId)
      if (!shouldMarkDeliveryReady(row?.delivery.status)) return false
      await setDeliveryStatus({ orderId, action: "mark_ready" })
      // The transition is confirmed, so the cached row is patched in place:
      // the `invalidateQueries` that used to run in the `finally` re-read the
      // same rows the `fetchQuery` above had just read (a second read for the
      // same decision). Realtime still invalidates on the `order_deliveries`
      // UPDATE, and this keeps the board truthful even without it.
      queryClient.setQueryData<DeliveryOrderWithBill[]>([...activeDeliveriesQueryKey], (previous: DeliveryOrderWithBill[] | undefined) =>
        previous?.map((row: DeliveryOrderWithBill) =>
          row.delivery.orderId === orderId ? { ...row, delivery: { ...row.delivery, status: "ready" } } : row,
        ),
      )
      return true
    } catch (error) {
      log.error("Error al marcar el domicilio como listo:", { error: String(error) })
      toast({
        title: "Domicilio sin actualizar",
        description: "Los productos quedaron entregados, pero no se pudo marcar el domicilio como listo. Avise al operador de domicilios.",
        variant: "destructive",
      })
      return false
    }
  }

  // Closes an order whose items are all served: dine-in frees its table
  // for service, delivery moves to ready. Returns the toast text.
  const completeOrder = async (order: Order): Promise<string> => {
    await orderService.updateStatus(order.id, "delivered")
    updateOrderStatus(order.id, "delivered")
    if (hasTable(order)) updateTableStatus(order.tableId, "served")
    const delivery = isDeliveryOrder(order)
    const deliveryReady = delivery ? await markDeliveryReady(order.id) : false
    return servedOrderMessage({ delivery, deliveryReady })
  }

  // Handle marking an item as delivered (served)
  const handleMarkAsDelivered = async (orderId: string, itemId?: string) => {
    try {
      if (!itemId) {
        log.error("Se requiere el ID del item para marcarlo como entregado")
        toast({
          title: "Error",
          description: "No se pudo procesar la acción. Intente nuevamente.",
          variant: "destructive",
        })
        return
      }

      // Anunciar la escritura ANTES dearla: el evento realtime vuelve por el
      // mismo canal y el servicio lo descarta sin leer la orden otra vez
      // (el parche local de abajo ya la dejó bien).
      realtimeService.markLocalItemChanges([itemId])

      // Actualizar el estado del item a "served" en la base de datos.
      // Un rechazo (no solo `{ error }`) deja la escritura sin hacer, así que
      // la marca local se levanta en cualquier fallo; si se quedara, se
      // tragaría un cambio real posterior de este item.
      try {
        const { error } = await supabase
          .from("order_items")
          .update({ status: "served", updated_at: new Date().toISOString() })
          .eq("id", itemId)

        if (error) {
          log.error("Error al actualizar estado del item:", { error: String(error) })
          throw error
        }
      } catch (error) {
        realtimeService.unmarkLocalItemChanges([itemId])
        throw error
      }

      toast({
        title: "Producto entregado",
        description: "El producto ha sido marcado como entregado.",
      })

      realtimeService.unregisterItem(orderId, itemId)
      setNewItems((previous) => removeNewItems(previous, orderId, [itemId]))

      // Solo se parchea LA orden del item: las demás órdenes del panel
      // conservan su identidad (antes se reconstruía el array completo).
      const order = useOrderStore.getState().orders.find((o) => o.id === orderId)
      if (!order) return

      const remainingItems = order.items.filter((item) => item.id !== itemId)

      if (remainingItems.length === 0) {
        // Sin items pendientes la orden sale del panel de cocina.
        removeOrder(orderId)
        setNewItems((previous) => dropNewItems(previous, orderId))
        realtimeService.unregisterOrder(orderId)

        // Cerrar la orden (mesa servida o domicilio listo)
        const description = await completeOrder(order)

        toast({ title: isDeliveryOrder(order) ? "Domicilio actualizado" : "Mesa actualizada", description })
        return
      }

      updateOrder(orderId, { ...order, items: remainingItems })
    } catch (error) {
      log.error("Error al marcar el item como entregado:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudo marcar el producto como entregado. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  // Handle marking all items as delivered
  const handleMarkAllAsDelivered = async (orderId: string) => {
    // Guardar la orden para el diálogo de confirmación
    setOrderToDeliver(orderId)
    setShowCompleteDialog(true)
  }

  // Confirmar marcar todos los items como entregados
  const confirmMarkAllAsDelivered = async () => {
    if (!orderToDeliver) return

    try {
      // Obtener la orden del store
      const order = useOrderStore.getState().orders.find((o) => o.id === orderToDeliver)

      if (!order || order.items.length === 0) {
        log.error("Orden no encontrada o sin items")
        return
      }

      // Obtener los IDs de todos los items en estado "kitchen"
      const itemIds = order.items.map((item) => item.id)

      if (itemIds.length === 0) {
        log.info("No hay items para marcar como entregados")
        return
      }

      // Una sola escritura para toda la orden, y sus N ecos announcement:
      // esta cocina ya aplicó el cambio, así que ninguno vuelve a leer.
      realtimeService.markLocalItemChanges(itemIds)

      // Actualizar todos los items a estado "served" en la base de datos
      // (mismo criterio: cualquier fallo, incluido un rechazo, levanta las
      // marcas locales).
      try {
        const { error } = await supabase
          .from("order_items")
          .update({ status: "served", updated_at: new Date().toISOString() })
          .in("id", itemIds)

        if (error) {
          log.error("Error al actualizar estado de los items:", { error: String(error) })
          throw error
        }
      } catch (error) {
        realtimeService.unmarkLocalItemChanges(itemIds)
        throw error
      }

      realtimeService.unregisterOrder(order.id)

      // Cerrar la orden (mesa servida o domicilio listo)
      const description = await completeOrder(order)

      toast({ title: "Orden entregada", description })

      // Eliminar la orden del store ya que todos sus items han sido entregados
      removeOrder(orderToDeliver)

      // Eliminar la orden de la lista de nuevos items
      setNewItems((previous) => dropNewItems(previous, orderToDeliver))
    } catch (error) {
      log.error("Error al marcar todos los items como entregados:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudieron marcar todos los productos como entregados. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      // Limpiar el estado
      setOrderToDeliver(null)
      setShowCompleteDialog(false)
    }
  }

  // Handle table selection
  const handleTableSelect = (tableId: string | null) => {
    if (!tableId) {
      setSelectedTable(null)
      return
    }

    setSelectedTable(tableId)
    setShowWaiterDialog(true)
  }

  // Handle waiter selection
  const handleWaiterSelect = (waiterId: string) => {
    if (selectedTable && waiterId) {
      assignWaiterToTable(selectedTable, waiterId)
      setActiveTable(selectedTable)
      setShowWaiterDialog(false)
    }
  }

  // All tables are accessible from kitchen view
  const isTableAccessible = () => true

  // Desactivar la alerta de nuevas órdenes
  const handleDismissAlert = () => {
    setNewOrderAlert(false)
    setNewOrderCount(0)
  }

  return (
    <div className="flex flex-col h-screen p-4">
      <Header profile={profile} onChangeProfile={onChangeProfile} authRole={authRole} title="Cocina" />

      <Tabs defaultValue="orders" onValueChange={(value) => setActiveTab(value as "orders" | "tables")}>
        <div className="flex items-center mb-4 flex-wrap gap-2">
          <TabsList className="mr-4">
            <TabsTrigger value="orders">Órdenes Pendientes</TabsTrigger>
            <TabsTrigger value="tables">Mesas</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Indicador de conexión en tiempo real */}
            <Button
              variant="outline"
              size="sm"
              className={`flex items-center gap-2 ${!realtimeConnected ? "text-destructive" : "text-green-500"}`}
              onClick={handleReconnect}
              title={realtimeConnected ? "Conectado en tiempo real" : "Sin conexión en tiempo real"}
            >
              {realtimeConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <span className="hidden sm:inline">{realtimeConnected ? "Conectado" : "Desconectado"}</span>
            </Button>

            {/* Filtros */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  <span>Filtros</span>
                  {(filterWaiter || filterTable) && (
                    <Badge variant="secondary" className="ml-1">
                      {filterWaiter && filterTable ? "2" : "1"}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Filtrar órdenes</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mesero</DropdownMenuLabel>
                  {waiters.map((waiter) => (
                    <DropdownMenuItem
                      key={waiter.id}
                      className={filterWaiter === waiter.id ? "bg-accent" : ""}
                      onClick={() => setFilterWaiter(filterWaiter === waiter.id ? null : waiter.id)}
                    >
                      {waiter.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mesa</DropdownMenuLabel>
                  <DropdownMenuItem
                    className={filterTable === "delivery" ? "bg-accent" : ""}
                    onClick={() => setFilterTable(filterTable === "delivery" ? null : "delivery")}
                  >
                    Domicilios
                  </DropdownMenuItem>
                  {tables
                    .filter((table) => table.status !== "available")
                    .sort((a, b) => a.number - b.number)
                    .map((table) => (
                      <DropdownMenuItem
                        key={table.id}
                        className={filterTable === table.number ? "bg-accent" : ""}
                        onClick={() => setFilterTable(filterTable === table.number ? null : table.number)}
                      >
                        Mesa {table.number}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={clearFilters} disabled={!filterWaiter && !filterTable}>
                  Limpiar filtros
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {newOrderAlert && (
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2 animate-pulse"
                onClick={handleDismissAlert}
              >
                <Bell className="h-4 w-4 text-yellow-500" />
                <span>¡Nuevas órdenes!</span>
                <Badge variant="secondary" className="ml-1">
                  {newOrderCount}
                </Badge>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshOrders}
              disabled={refreshing}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span>Actualizar</span>
            </Button>
          </div>
        </div>

        <TabsContent value="orders">
          {/* Mostrar filtros activos */}
          {(filterWaiter || filterTable) && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filtros activos:</span>
              {filterWaiter && (
                <Badge variant="outline" className="flex items-center gap-1">
                  Mesero: {profiles.find((p) => p.id === filterWaiter)?.name}
                  <button className="ml-1 hover:bg-gray-200 rounded-full p-0.5" onClick={() => setFilterWaiter(null)}>
                    ×
                  </button>
                </Badge>
              )}
              {filterTable && (
                <Badge variant="outline" className="flex items-center gap-1">
                  {filterTable === "delivery" ? "Domicilios" : `Mesa: ${filterTable}`}
                  <button className="ml-1 hover:bg-gray-200 rounded-full p-0.5" onClick={() => setFilterTable(null)}>
                    ×
                  </button>
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2">
                Limpiar todos
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOrders.length === 0 ? (
              <div className="col-span-full text-center py-10 text-muted-foreground">
                {kitchenOrders.length === 0
                  ? "No hay órdenes pendientes en cocina"
                  : "No hay órdenes que coincidan con los filtros seleccionados"}
              </div>
            ) : (
              filteredOrders.map((order) => {
                const table = hasTable(order) ? tables.find((t) => t.id === order.tableId) : undefined
                const waiter = profiles?.find((p) => p.id === order.waiter)
                const card = (
                  <OrderCard
                    key={order.id}
                    order={order}
                    table={table}
                    heading={orderHeading(placeOf(order), deliveriesRef.current.get(order.id)?.delivery)}
                    waiter={waiter}
                    onMarkAsDelivered={(itemId) => handleMarkAsDelivered(order.id, itemId)}
                    onMarkAllAsDelivered={() => handleMarkAllAsDelivered(order.id)}
                    isKitchenView={true}
                    newItems={newItems[order.id] || []}
                  />
                )

                if (!isDeliveryOrder(order)) return card
                return (
                  <div key={order.id}>
                    <DeliveryOrderBanner
                      customerName={deliveriesRef.current.get(order.id)?.delivery.customerName ?? null}
                    />
                    {card}
                  </div>
                )
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="tables">
          <TablesSection
            activeTable={selectedTable}
            profile={profile}
            profiles={profiles}
            onSelectTable={handleTableSelect}
            onReserveTable={() => {}}
            onReleaseTable={() => {}}
            isTableAccessible={isTableAccessible}
          />
        </TabsContent>
      </Tabs>

      {/* Waiter Selection Dialog */}
      <WaiterSelectionModal
        open={showWaiterDialog}
        onOpenChange={setShowWaiterDialog}
        onSelect={handleWaiterSelect}
      />

      {/* Confirm Dialog for Mark All as Delivered */}
      <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar entrega</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Está seguro de que desea marcar todos los productos de esta orden como entregados?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMarkAllAsDelivered}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
