"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Profile, Order } from "@/types"
import { Header } from "@/components/layout/Header"
import { AssignedCountsEntry } from "@/components/counts/AssignedCountsEntry"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { Skeleton } from "@/components/ui/skeleton"
import { getByStatus, serveItems, toOrder, type OrderDto } from "@/lib/api/orders"
import { realtimeService, type ChangeEvent } from "@/lib/api/realtime"
import { log } from "@/lib/log"
import { useToast } from "@/hooks/use-toast"
import { Bell, ChefHat, RefreshCw, Wifi, WifiOff, Filter } from "lucide-react"
import {
  useActiveDeliveries,
  activeDeliveriesQueryKey,
  refreshActiveDeliveries,
} from "@/hooks/use-active-deliveries"
import { listActiveDeliveries, setDeliveryStatus } from "@/lib/api/delivery"
import type { DeliveryOrderWithBill } from "@/lib/api/delivery"
import { applyDeliveryStatusPatch } from "@/lib/delivery/realtime"
import {
  hasTable,
  isDeliveryOrder,
  matchesPlaceFilter,
  orderPlaceText,
  servedOrderMessage,
  shouldMarkDeliveryReady,
  type PlaceFilter,
} from "@/lib/delivery/kitchen"
import { KitchenTicket } from "@/components/kitchen/KitchenTicket"
import { KitchenRail } from "@/components/kitchen/KitchenRail"
import {
  countByKind,
  kitchenThresholds,
  matchesKindFilter,
  oldestFirst,
  ticketAge,
  takeawayPlace,
  ticketStartedAt,
  type KindFilter,
} from "@/lib/kitchen/ticket"
import { cn } from "@/lib/utils"
import { kitchenOrderOf, kitchenOrdersOf, pendingItems } from "@/lib/kitchen/order"
import { orderForStation, ordersForStation, readKitchenStation, writeKitchenStation } from "@/lib/kitchen/stations"
import { listStations, STATIONS_QUERY_KEY } from "@/lib/api/stations"
import { DEFAULT_LATE_THRESHOLDS, fetchLateThresholds } from "@/lib/api/settings"
import { mergeKitchenOrders } from "@/lib/kitchen/hydration"
import type { KitchenItemBatch } from "@/lib/kitchen/realtime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  const [refreshing, setRefreshing] = useState(false)
  const [newOrderAlert, setNewOrderAlert] = useState(false)
  const [newOrderCount, setNewOrderCount] = useState(0)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [orderToDeliver, setOrderToDeliver] = useState<string | null>(null)
  const [filterWaiter, setFilterWaiter] = useState<string | null>(null)
  const [filterTable, setFilterTable] = useState<PlaceFilter>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>("all")
  // F6: the station this screen cooks for, remembered on this device (null = Todas).
  const [savedStation, setSavedStation] = useState<string | null>(() => readKitchenStation())
  // One clock for every ticket timer.
  const [now, setNow] = useState(() => Date.now())
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // The kitchen queue, and ONLY the kitchen queue: an order that reaches the
  // kitchen with something left to cook. No `delivered` read and no tables
  // read (the shell owns the tables).
  const fetchKitchenOrders = async () => kitchenOrdersOf((await getByStatus("kitchen")).map(toOrder))

  const { data: kitchenOrdersData, isLoading: loadingOrders, dataUpdatedAt } = useQuery({
    queryKey: ['orders', 'kitchen'],
    queryFn: fetchKitchenOrders,
  })

  // Late threshold (T23): read once per kitchen session; a failed read keeps
  // the default, so the rail never waits on it.
  const { data: lateThresholds } = useQuery({
    queryKey: ["config", "late-thresholds"],
    queryFn: fetchLateThresholds,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  // F6: the prep stations of the restaurant; none = no selector, the whole board.
  const { data: stations = [] } = useQuery({ queryKey: STATIONS_QUERY_KEY, queryFn: listStations, retry: false })
  const prepStations = stations.filter((station) => station.kind === "prep")
  // A remembered station that was deleted (or not loaded yet) reads as Todas.
  const station = prepStations.some((candidate) => candidate.id === savedStation) ? savedStation : null
  const chooseStation = (next: string | null) => {
    setSavedStation(next)
    writeKitchenStation(next)
  }

  const thresholds = kitchenThresholds(lateThresholds?.kitchenLateMinutes ?? DEFAULT_LATE_THRESHOLDS.kitchenLateMinutes)

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
  // was a new element (S2). "+n nuevos" is derived from the persisted send
  // time of each item (T23), so there is no in-session highlight to keep.
  useEffect(() => {
    if (!kitchenOrdersData) return
    setOrders(mergeKitchenOrders(useOrderStore.getState().orders, kitchenOrdersData))
    kitchenOrdersData.forEach((order) => {
      realtimeService.registerItems(order.id, pendingItems(order).map((item) => item.id))
    })
  }, [kitchenOrdersData, setOrders])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

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
    order.orderType === "takeaway"
      ? `el pedido para llevar de ${order.customerName ?? "un cliente"}`
      : orderPlaceText(placeOf(order), deliveriesRef.current.get(order.id)?.delivery)

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
  const handleOrderDeleted = (payload: ChangeEvent) => {
    const orderId = (payload.old as { id?: string } | undefined)?.id
    if (!orderId) return
    log.info("Orden eliminada de cocina:", { orderId })
    removeOrder(orderId)
    realtimeService.unregisterOrder(orderId)
  }

  // Aplicar el lote de una orden: el servicio ya la leyó una única vez por
  // ráfaga de eventos (una orden nueva con cinco items, dos productos
  // entregados a la vez, ...), así que aquí no hay ninguna lectura: solo se
  // parchea esa orden y se avisa de lo nuevo.
  const handleItemBatch = (batch: KitchenItemBatch<Order>) => {
    const { orderId, newItemIds } = batch
    const storeOrder = kitchenOrderOf(batch.order)
    const known = useOrderStore.getState().orders.some((order) => order.id === orderId)

    if (!storeOrder) {
      // La orden ya no tiene nada pendiente en cocina.
      if (known) removeOrder(orderId)
      realtimeService.unregisterOrder(orderId)
      return
    }

    // Solo se parchea la orden del lote; las demás conservan su identidad. Una
    // orden con items en cocina entra aunque no traiga novedades (R3).
    if (known) {
      updateOrder(orderId, storeOrder)
    } else {
      addOrder(storeOrder)
    }

    const isNew = batch.isNewOrder || !known
    if (!isNew && newItemIds.length === 0) return

    setNewOrderCount((previous) => previous + 1)
    setNewOrderAlert(true)

    // D6 Rule A: la etiqueta de lugar del aviso viene de
    // `placeText(storeOrder)` → `placeOf`, que lee el espejo `tablesRef`
    // (seguro en handlers), así que este toast no necesita otra suscripción.
    toast(
      isNew
        ? {
            title: "¡Nueva orden!",
            description: `Nueva orden recibida para ${placeText(storeOrder)}.`,
          }
        : {
            title: "¡Nuevo producto en cocina!",
            description: `Se ha agregado un nuevo producto a la orden de ${placeText(storeOrder)}.`,
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
  // The store keeps the whole kitchen queue; a station sees only its lines (F6).
  const kitchenOrders = ordersForStation(orders, station)

  // Aplicar filtros a las órdenes
  const filteredOrders = kitchenOrders.filter((order) => {
    // Filtrar por mesero si hay un filtro activo
    if (filterWaiter && order.waiter !== filterWaiter) {
      return false
    }

    // Filtrar por mesa o domicilios si hay un filtro activo
    return matchesPlaceFilter(placeOf(order), filterTable) && matchesKindFilter(order, kindFilter)
  })

  const waiters = profiles.filter((p) => p.role === "waiter" && p.id !== "waiter-1")

  // Limpiar filtros
  const clearFilters = () => {
    setFilterWaiter(null)
    setFilterTable(null)
    setKindFilter("all")
  }

  // Moves a delivery to "ready" once the kitchen served everything. Never
  // throws: a failure only surfaces a toast. Resolves true only when the
  // server accepted the transition.
  //
  // T10 (S1): this used to force a full `active-deliveries` read on EVERY
  // completed order and then invalidate the board again on the way out, so
  // serving one table cost three board reloads (read + RPC + refetch + the
  // realtime push). The shared subscription keeps that cache current — it
  // merges `order_deliveries` pushes and re-reads on a burst — so the guard
  // reads the cache, the RPC result is merged back into it, and nothing is
  // refetched. The forced read survives as the fallback for a cache that does
  // not know the order yet (the query is still loading), so the "unknown
  // status is left alone" rule keeps its meaning.
  const markDeliveryReady = async (orderId: string): Promise<boolean> => {
    let cached = queryClient.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
    let row = cached.find((r) => r.delivery.orderId === orderId)
    if (row === undefined) {
      try {
        cached = await queryClient.fetchQuery({
          queryKey: activeDeliveriesQueryKey,
          queryFn: () => listActiveDeliveries(),
          staleTime: 0,
        })
      } catch (error) {
        // A failed read is the same failure the forced read used to raise:
        // the kitchen cannot know whether the operator moved the delivery, so
        // the order stays as it is and the operator is told.
        log.error("Error al leer el estado del domicilio:", { error: String(error) })
        refreshActiveDeliveries(queryClient)
        toast({
          title: "Domicilio sin actualizar",
          description:
            "Los productos quedaron entregados, pero no se pudo marcar el domicilio como listo. Avise al operador de domicilios.",
          variant: "destructive",
        })
        return false
      }
      row = cached.find((r) => r.delivery.orderId === orderId)
    }
    if (!shouldMarkDeliveryReady(row?.delivery.status)) return false

    try {
      const moved = await setDeliveryStatus({ orderId, action: "mark_ready" })
      // Read the cache AGAIN: the merge must be applied on top of whatever the
      // cache holds NOW, not on the snapshot taken before the RPC. A push for
      // another delivery that landed during the await would otherwise be
      // reverted by this write (T10 review B1).
      const current = queryClient.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      const outcome = applyDeliveryStatusPatch(current, moved)
      if (outcome.kind === "patched") {
        queryClient.setQueryData(activeDeliveriesQueryKey, outcome.rows)
      } else if (outcome.kind === "needs-refresh") {
        refreshActiveDeliveries(queryClient)
      }
      return true
    } catch (error) {
      log.error("Error al marcar el domicilio como listo:", { error: String(error) })
      refreshActiveDeliveries(queryClient)
      toast({
        title: "Domicilio sin actualizar",
        description:
          "Los productos quedaron entregados, pero no se pudo marcar el domicilio como listo. Avise al operador de domicilios.",
        variant: "destructive",
      })
      return false
    }
  }

  // The API delivered the order when its last kitchen item was served (and
  // set its table to served): mirror that locally; a delivery moves to ready.
  // Returns the toast text.
  const completeOrder = async (order: Order): Promise<string> => {
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

      // Servir el item en el servidor. Cualquier fallo deja la escritura sin
      // hacer, así que la marca local se levanta; si se quedara, se tragaría un
      // cambio real posterior de este item.
      let served: OrderDto
      try {
        served = await serveItems(orderId, [itemId])
      } catch (error) {
        realtimeService.unmarkLocalItemChanges([itemId])
        throw error
      }

      toast({
        title: "Producto entregado",
        description: "El producto ha sido marcado como entregado.",
      })

      realtimeService.unregisterItem(orderId, itemId)

      // Solo se parchea LA orden del item: las demás órdenes del panel
      // conservan su identidad (antes se reconstruía el array completo).
      const order = useOrderStore.getState().orders.find((o) => o.id === orderId)
      if (!order) return

      // What the server still has in the kitchen for this order.
      const remaining = kitchenOrderOf(toOrder(served))

      if (!remaining) {
        // Sin items pendientes la orden sale del panel de cocina.
        removeOrder(orderId)
        realtimeService.unregisterOrder(orderId)

        // Cerrar la orden (mesa servida o domicilio listo)
        const description = await completeOrder(order)

        toast({ title: isDeliveryOrder(order) ? "Domicilio actualizado" : "Mesa actualizada", description })
        return
      }

      updateOrder(orderId, remaining)
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
      // F6: on a station screen "Entregar toda" serves only that station's lines.
      const stored = useOrderStore.getState().orders.find((o) => o.id === orderToDeliver)
      const order = stored ? orderForStation(stored, station) : null

      if (!order || pendingItems(order).length === 0) {
        log.error("Orden no encontrada o sin items")
        return
      }

      // Obtener los IDs de todos los items en estado "kitchen"
      const itemIds = pendingItems(order).map((item) => item.id)

      if (itemIds.length === 0) {
        log.info("No hay items para marcar como entregados")
        return
      }

      // Una sola escritura para toda la orden, y sus N ecos announcement:
      // esta cocina ya aplicó el cambio, así que ninguno vuelve a leer.
      realtimeService.markLocalItemChanges(itemIds)

      // Servir todos los items en una sola petición (mismo criterio: cualquier
      // fallo levanta las marcas locales).
      let served: OrderDto
      try {
        served = await serveItems(order.id, itemIds)
      } catch (error) {
        realtimeService.unmarkLocalItemChanges(itemIds)
        throw error
      }

      // Items that reached the kitchen meanwhile keep the order on the board.
      const remaining = kitchenOrderOf(toOrder(served))
      if (remaining) {
        updateOrder(order.id, remaining)
        return
      }

      realtimeService.unregisterOrder(order.id)

      // Cerrar la orden (mesa servida o domicilio listo)
      const description = await completeOrder(order)

      toast({ title: "Orden entregada", description })

      // Eliminar la orden del store ya que todos sus items han sido entregados
      removeOrder(orderToDeliver)
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

  // Desactivar la alerta de nuevas órdenes
  const handleDismissAlert = () => {
    setNewOrderAlert(false)
    setNewOrderCount(0)
  }

  // Ticket place: "Mesa N" for a table, the customer for a delivery, "PARA LLEVAR · <nombre>" for takeaway (S8).
  const ticketPlace = (order: Order) => {
    if (order.orderType === "takeaway") return takeawayPlace(order)
    if (!isDeliveryOrder(order)) return `Mesa ${placeOf(order).tableNumber ?? "?"}`
    const name = deliveriesRef.current.get(order.id)?.delivery.customerName.trim()
    return name ? name : "Domicilio"
  }

  const kindCounts = countByKind(kitchenOrders)
  const railOrders = oldestFirst(filteredOrders)
  const pendingDelivery = orderToDeliver ? kitchenOrders.find((o) => o.id === orderToDeliver) : undefined
  const lastSync = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : null
  const pill =
    "inline-flex min-h-11 flex-none snap-start items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[15px] font-medium md:px-4 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus"
  const pillState = (active: boolean) =>
    active ? "border-transparent bg-btn text-btn-foreground" : "border-line-strong text-fg-2 hover:bg-surface-2"
  const kindPills: { value: KindFilter; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "dine_in", label: "Mesas" },
    { value: "takeaway", label: "Para llevar" },
    { value: "delivery", label: "Domicilios" },
  ]

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas px-4 text-fg md:px-6">
      <Header profile={profile} onChangeProfile={onChangeProfile} authRole={authRole} title="Cocina" />
      <AssignedCountsEntry />

      <div className="-mx-4 flex min-h-0 flex-1 flex-col md:-mx-6">
        <div className="flex min-h-0 flex-1 flex-col">
          {prepStations.length > 0 && (
            <div
              role="group"
              aria-label="Estación"
              className="flex min-w-0 snap-x items-center gap-2 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] md:px-6"
            >
              <span aria-hidden="true" className="flex-none text-[13px] font-medium text-muted-fg">
                Estación
              </span>
              {[{ id: null, name: "Todas" }, ...prepStations].map((option) => (
                <button
                  key={option.id ?? "all"}
                  type="button"
                  aria-pressed={station === option.id}
                  onClick={() => chooseStation(option.id)}
                  className={cn(pill, pillState(station === option.id))}
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 px-4 pb-2 pt-1 md:px-6 lg:flex-row lg:items-center">
            <nav
              aria-label="Filtrar órdenes"
              className="flex min-w-0 snap-x gap-2 overflow-x-auto p-0.5 [mask-image:linear-gradient(90deg,#000_85%,transparent)] [scrollbar-width:none] md:[mask-image:none] lg:flex-1"
            >
              {kindPills.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kindFilter === value}
                  onClick={() => setKindFilter(value)}
                  className={cn(pill, pillState(kindFilter === value))}
                >
                  {label}{" "}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[13px] tabular-nums",
                      kindFilter === value ? "bg-btn-foreground text-btn" : "bg-surface-2 text-fg-2",
                    )}
                  >
                    {kindCounts[value]}
                  </span>
                </button>
              ))}

              {/* Mesero y mesa */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={Boolean(filterWaiter || filterTable)}
                    className={cn(pill, pillState(Boolean(filterWaiter || filterTable)))}
                  >
                    <Filter className="h-4 w-4" aria-hidden="true" />
                    <span>Filtros</span>
                    {(filterWaiter || filterTable) && (
                      <span className="rounded-full bg-btn-foreground px-2 py-0.5 text-[13px] text-btn">
                        {filterWaiter && filterTable ? "2" : "1"}
                      </span>
                    )}
                  </button>
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
            </nav>

            <div className="hidden flex-none gap-3.5 whitespace-nowrap text-[13px] text-muted-fg min-[1400px]:flex" aria-label="Tiempo en cocina">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-status-reserved-fg" />0–{thresholds.riskFrom - 1} min</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-status-kitchen-fg" />{thresholds.riskFrom}–{thresholds.lateFrom - 1} min</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-status-danger-fg" />{thresholds.lateFrom}+ min</span>
            </div>

            {/* Estado en vivo y Actualizar: misma fila que los filtros */}
            <div className="flex flex-none flex-wrap items-center gap-2">
              {/* Indicador de conexión en tiempo real: el estado real del socket; toca para reconectar */}
              <button
                type="button"
                onClick={handleReconnect}
                title={realtimeConnected ? "Conectado en tiempo real" : "Sin conexión en tiempo real"}
                className={cn(
                  "inline-flex min-h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus",
                  realtimeConnected
                    ? "border-status-ok-line bg-status-ok-bg text-status-ok-fg"
                    : "border-status-danger-line bg-status-danger-bg text-status-danger-fg",
                )}
              >
                {realtimeConnected ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <WifiOff className="h-4 w-4" aria-hidden="true" />}
                <span className="hidden xl:inline">{realtimeConnected ? "Conectado en tiempo real" : "Desconectado"}</span>
                <span className="xl:hidden">{realtimeConnected ? "Conectado" : "Desconectado"}</span>
              </button>

              {newOrderAlert && (
                <Button
                  variant="outline"
                  className="flex min-h-11 items-center gap-2 rounded-full motion-safe:animate-pulse"
                  onClick={handleDismissAlert}
                >
                  <Bell className="h-4 w-4 text-status-warning-fg" aria-hidden="true" />
                  <span>¡Nuevas órdenes!</span>
                  <Badge variant="secondary" className="ml-1">
                    {newOrderCount}
                  </Badge>
                </Button>
              )}

              <Button
                variant="outline"
                onClick={handleRefreshOrders}
                disabled={refreshing}
                className="flex min-h-11 items-center gap-2 rounded-full"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
                <span>Actualizar</span>
              </Button>
            </div>
          </div>

          {/* Filtros activos (mesero / mesa) */}
          {(filterWaiter || filterTable) && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-2 md:px-6">
              <span className="text-sm text-muted-fg">Filtros activos:</span>
              {filterWaiter && (
                <span className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-status-occupied-line bg-status-occupied-bg pl-3 text-[13px] font-semibold text-status-occupied-fg">
                  Mesero: {profiles.find((p) => p.id === filterWaiter)?.name}
                  <button
                    type="button"
                    aria-label="Quitar filtro de mesero"
                    className="grid h-8 w-8 place-items-center rounded-full focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                    onClick={() => setFilterWaiter(null)}
                  >
                    ×
                  </button>
                </span>
              )}
              {filterTable && (
                <span className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-status-occupied-line bg-status-occupied-bg pl-3 text-[13px] font-semibold text-status-occupied-fg">
                  {filterTable === "delivery" ? "Domicilios" : `Mesa: ${filterTable}`}
                  <button
                    type="button"
                    aria-label="Quitar filtro de mesa"
                    className="grid h-8 w-8 place-items-center rounded-full focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                    onClick={() => setFilterTable(null)}
                  >
                    ×
                  </button>
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={clearFilters} className="min-h-11 px-3">
                Limpiar todos
              </Button>
            </div>
          )}

          {!realtimeConnected && (
            <div
              role="alert"
              className="mx-4 mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-card border border-status-danger-line bg-status-danger-bg px-3.5 py-3 text-[15px] leading-snug text-status-danger-fg md:mx-6"
            >
              <WifiOff className="h-5 w-5 flex-none" aria-hidden="true" />
              <span className="min-w-0 flex-[1_1_220px]">
                <b className="font-semibold">Sin conexión en tiempo real.</b>{" "}
                {lastSync ? <>Lo que ves es de las <span className="tabular-nums">{lastSync}</span>; las</> : "Las"} órdenes
                nuevas podrían no aparecer.
              </span>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={handleReconnect}>
                Reconectar
              </Button>
            </div>
          )}

          <h2 className="sr-only">Órdenes pendientes en cocina, de la más antigua a la más nueva</h2>

          {loadingOrders ? (
            <div
              data-testid="kitchen-loading"
              aria-busy="true"
              aria-label="Cargando órdenes"
              className="grid min-h-0 flex-1 auto-cols-[100%] grid-flow-col gap-3 overflow-hidden px-4 pb-4 pt-1 md:auto-cols-[calc((100%-16px)/2)] md:gap-4 md:px-6 lg:auto-cols-[calc((100%-32px)/3)] min-[1400px]:auto-cols-[340px]"
            >
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex flex-col gap-3.5 rounded-card-lg border-[1.5px] border-line-strong bg-surface p-4">
                  <Skeleton className="h-6 w-2/5 bg-surface-2" />
                  <Skeleton className="h-8 w-3/4 bg-surface-2" />
                  <Skeleton className="h-4 w-4/5 bg-surface-2" />
                  <Skeleton className="h-14 bg-surface-2" />
                  <Skeleton className="h-14 bg-surface-2" />
                  <Skeleton className="mt-auto h-14 rounded-full bg-surface-2" />
                </div>
              ))}
            </div>
          ) : railOrders.length === 0 ? (
            <section className="grid flex-1 place-items-center px-5 pb-12 pt-6 text-center">
              <div>
                <div className="mx-auto grid h-[72px] w-[72px] place-items-center rounded-[22px] bg-brand-tint text-brand-strong">
                  <ChefHat className="h-[34px] w-[34px]" aria-hidden="true" />
                </div>
                <h2 className="mb-2 mt-[18px] text-2xl font-semibold tracking-tight md:text-4xl">
                  {kitchenOrders.length === 0
                    ? "No hay órdenes pendientes en cocina"
                    : "No hay órdenes que coincidan con los filtros seleccionados"}
                </h2>
                <p className="mx-auto mb-5 max-w-[460px] text-[17px] leading-normal text-muted-fg">
                  {kitchenOrders.length === 0
                    ? "Cuando un mesero envíe una comanda aparecerá aquí, la más antigua primero."
                    : `Hay ${kitchenOrders.length} ${kitchenOrders.length === 1 ? "orden pendiente" : "órdenes pendientes"} con otros filtros.`}
                </p>
                {kitchenOrders.length > 0 && (
                  <Button variant="outline" className="min-h-11 rounded-full" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <KitchenRail
              tickets={railOrders.map((order) => {
                const place = ticketPlace(order)
                const age = ticketAge(now - ticketStartedAt(order), thresholds)
                const delivery = isDeliveryOrder(order) ? deliveriesRef.current.get(order.id)?.delivery : undefined
                return {
                  key: order.id,
                  summary: `${place} · ${age.label} · ${age.minutes} min`,
                  node: (
                    <KitchenTicket
                      order={order}
                      place={place}
                      waiterName={profiles?.find((p) => p.id === order.waiter)?.name ?? null}
                      address={delivery?.addressLine ?? null}
                      note={(isDeliveryOrder(order) ? delivery?.notes : order.notes)?.trim() || null}
                      now={now}
                      thresholds={thresholds}
                      onServeItem={(itemId) => handleMarkAsDelivered(order.id, itemId)}
                      onServeAll={() => handleMarkAllAsDelivered(order.id)}
                    />
                  ),
                }
              })}
            />
          )}
        </div>
      </div>

      {/* Confirm Dialog for Mark All as Delivered */}
      <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <AlertDialogContent className="rounded-card-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Entregar toda la orden?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelivery ? `${ticketPlace(pendingDelivery)} · estos productos saldrán de la cocina:` : "Todos los productos de esta orden serán marcados como entregados."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelivery && (
            <ul className="max-h-[40vh] overflow-y-auto rounded-card border border-line">
              {pendingItems(pendingDelivery).map((item) => (
                <li key={item.id} className="flex gap-2.5 border-line px-3.5 py-2.5 text-base [&+&]:border-t">
                  <span className="font-mono font-bold tabular-nums text-brand-strong">{item.quantity}×</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 rounded-full" onClick={confirmMarkAllAsDelivered}>
              Confirmar entrega
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
