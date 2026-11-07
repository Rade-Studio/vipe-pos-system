"use client"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTableStore } from "@/store/useTableStore"
import { useCartStore } from "@/store/useCartStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import type { Profile, Order, CommandPayload } from "@/types"
import { Header } from "@/components/layout/Header"
import { TablesSection } from "@/components/pos/TablesSection"
import { TablePanel } from "@/components/floor/TablePanel"
import { GuestsStepper } from "@/components/floor/GuestsStepper"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CartSidebar } from "@/components/pos/CartSidebar"
import { StepPicker, type StepPickerItem } from "@/components/order-steps/StepPicker"
import { OrderColumn, OrderReview, lineCount, lineTotal } from "@/components/order-steps/OrderReview"
import { ToastAction } from "@/components/ui/toast"
import { AlertTriangle, ArrowLeft, ChevronRight, Send, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WaiterSelectionModal } from "@/components/pos/WaiterSelectionModal"
import { KitchenOrderPrintView } from "@/components/printing/KitchenOrderPrintView"
import type { PrintableKitchenOrder } from "@/types"
import * as tablesApi from "@/lib/api/tables"
import {
  addItemsToOrder,
  create as createOrder,
  getByStatus,
  orderConflictOf,
  orderDtoFromWire,
  orderItemsFromCart,
  toOrder,
  updateDetails,
  type DishPrice,
  type OrderDetails,
  type OrderDto,
} from "@/lib/api/orders"
import { ApiError, conflictMessage } from "@/lib/api/errors"
import { elapsedLabel, openOrdersByTable } from "@/lib/floor/live"
import { guestsText } from "@/lib/order-steps/details"
import { realtimeService } from "@/lib/api/realtime"
import { sendCommand } from "@/lib/api/print"
import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"
import type { TableChange } from "@/lib/realtime/table-merge"
import { createLocalChangeRegistry } from "@/lib/kitchen/realtime"
import { mergeOrdersList } from "@/lib/realtime/order-merge"
import { mergeOrdersForWaiter, wireRowToPartialOrder, type OrderChange } from "@/lib/realtime/order-merge"
import { log } from "@/lib/log"
import { useToast } from "@/hooks/use-toast"
import { useWaiters } from "@/hooks/use-waiters"
import { useZones } from "@/hooks/use-zones"
import { MENU_TREE_KEY, useMenuTree } from "@/hooks/use-menu-tree"
import { formatCurrency } from "@/utils/helpers"
import { useConfigStore } from "@/store/use-config-store"
import { invalidationsFor } from "@/hooks/inventory/invalidations"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"

// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"
import { ordersForWaiter } from "@/lib/delivery/kitchen"
// Importar el hook para detectar dispositivos móviles
import { useIsMobile } from "@/hooks/use-mobile"
import {animated, useSpring} from "@react-spring/web"

/** A per-table record without one table (T22 order drafts). */
function withoutTable<T>(record: Record<string, T>, tableId: string): Record<string, T> {
  const rest = { ...record }
  delete rest[tableId]
  return rest
}

// Definir un ancho personalizado para el sidebar
const CUSTOM_SIDEBAR_WIDTH = "22rem" // Ajustado para optimizar espacio

interface WaiterViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

// S5: the shared wire→app mapping (`wireRowToPartialOrder`) turns the
// snake_case `postgres_changes` row into a camelCase `Partial<Order>`; it only
// carries the fields the broadcast actually sent (undefined subtrees such as
// items/bill/waiter in the React Query cache are preserved by the merge's
// reference-stable contract) and returns null when the row lacks the minimum
// id+status shape the merge needs. See its call site in the orders handler.

export function WaiterView({ profile, onChangeProfile, authRole }: WaiterViewProps) {
  // Estados principales
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [activeOrders, setActiveOrders] = useState<Order[]>([])

  // Estados para modales y diálogos
  const [showWaiterModal, setShowWaiterModal] = useState(false)
  const [selectedTableForWaiter, setSelectedTableForWaiter] = useState<string | null>(null)
  const [showKitchenOrder, setShowKitchenOrder] = useState(false)
  const [kitchenOrderData, setKitchenOrderData] = useState<PrintableKitchenOrder | null>(null)
  const [showStockDetailWarning, setShowStockDetailWarning] = useState(false)
  const [stockDetailWarning, setStockDetailWarning] = useState<{
    dishesWithoutStock: { id: string; name: string }[]
    missingIngredients: { name: string; required: number; available: number; unit: string }[]
  }>({ dishesWithoutStock: [], missingIngredients: [] })

  // Estados de control
  const [loading, setLoading] = useState(true)
  const [sendingToKitchen, setSendingToKitchen] = useState(false)
  const [forceSubmit, setForceSubmit] = useState(false)
  // "Enviar de todos modos" re-runs the send from a timeout, whose closure still
  // sees the previous `forceSubmit`; the ref carries the decision to that run.
  const forceSubmitRef = useRef(false)
  const [tableSelectionTime, setTableSelectionTime] = useState<Record<string, number>>({})
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  // Estado para controlar la visibilidad del sidebar en móviles
  const [showMobileCart, setShowMobileCart] = useState(false)
  // T6: on the phone the selected table's panel is a bottom sheet over the map.
  const [showTableSheet, setShowTableSheet] = useState(false)
  // T10: "Agregar productos" opens the full-screen step flow over the map;
  // "Ver pedido" inside it swaps the steps for the order review.
  const [orderFlowOpen, setOrderFlowOpen] = useState(false)
  const [orderReviewOpen, setOrderReviewOpen] = useState(false)
  // T22: the details of the order being taken on each table. `asked` once the
  // guests question was answered (guests null: "Sin indicar"); `notes` is the
  // "Nota del pedido" draft (undefined: untouched, the stored note shows).
  const [orderDrafts, setOrderDrafts] = useState<Record<string, { asked?: boolean; guests?: number | null; notes?: string }>>({})
  const [guestsPrompt, setGuestsPrompt] = useState<{ tableId: string; guests: number } | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)
  // The map's elapsed-time chips move with the clock.
  const [now, setNow] = useState(() => new Date())
  const [cartStyle, cartApi] = useSpring(() => ({ scale: 1 }))

  // Referencias
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const tablesSubscriptionRef = useRef<(() => void) | null>(null)
  const ordersSubscriptionRef = useRef<(() => void) | null>(null)
  // Table ids whose next realtime event is this screen's own write. Marked
  // BEFORE the write (the echo can beat the response) and expiring, so a mark
  // whose echo never comes cannot swallow a later real change.
  const [localTableChanges] = useState(createLocalChangeRegistry)
  // T6/S2: the realtime handlers need to know which table is selected, but they
  // must NOT be re-created when the selection changes — that used to tear down
  // and rebuild both channels on every table click. The ref is the read path;
  // `activeTable` stays the render path.
  const activeTableRef = useRef<string | null>(null)

  // Hooks
  const { toast } = useToast()
  const { inventoryControlEnabled } = useConfigStore()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  // T6/S1: the waiter directory is one shared query (also read by
  // WaiterSelectionModal, from here and from the kitchen screen), so selecting
  // a table or opening the picker never reads it again.
  const { data: waiters = [], isError: waitersError } = useWaiters()
  // T6 (S4): the floor map's zones, refreshed live by `zones` realtime events.
  // A failed read leaves every table reachable from "Sin ubicar".
  const zonesQuery = useZones()
  const floorZones = zonesQuery.data ?? (zonesQuery.isError ? [] : undefined)
  // T10: the step picker's menu, read once the flow opens and then cached.
  const menuTree = useMenuTree({ enabled: orderFlowOpen })

  // Query functions for React Query
  const fetchTables = async () => {
    try {
      const data = await tablesApi.getAll()
      log.info("[WaiterView] tables fetched:", { count: data.length })
      // `updated_at` comes from the server, so the out-of-order guard of
      // `mergeTableList` compares server clocks only.
      return data.map(tablesApi.toTable)
    } catch (err: any) {
      log.error("[WaiterView] fetchTables ERROR:", { error: err?.message ?? err })
      throw err
    }
  }

  // ONE request for the three open statuses, mapped by the shared `toOrder`.
  // Delivery orders belong to the delivery operator, not to the waiters.
  const fetchOrders = async () => ordersForWaiter((await getByStatus(["active", "kitchen", "delivered"])).map(toOrder))

  // React Query hooks for tables and orders
  const { data: tablesData = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: fetchTables,
  })

  const { data: ordersData = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
  })
  // T22: the open order of each table, from the orders this screen already
  // reads (the table record has no start time).
  const openByTable = useMemo(() => openOrdersByTable(ordersData), [ordersData])
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const elapsedOf = useCallback(
    (table: { id: string }) => elapsedLabel(openByTable.get(table.id)?.createdAt, now),
    [openByTable, now],
  )

  // Individual store selectors
  // Single owner (S3, D1): tables are read directly from useTableStore —
  // WaiterView no longer keeps its own `tables` copy.
  const tables = useTableStore((s) => s.tables)
  const addToCart = useCartStore((s) => s.addToCart)
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const updateItemComments = useCartStore((s) => s.updateItemComments)
  const clearCart = useCartStore((s) => s.clearCart)
  const getCartByTable = useCartStore((s) => s.getCartByTable)
  const getCartTotal = useCartStore((s) => s.getCartTotal)
  const addOrder = useOrderStore((s) => s.addOrder)
  // Subscribe directly to cartItems so this view re-renders on cart changes
  const cartItemsMap = useCartStore((s) => s.cartItems)
  // Perfil real (UUID de la DB) — distinto del profile impersonado.
  const authProfile = useProfileStore((s) => s.authProfile)

  // Obtener items del carrito para la mesa activa
  const cartItems = activeTable ? (cartItemsMap[activeTable] || []) : []

  useEffect(() => {
    if (waitersError) {
      toast({
        title: "Error",
        description: "No se pudieron cargar los meseros. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }, [waitersError, toast])

  // Keep the realtime handlers' view of the selection up to date without
  // touching the subscription identities.
  useEffect(() => {
    activeTableRef.current = activeTable
  }, [activeTable])

  // Hydrate the single owner from the query result once it resolves (D1,
  // D2). React Query is demoted to a hydration/refresh source — WaiterView
  // no longer keeps a component-local `tables` copy or a separate mirror
  // effect (S1 kept both; S3 removes them, per design.md).
  useEffect(() => {
    if (tablesData.length > 0) {
      useTableStore.getState().setTables(tablesData)
    }
    setLoading(false)  // data loaded → clear loading state regardless of count
  }, [tablesData])

  useEffect(() => {
    if (ordersData.length > 0) {
      setActiveOrders(ordersData)
    }
  }, [ordersData])

  // Configurar suscripciones en tiempo real.
  // T6/S2: sin dependencia de `activeTable`. Antes el `useCallback` que la lista
  // recreaba las suscripciones al cambiar de mesa (2 canales desuscritos +
  // 2 resuscripciones por clic), la causa principal del parpadeo de S2.
  const setupRealtimeSubscriptions = useCallback(() => {

    // Suscripción a cambios en mesas
    const unsubscribeTables = realtimeService.subscribeToTables((payload) => {
      // Verificar si este cambio fue originado por este cliente
      const tableId = (payload.new as any)?.id || (payload.old as any)?.id
      if (tableId && localTableChanges.consume(tableId)) return

      // Route through the single owner's patch action instead of a local
      // useState updater (S3, D1). No dual write remains — the store is the
      // only place a `tables` postgres_changes event is applied.
      useTableStore.getState().applyTableChange(payload as unknown as TableChange)

      // Handle active table cleanup for UPDATE/DELETE on the active table.
      // Read through the ref so this handler can stay stable across selections.
      if (payload.eventType === "UPDATE" && payload.new) {
        if (activeTableRef.current === (payload.new as any).id && (payload.new as any).status === "available") {
          setActiveTable(null)
        }
      } else if (payload.eventType === "DELETE" && payload.old) {
        if (activeTableRef.current === (payload.old as any).id) {
          setActiveTable(null)
        }
      }
    })

    // Suscripción a cambios en órdenes
    const unsubscribeOrders = realtimeService.subscribeToOrders((payload) => {
      // Orders are not echo-suppressed: the API sends an INSERT and UPDATEs
      // per write, and merging them is idempotent.
      // S5: payload-application replaces the per-event invalidateQueries.
      // D7 consequence 2: an UPDATE only carries the fields the broadcast
      // sent — undefined subtrees (items/bill/waiter in the cache) are
      // preserved by mergeOrdersList's no-op-on-id-miss contract. An INSERT
      // arrives with its `order_items` (API enrichment), so the new card is
      // the full order from the shared mapper.
      const inserted = payload.eventType === "INSERT" ? orderDtoFromWire(payload.new) : null
      const conv: OrderChange = {
        eventType: payload.eventType,
        new: inserted ? toOrder(inserted) : payload.new ? wireRowToPartialOrder(payload.new) : null,
        old: (payload.old as any)?.id ? { id: (payload.old as any).id } : null,
      }
      // S13 through the realtime path: a domicilio never reaches the waiter's
      // order lists. `fetchOrders` applies `ordersForWaiter` on hydration, so
      // `mergeOrdersForWaiter` applies the same rule to the in-place cache
      // patch — an INSERT of a delivery row would otherwise paint itself in the
      // waiter's list. It keeps mergeOrdersList's reference stability, so a
      // no-op patch still notifies nobody (zero re-renders).
      queryClient.setQueryData<Order[]>(['orders'], (prev: Order[] | undefined) =>
        prev ? mergeOrdersForWaiter(prev, conv) : prev,
      )
    })

    // Guardar referencias para limpieza
    tablesSubscriptionRef.current = unsubscribeTables
    ordersSubscriptionRef.current = unsubscribeOrders
    setRealtimeConnected(true)

    return () => {
      if (tablesSubscriptionRef.current) {
        tablesSubscriptionRef.current()
        tablesSubscriptionRef.current = null
      }
      if (ordersSubscriptionRef.current) {
        ordersSubscriptionRef.current()
        ordersSubscriptionRef.current = null
      }
      setRealtimeConnected(false)
    }
    // T6/S2: identidad estable. Todo lo que el handler necesita (refs, setters
    // estables, el cliente de queries) no cambia al seleccionar otra mesa.
  }, [])

  // Efecto para animar el carrito
  useEffect(() => {
    const bounce = () => {
      cartApi.start({ scale: 1.3 })
      setTimeout(() => cartApi.start({ scale: 1 }), 200)
    }

    window.addEventListener("cart:bounce", bounce)

    return () => {
      window.removeEventListener("cart:bounce", bounce)
    }
  }, [cartApi])

  // Efecto para inicializar suscripciones
  useEffect(() => {
    // Configurar suscripciones en tiempo real (una sola vez por montaje)
    const cleanupSubscriptions = setupRealtimeSubscriptions()

    // Limpiar suscripciones al desmontar
    return () => {
      cleanupSubscriptions()
    }
  }, [setupRealtimeSubscriptions])

  // Efecto para registrar tiempo de selección de mesa
  useEffect(() => {
    if (!activeTable || tableSelectionTime[activeTable]) {
      return
    }

    if (!tableSelectionTime[activeTable]) {
      setTableSelectionTime((prev) => ({
        ...prev,
        [activeTable]: Date.now(),
      }))
    }
  }, [activeTable, tableSelectionTime])

  // Efecto para verificar inactividad de mesas
  useEffect(() => {
    if (!activeTable) return

    const checkInactivity = () => {
      if (!activeTable || !tableSelectionTime[activeTable]) return

      const selectionTime = tableSelectionTime[activeTable]
      const currentTime = Date.now()
      const elapsedTime = currentTime - selectionTime
      const twoMinutesInMs = 2 * 60 * 1000

      if (elapsedTime > twoMinutesInMs) {
        const cartItems = getCartByTable(activeTable)
        if (cartItems.length === 0) {
          handleReleaseTable(activeTable)
        }
      }
    }

    const intervalId = setInterval(checkInactivity, 60 * 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [activeTable, tableSelectionTime, getCartByTable])

  // The step flow belongs to the selected table: a send (which clears the
  // selection), a release or a realtime free closes it, back to the map.
  useEffect(() => {
    if (!activeTable) {
      setOrderFlowOpen(false)
      setOrderReviewOpen(false)
    }
  }, [activeTable])

  // Verificar carrito vacío y liberar mesa
  const checkEmptyCartAndReleaseTable = useCallback(
    async (tableId: string) => {
      const items = getCartByTable(tableId)
      if (items.length === 0) {
        try {
          const table = tables.find((t) => t.id === tableId)
          if (table && table.status === "occupied") {

            // Registrar este cambio como local
            localTableChanges.mark([tableId])

            // Actualizar en base de datos
            await tablesApi.releaseTable(tableId)

            // Actualizar directamente en el store (single owner, S3 — no
            // local `tables` copy left to echo the write into).
            useTableStore.getState().releaseTable(tableId)
          }
        } catch (err) {
          toast({
            title: "Error",
            description: conflictMessage(err, "No se pudo verificar/liberar la mesa. Intente nuevamente."),
            variant: "destructive",
          })
        }
      }
    },
    [getCartByTable, tables],
  )

  // Manejar selección de mesa
  const handleTableSelect = useCallback(
    (tableId: string | null) => {
      // T22: no new order on an inactive table (the API answers 409 too); an
      // order opened before it was deactivated stays reachable.
      const picked = tableId ? tables.find((t) => t.id === tableId) : undefined
      if (picked && picked.isActive === false && !openByTable.has(picked.id)) {
        toast({ title: "La mesa está inactiva", description: "No se pueden abrir pedidos nuevos en esta mesa." })
        return
      }

      if (activeTable && tableId !== activeTable) {
        checkEmptyCartAndReleaseTable(activeTable)
      }

      if (!tableId) {
        setActiveTable(null)
        return
      }

      const table = tables.find((t) => t.id === tableId)
      const currentWaiter = table?.waiter

      if (currentWaiter) {
        setActiveTable(tableId)

        if (table && table.status !== "occupied" && table.status !== "kitchen" && table.status !== "served") {
          // Registrar este cambio como local
          localTableChanges.mark([tableId])

          // Actualizar en base de datos: the floor action that occupies a table
          // keeps its waiter (setting a status directly is admin-only).
          tablesApi
            .assignWaiter(tableId, currentWaiter)
            .then(() => {
              // Actualizar directamente en el store (single owner, S3).
              useTableStore.getState().updateTableStatus(tableId, "occupied")
            })
            .catch((err) => {
              toast({
                title: "Error",
                description: "No se pudo actualizar el estado de la mesa. Intente nuevamente.",
                variant: "destructive",
              })
            })
        }
      } else {
        // Mesa libre sin mesero: si soy mesero, me asigno a mí mismo;
        // si soy admin/cashier, abro el modal para asignar manualmente.
        if (profile.role === "waiter") {
          // Usar authProfile.id (UUID real de la DB) en vez de profile.id
          // (que es "waiter-1" mock cuando admin está impersonando).
          const realWaiterId = authProfile?.id ?? profile.id
          localTableChanges.mark([tableId])
          tablesApi.assignWaiter(tableId, realWaiterId)
            .then(() => {
              useTableStore.getState().assignWaiterToTable(tableId, realWaiterId)
              setActiveTable(tableId)
            })
            .catch((err: any) => {
              toast({
                title: "Error",
                description: `No se pudo asignar la mesa. ${err?.message ?? "Intente nuevamente."}`,
                variant: "destructive",
              })
            })
        } else {
          setSelectedTableForWaiter(tableId)
          setShowWaiterModal(true)
        }
      }

      // Si estamos en móvil y seleccionamos una mesa, mostrar su panel
      if (isMobile && tableId) {
        setShowTableSheet(true)
      }
    },
    [activeTable, checkEmptyCartAndReleaseTable, tables, isMobile, profile, openByTable, toast],
  )

  // Manejar selección de mesero
  const handleWaiterSelect = useCallback(
    async (waiterId: string) => {
      if (selectedTableForWaiter) {
        try {
          // Evitar mostrar loading
          setLoading(false)

          // Registrar este cambio como local
          localTableChanges.mark([selectedTableForWaiter])

          // Actualizar en base de datos
          await tablesApi.assignWaiter(selectedTableForWaiter, waiterId)

          // Actualizar directamente en el store (single owner, S3). No local
          // `tables` copy is echoed — `waiter_name` was write-only on that
          // copy (TableGrid resolves the waiter's display name from
          // `waiters` by id, not from `table.waiter_name`; see
          // apply-progress for the grep confirming no reader exists).
          useTableStore.getState().assignWaiterToTable(selectedTableForWaiter, waiterId)

          setActiveTable(selectedTableForWaiter)
          setSelectedTableForWaiter(null)
          setShowWaiterModal(false)

          // Si estamos en móvil, mostrar el panel de la mesa
          if (isMobile) {
            setShowTableSheet(true)
          }
        } catch (err) {
          toast({
            title: "Error",
            description: "No se pudo asignar el mesero a la mesa. Intente nuevamente.",
            variant: "destructive",
          })
        }
      }
    },
    [selectedTableForWaiter, toast, isMobile],
  )

  // Completar reserva después de seleccionar mesero
  const completeReservation = useCallback(
    async (waiterId: string) => {
      if (selectedTableForWaiter) {
        try {
          // Evitar mostrar loading
          setLoading(false)

          // Registrar este cambio como local
          localTableChanges.mark([selectedTableForWaiter])

          // Actualizar en base de datos
          await tablesApi.assignWaiter(selectedTableForWaiter, waiterId)

          // Actualizar directamente en el store (single owner, S3).
          useTableStore.getState().assignWaiterToTable(selectedTableForWaiter, waiterId)

          setActiveTable(selectedTableForWaiter)
          setSelectedTableForWaiter(null)
          setShowWaiterModal(false)

          // Si estamos en móvil, mostrar el panel de la mesa
          if (isMobile) {
            setShowTableSheet(true)
          }
        } catch (err) {
          toast({
            title: "Error",
            description: "No se pudo reservar la mesa. Intente nuevamente.",
            variant: "destructive",
          })
        }
      }
    },
    [selectedTableForWaiter, toast, isMobile],
  )

  // Manejar reserva de mesa
  const handleReserveTable = useCallback((tableId: string) => {
    setSelectedTableForWaiter(tableId)
    setShowWaiterModal(true)
  }, [])

  // Manejar liberación de mesa
  const handleReleaseTable = useCallback(
    async (tableId: string) => {
      try {
        // Evitar mostrar loading
        setLoading(false)
        const table = tables.find((t) => t.id === tableId)

        if (!table) {
          return
        }

        if (["kitchen", "delivered", "served", "reserved"].includes(table.status)) {
          toast({
            title: "Acción no permitida",
            description: `No se puede liberar una mesa en estado ${table.status}`,
            variant: "destructive",
          })
          return
        }

        // Registrar este cambio como local
        localTableChanges.mark([tableId])

        // Actualizar en base de datos (the API refuses the same statuses)
        await tablesApi.releaseTable(tableId)

        // Actualizar directamente en el store (single owner, S3).
        useTableStore.getState().releaseTable(tableId)
        // The next party on this table is asked its guests again (T22).
        setOrderDrafts((prev) => withoutTable(prev, tableId))

        if (activeTable === tableId) {
          setActiveTable(null)

          // Si estamos en móvil, ocultar el carrito y el panel
          if (isMobile) {
            setShowMobileCart(false)
            setShowTableSheet(false)
          }
        }

        setTableSelectionTime((prev) => {
          const newTimes = { ...prev }
          delete newTimes[tableId]
          return newTimes
        })
      } catch (err) {
        toast({
          title: "Error",
          description: conflictMessage(err, "No se pudo liberar la mesa. Intente nuevamente."),
          variant: "destructive",
        })
      }
    },
    [tables, activeTable, toast, isMobile],
  )

  // Actualizar cantidad de producto
  const handleUpdateQuantity = useCallback(
    (itemId: string, change: number) => {
      if (!activeTable) return
      const currentQuantity = cartItems.find((item) => item.id === itemId)?.quantity || 0
      updateQuantity(activeTable, itemId, currentQuantity + change)
    },
    [activeTable, cartItems, updateQuantity],
  )

  // Actualizar comentarios de producto
  const handleUpdateComments = useCallback(
    (itemId: string, comments: string) => {
      if (!activeTable) return
      updateItemComments(activeTable, itemId, comments)
    },
    [activeTable, updateItemComments],
  )

  // Limpiar carrito
  const handleClearCart = useCallback(() => {
    if (!activeTable) return
    clearCart(activeTable)
  }, [activeTable, clearCart])

  // The API checked and consumed the stock with the order (T8b). The grid's
  // stock read is cached (staleTime 30 s), so a dish this order just sold out
  // would keep showing "Agregar": invalidate the stock reads (grid and
  // inventory). Not awaited: it is a read and must not delay "Orden enviada".
  const refreshStockAfterSending = useCallback(() => {
    if (!inventoryControlEnabled) return
    // The step picker reads "Agotado" from the menu tree.
    for (const queryKey of [...invalidationsFor({ type: "consumeOrder" }), [...MENU_TREE_KEY]]) {
      void queryClient.invalidateQueries({ queryKey }).catch(() => undefined)
    }
  }, [inventoryControlEnabled, queryClient])

  // A 409 `Price changed`: reprice the cart lines with the server's prices and
  // reload the menu, so the waiter sees the real total before sending again.
  const repriceCart = useCallback(
    (tableId: string, prices: readonly DishPrice[]) => {
      const priceByDish = new Map(prices.map((entry) => [entry.dishId, entry.price]))
      useCartStore.setState((state) => ({
        cartItems: {
          ...state.cartItems,
          [tableId]: (state.cartItems[tableId] ?? []).map((item) => {
            const price = priceByDish.get(dishIdFromCartItemId(item.id) ?? "")
            return price === undefined || price === item.price ? item : { ...item, price }
          }),
        },
      }))
      void queryClient.invalidateQueries({ queryKey: ["menu"] }).catch(() => undefined)
    },
    [queryClient],
  )

  // Verificar si ya existe una orden activa para la mesa
  const checkExistingOrder = useCallback(
    (tableId: string) =>
      activeOrders.find(
        (order) => order.tableId === tableId && (order.status === "kitchen" || order.status === "delivered"),
      ) ?? null,
    [activeOrders],
  )

  // Enviar a cocina. The API prices the lines, checks and consumes the stock,
  // computes the bill and moves the table to the kitchen, in one transaction.
  const handleSendToKitchen = useCallback(async () => {
    if (!activeTable || cartItems.length === 0) return

    // "Enviar de todos modos" re-runs the send from a timeout: the ref carries it.
    const force = forceSubmit || forceSubmitRef.current
    forceSubmitRef.current = false
    if (forceSubmit) {
      setForceSubmit(false)
    }

    setSendingToKitchen(true)

    try {
      const table = tables.find((t) => t.id === activeTable)

      if (!table) {
        throw new Error("Mesa no encontrada")
      }

      const waiterId = table.waiter || profile.id
      const items = orderItemsFromCart(cartItems)
      const existingOrder = checkExistingOrder(activeTable)
      // T22: the new order carries the guests and note captured for it; an
      // open order carries a note changed and not saved yet.
      const draft = orderDrafts[activeTable] ?? {}
      const draftNote = draft.notes?.trim() ?? ""
      const newDetails: OrderDetails = {
        ...(typeof draft.guests === "number" ? { guests: draft.guests } : {}),
        ...(draftNote ? { notes: draftNote } : {}),
      }
      const openDetails: OrderDetails =
        existingOrder && draft.notes !== undefined && draftNote !== (existingOrder.notes ?? "") ? { notes: draftNote || null } : {}

      // The API moves the table to the kitchen in the same transaction: mark
      // it before the request, its echo may arrive before the response.
      const marksTable = table.status !== "kitchen"
      if (marksTable) localTableChanges.mark([activeTable])

      let created = null as OrderDto | null
      let added = null as OrderDto | null
      try {
        if (existingOrder) {
          added = await addItemsToOrder(existingOrder.id, items, { force, ...openDetails })
        } else {
          try {
            created = await createOrder(
              force
                ? { tableId: activeTable, orderType: "dine_in", items, ...newDetails, force: true }
                : { tableId: activeTable, orderType: "dine_in", items, ...newDetails },
            )
          } catch (error) {
            // Another terminal opened an order on this table first: the cart
            // goes to that order instead of failing.
            const conflict = orderConflictOf(error)
            if (conflict?.kind !== "openOrder") throw error
            added = await addItemsToOrder(conflict.orderId, items, { force, ...newDetails })
          }
        }
      } catch (error) {
        // No write happened, so no echo will consume the mark.
        if (marksTable) localTableChanges.unmark([activeTable])
        throw error
      }

      // The API moved the table to the kitchen; mirror it in the store.
      if (marksTable) useTableStore.getState().updateTableStatus(activeTable, "kitchen")
      refreshStockAfterSending()

      // The database number (T15/T17); an order read without one keeps the old print number.
      const storedNumber = created?.orderNumber ?? added?.orderNumber ?? existingOrder?.orderNumber
      const orderNumber = storedNumber != null ? String(storedNumber) : `${Math.floor(Math.random() * 9000) + 1000}`
      const kitchenOrder: CommandPayload = {
        invoiceNumber: orderNumber,
        table: table.number,
        waiter: waiters.find((p) => p.id === waiterId)?.name || "Mesero",
        items: cartItems,
      }

      // The created order reaches the list through its realtime INSERT; an
      // order that received items is upserted (it may not be listed yet).
      if (created) {
        addOrder(toOrder(created))
      } else if (added) {
        const updated = toOrder(added)
        queryClient.setQueryData<Order[]>(["orders"], (prev: Order[] = []) =>
          prev.some((order) => order.id === updated.id)
            ? mergeOrdersList(prev, { eventType: "UPDATE", new: updated })
            : [...prev, updated],
        )
      }

      void sendCommand(kitchenOrder)
      clearCart(activeTable)
      const sentTable = activeTable
      setOrderDrafts((prev) => withoutTable(prev, sentTable))

      toast(
        created
          ? { title: "Orden enviada", description: `La orden #${orderNumber} ha sido enviada a cocina.` }
          : {
              title: "Productos adicionales enviados",
              description: `Los nuevos productos para la mesa ${table.number} han sido enviados a cocina.`,
            },
      )

      setActiveTable(null)

      // Si estamos en móvil, ocultar el carrito
      if (isMobile) {
        setShowMobileCart(false)
      }
    } catch (error) {
      const conflict = orderConflictOf(error)
      if (conflict?.kind === "shortage") {
        setStockDetailWarning({
          // The server reports short ingredients (nested preparations
          // included), not which dishes use them.
          dishesWithoutStock: [],
          missingIngredients: conflict.shortages.map((shortage) => ({
            name: shortage.name,
            required: shortage.required,
            available: shortage.available,
            unit: shortage.unit,
          })),
        })
        setShowStockDetailWarning(true)
      } else if (conflict?.kind === "priceChanged") {
        repriceCart(activeTable, conflict.prices)
        toast({
          title: "Precios actualizados",
          description: "Algunos precios cambiaron. Revise el carrito y envíe de nuevo.",
          variant: "destructive",
        })
      } else {
        log.error("Error al enviar la orden a cocina:", { error: String(error) })
        // T22: the 0015 trigger's refusal, mapped by the API (409).
        const inactive = error instanceof ApiError && error.status === 409 && error.message === "La mesa está inactiva"
        toast({
          title: "Error",
          description: inactive ? error.message : "No se pudo enviar la orden a cocina. Intente nuevamente.",
          variant: "destructive",
        })
      }
    } finally {
      setSendingToKitchen(false)
    }
  }, [
    activeTable,
    cartItems,
    forceSubmit,
    tables,
    profile.id,
    checkExistingOrder,
    orderDrafts,
    refreshStockAfterSending,
    repriceCart,
    waiters,
    clearCart,
    addOrder,
    toast,
    isMobile,
  ])

  // Manejar envío forzado a cocina
  const handleForceSendToKitchen = useCallback(() => {
    setForceSubmit(true)
    forceSubmitRef.current = true
    setShowStockDetailWarning(false)

    setTimeout(handleSendToKitchen, 100)
  }, [handleSendToKitchen])

  const handleCancelForceSendToKitchen = useCallback(() => {
    setForceSubmit(false)
    forceSubmitRef.current = false
    setShowStockDetailWarning(false)
  }, [])

  // Verificar acceso a mesa
  const checkTableAccess = useCallback((tableId: string) => {
    // En este enfoque, todas las mesas son accesibles por el perfil de mesero principal
    return true
  }, [])

  // Cerrar vista de comanda
  const handleCloseKitchenOrder = useCallback(() => {
    setShowKitchenOrder(false)
    setKitchenOrderData(null)
  }, [])

  // Obtener items del carrito para la mesa activa
  const cartTotal = activeTable ? getCartTotal(activeTable) : 0

  // Obtener número de mesa activa
  const activeTableRow = activeTable ? (tables.find((t) => t.id === activeTable) ?? null) : null
  const activeTableNumber = activeTableRow?.number
  const activeWaiterName = activeTableRow?.waiter
    ? (waiters.find((p) => p.id === activeTableRow.waiter)?.name ?? activeTableRow.waiter_name)
    : undefined
  const activeZoneName = activeTableRow?.zoneId
    ? floorZones?.find((zone) => zone.id === activeTableRow.zoneId)?.name
    : undefined

  // "Agregar productos": the full-screen step flow (T10, S5). The first one
  // on a table without an open order asks the guests (T22).
  const activeOrder = activeTable ? checkExistingOrder(activeTable) : null
  const activeDraft = activeTable ? (orderDrafts[activeTable] ?? {}) : {}
  const openOrderFlow = () => {
    setShowTableSheet(false)
    setShowMobileCart(false)
    setOrderReviewOpen(false)
    setOrderFlowOpen(true)
  }
  const handleAddItems = () => {
    if (activeTableRow && !activeOrder && !activeDraft.asked) {
      setShowTableSheet(false)
      setGuestsPrompt({ tableId: activeTableRow.id, guests: activeTableRow.seats && activeTableRow.seats > 0 ? activeTableRow.seats : 2 })
      return
    }
    openOrderFlow()
  }
  const answerGuests = (guests: number | null) => {
    if (!guestsPrompt) return
    const { tableId } = guestsPrompt
    setOrderDrafts((prev) => ({ ...prev, [tableId]: { ...prev[tableId], asked: true, guests } }))
    setGuestsPrompt(null)
    if (tableId === activeTable) openOrderFlow()
  }

  // An answer from PATCH /orders/:id replaces the listed order.
  const applyOrderDto = (dto: OrderDto) => {
    const updated = toOrder(dto)
    queryClient.setQueryData<Order[]>(["orders"], (prev: Order[] = []) =>
      prev.some((order) => order.id === updated.id) ? mergeOrdersList(prev, { eventType: "UPDATE", new: updated }) : [...prev, updated],
    )
  }
  const saveDetails = async (orderId: string, details: OrderDetails) => {
    setSavingDetails(true)
    try {
      applyOrderDto(await updateDetails(orderId, details))
      return true
    } catch (err) {
      toast({
        title: "Error",
        description: conflictMessage(err, "No se pudieron guardar los datos del pedido. Intente nuevamente."),
        variant: "destructive",
      })
      return false
    } finally {
      setSavingDetails(false)
    }
  }
  const activeGuests = activeOrder ? activeOrder.guests : activeDraft.guests
  const changeGuests = (guests: number) => {
    if (!activeTable) return
    if (activeOrder) void saveDetails(activeOrder.id, { guests })
    else {
      const tableId = activeTable
      setOrderDrafts((prev) => ({ ...prev, [tableId]: { ...prev[tableId], asked: true, guests } }))
    }
  }
  const noteValue = activeDraft.notes ?? activeOrder?.notes ?? ""
  const noteDirty = activeOrder ? noteValue.trim() !== (activeOrder.notes ?? "") : false
  const changeNote = (notes: string) => {
    if (!activeTable) return
    const tableId = activeTable
    setOrderDrafts((prev) => ({ ...prev, [tableId]: { ...prev[tableId], notes } }))
  }
  const saveNote = async () => {
    if (!activeOrder || !activeTable) return
    const tableId = activeTable
    if (await saveDetails(activeOrder.id, { notes: noteValue.trim() || null })) {
      setOrderDrafts((prev) => ({ ...prev, [tableId]: { ...prev[tableId], notes: undefined } }))
    }
  }

  // A dish picked through the steps goes into the same table cart as before;
  // the returned undo takes back exactly the quantity just added, and only
  // while the line is still as this add left it: after a send, a removal or a
  // newer add of the same dish, a stale "Deshacer" does nothing.
  const handleAddFromSteps = (item: StepPickerItem): (() => void) | void => {
    if (!activeTable) return
    const tableId = activeTable
    const { dish, quantity, comments } = item
    addToCart(tableId, {
      id: dish.id,
      name: dish.name,
      price: dish.price,
      quantity,
      categoryId: dish.categoryId ?? "",
      image: dish.imageUrl ?? "",
      comments,
      originalPrice: dish.originalPrice,
      discountAmount: dish.discountAmount,
      discountPercentage: dish.discountPercentage ?? undefined,
      promotionId: dish.promotionId,
      promotionName: dish.promotionName,
    })
    const findLine = () =>
      useCartStore
        .getState()
        .getCartByTable(tableId)
        .find((entry) => dishIdFromCartItemId(entry.id) === dish.id && (entry.comments || "") === (comments || ""))
    const quantityAfterAdd = findLine()?.quantity
    return () => {
      const line = findLine()
      if (line && line.quantity === quantityAfterAdd) updateQuantity(tableId, line.id, line.quantity - quantity)
    }
  }

  // "Quitar" in the review, with "Deshacer" putting the line back where it was.
  const handleRemoveLine = (lineId: string) => {
    if (!activeTable) return
    const tableId = activeTable
    const before = getCartByTable(tableId)
    const index = before.findIndex((entry) => entry.id === lineId)
    if (index === -1) return
    const removed = before[index]
    updateQuantity(tableId, lineId, 0)
    toast({
      title: `Quitaste ${removed.quantity}× ${removed.name}`,
      action: (
        <ToastAction
          altText="Deshacer"
          className="min-h-11 px-4"
          onClick={() =>
            useCartStore.setState((state) => {
              const cart = [...(state.cartItems[tableId] ?? [])]
              // The same line added again meanwhile: put the quantity back on it.
              const current = cart.findIndex((entry) => entry.id === removed.id)
              if (current !== -1) cart[current] = { ...cart[current], quantity: cart[current].quantity + removed.quantity }
              else cart.splice(Math.min(index, cart.length), 0, removed)
              return { cartItems: { ...state.cartItems, [tableId]: cart } }
            })
          }
        >
          Deshacer
        </ToastAction>
      ),
    })
  }

  const tablePanel = (onShowOrder?: () => void) => (
    <TablePanel
      table={activeTableRow}
      waiterName={activeWaiterName}
      zoneName={activeZoneName}
      onAddItems={handleAddItems}
      onReserve={handleReserveTable}
      onRelease={handleReleaseTable}
      onShowOrder={onShowOrder}
      orderCount={cartItems.reduce((sum, item) => sum + item.quantity, 0)}
      orderNumber={activeOrder?.orderNumber}
      guests={activeGuests}
      onChangeGuests={activeOrder || activeDraft.asked ? changeGuests : undefined}
      guestsBusy={savingDetails}
      order={activeOrder}
    />
  )

  // T10: the full-screen step flow of the selected table.
  const sentLines = activeOrder?.items ?? []
  const newCount = lineCount(cartItems)
  const tableCount = lineCount(sentLines) + newCount
  const tableTotal = lineTotal(sentLines) + cartTotal
  const orderTitle = `Pedido · Mesa ${activeTableNumber ?? ""}`
  const flowDetails = [activeZoneName, activeWaiterName].filter(Boolean).join(" · ")
  const closeOrderFlow = () => {
    setOrderFlowOpen(false)
    setOrderReviewOpen(false)
  }
  const orderFlow =
    orderFlowOpen && activeTableRow ? (
      <div className="fixed inset-0 z-40 h-[100dvh]">
        <StepPicker
          menu={menuTree.categories}
          isError={menuTree.isError}
          onRetry={menuTree.refetch}
          onAdd={handleAddFromSteps}
          onExit={closeOrderFlow}
          exitLabel="Mapa"
          header={
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 flex-none"
                aria-label="Volver al mapa del salón"
                onClick={closeOrderFlow}
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
              </Button>
              <span
                aria-hidden
                className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border-[1.5px] border-status-occupied-line bg-status-occupied-bg text-[17px] font-semibold tabular-nums text-status-occupied-fg"
              >
                {activeTableNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">
                  Mesa {activeTableNumber} · {guestsText(activeGuests) ?? "Agregar productos"}
                </p>
                {flowDetails && <p className="mt-0.5 truncate text-[12.5px] text-muted-fg">{flowDetails}</p>}
              </div>
            </>
          }
          summary={
            <button
              type="button"
              onClick={() => setOrderReviewOpen((open) => !open)}
              aria-label={`Mesa ${activeTableNumber}, ${tableCount} productos, ${formatCurrency(tableTotal)}. ${orderReviewOpen ? "Volver a los pasos" : "Ver pedido"}`}
              className="flex min-h-[52px] w-full min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-3 py-1.5 text-left focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-[60px]"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 text-[14.5px] leading-snug md:flex-col md:gap-0">
                <span className="whitespace-nowrap">
                  Mesa {activeTableNumber} · <b className="font-semibold tabular-nums">{tableCount} productos</b>
                  <span className="md:hidden"> ·</span>
                </span>
                <b className="whitespace-nowrap font-semibold tabular-nums">{formatCurrency(tableTotal)}</b>
              </span>
              <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap text-sm font-semibold text-brand-strong">
                {orderReviewOpen ? "Ocultar" : "Ver pedido"}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            </button>
          }
          primaryAction={
            <Button onClick={handleSendToKitchen} disabled={newCount === 0 || sendingToKitchen} className="text-base">
              <Send className="mr-1.5 h-[18px] w-[18px]" aria-hidden />
              Enviar a cocina ({newCount})
            </Button>
          }
          aside={
            <OrderColumn title={orderTitle} newLines={cartItems} sentLines={sentLines} onReview={() => setOrderReviewOpen(true)} />
          }
          overlay={
            orderReviewOpen ? (
              <OrderReview
                title={orderTitle}
                orderNumber={activeOrder?.orderNumber}
                note={noteValue}
                onNoteChange={changeNote}
                onSaveNote={activeOrder ? () => void saveNote() : undefined}
                noteDirty={noteDirty}
                savingNote={savingDetails}
                newLines={cartItems}
                sentLines={sentLines}
                onChangeQuantity={handleUpdateQuantity}
                onRemove={handleRemoveLine}
                onContinue={() => setOrderReviewOpen(false)}
              />
            ) : undefined
          }
          onCloseOverlay={() => setOrderReviewOpen(false)}
        />
      </div>
    ) : null

  // Si estamos mostrando la comanda, mostrar la vista de impresión
  if (showKitchenOrder && kitchenOrderData) {
    return <KitchenOrderPrintView order={kitchenOrderData} onClose={handleCloseKitchenOrder} />
  }

  // Mostrar indicador de carga
  if (loading) {
    return (
      <div className="flex h-screen overflow-hidden">
        <div className="flex-1 overflow-auto bg-muted/20 p-4">
          <div className="flex justify-between items-center mb-6">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>

          <div className="flex items-center mb-4">
            <div className="flex space-x-2">
              <Skeleton className="h-10 w-32 rounded-md" />
              <Skeleton className="h-10 w-32 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mt-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-lg" />
            ))}
          </div>
        </div>

        <div className="h-screen border-l border-border bg-background hidden md:block" style={{ width: "22rem" }}>
          <div className="p-4">
            <Skeleton className="h-8 w-32 mb-4" />
            <Skeleton className="h-6 w-full mb-2" />
            <Skeleton className="h-24 w-full mb-4 rounded-lg" />
            <Skeleton className="h-6 w-3/4 mb-2" />
            <Skeleton className="h-6 w-full mb-2" />
            <Skeleton className="h-6 w-5/6 mb-4" />
            <div className="flex justify-between mt-6">
              <Skeleton className="h-10 w-24 rounded-md" />
              <Skeleton className="h-10 w-24 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {orderFlow ?? (
        <>
      {/* Contenido principal */}
      <div className="flex-1 overflow-auto bg-muted/20 p-0">
        <div className="p-1 md:p-2">
          <Header profile={profile} onChangeProfile={onChangeProfile} authRole={authRole} />

          <div className="mb-1">
            <TablesSection
              activeTable={activeTable}
              profile={profile}
              profiles={waiters}
              onSelectTable={handleTableSelect}
              onReserveTable={handleReserveTable}
              onReleaseTable={handleReleaseTable}
              isTableAccessible={checkTableAccess}
              floor={{ zones: floorZones, currentWaiterId: authProfile?.id ?? profile.id, elapsedOf }}
            />
          </div>
        </div>
      </div>

      {/* Sidebar fijo a la derecha (solo visible en desktop) */}
      {!isMobile && (
        <div
          className="h-screen border-l border-border bg-background hidden md:block"
          style={{
            width: CUSTOM_SIDEBAR_WIDTH,
            position: "fixed",
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 40,
          }}
        >
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-b border-line">{tablePanel()}</div>
            <CartSidebar
              tableNumber={activeTableNumber}
              cartItems={cartItems}
              cartTotal={cartTotal}
              onUpdateQuantity={handleUpdateQuantity}
              onUpdateComments={handleUpdateComments}
              onClearCart={handleClearCart}
              onSendToKitchen={handleSendToKitchen}
              onToggleSidebar={() => {}}
              isSending={sendingToKitchen}
              hasActiveTable={activeTable !== null}
            />
          </div>
        </div>
      )}

      {/* Espacio para compensar el sidebar fijo (solo en desktop) */}
      <div className="hidden md:block" style={{ width: CUSTOM_SIDEBAR_WIDTH, flexShrink: 0 }}></div>

      {/* Versión móvil del carrito como modal */}
      {isMobile && (
        <CartSidebar
          tableNumber={activeTableNumber}
          cartItems={cartItems}
          cartTotal={cartTotal}
          onUpdateQuantity={handleUpdateQuantity}
          onUpdateComments={handleUpdateComments}
          onClearCart={handleClearCart}
          onSendToKitchen={handleSendToKitchen}
          onToggleSidebar={() => setShowMobileCart(!showMobileCart)}
          isSending={sendingToKitchen}
          hasActiveTable={activeTable !== null}
          isMobile={true}
          isOpen={showMobileCart}
          onOpenChange={setShowMobileCart}
        />
      )}

      {/* Panel de la mesa en móvil: hoja inferior sobre el mapa */}
      {isMobile && (
        <Sheet open={showTableSheet && activeTableRow !== null} onOpenChange={setShowTableSheet}>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="px-4 pt-4 text-left">
              <SheetTitle>Mesa {activeTableNumber}</SheetTitle>
              <SheetDescription className="sr-only">Estado y acciones de la mesa</SheetDescription>
            </SheetHeader>
            {tablePanel(() => {
              setShowTableSheet(false)
              setShowMobileCart(true)
            })}
          </SheetContent>
        </Sheet>
      )}

      {/* Botón flotante para mostrar carrito en móvil */}
      {isMobile && activeTable && (
          <animated.div style={cartStyle}>
            <Button
                id="cart-icon"
                onClick={() => setShowMobileCart(true)}
                className="fixed bottom-4 right-4 rounded-full w-14 h-14 shadow-lg flex items-center justify-center z-50"
                size="icon"
                variant="default"
            >
              <ShoppingCart className="h-6 w-6"/>
              {cartItems.length > 0 && (
                  <span
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
              {cartItems.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
              )}
            </Button>
          </animated.div>
      )}

        </>
      )}

      {/* T22: guests of a new order, asked on its first "Agregar productos" */}
      <Dialog open={guestsPrompt !== null} onOpenChange={(open) => !open && setGuestsPrompt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Cuántas personas?</DialogTitle>
            <DialogDescription>
              Mesa {tables.find((t) => t.id === guestsPrompt?.tableId)?.number} · se guarda con el pedido y se puede cambiar desde la mesa.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <GuestsStepper
              value={guestsPrompt?.guests}
              onChange={(guests) => setGuestsPrompt((prompt) => (prompt ? { ...prompt, guests } : prompt))}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-11" onClick={() => answerGuests(null)}>
              Sin indicar
            </Button>
            <Button className="h-11" onClick={() => answerGuests(guestsPrompt?.guests ?? null)}>
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal para selección de mesero */}
      <WaiterSelectionModal
        open={showWaiterModal}
        onOpenChange={setShowWaiterModal}
        onSelect={selectedTableForWaiter ? completeReservation : handleWaiterSelect}
        defaultWaiterId={undefined}
      />

      {/* Diálogo de advertencia de stock insuficiente detallado */}
      <Dialog open={showStockDetailWarning} onOpenChange={setShowStockDetailWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center text-amber-600">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Advertencia de Inventario
            </DialogTitle>
            <DialogDescription>No hay suficiente stock de ingredientes para completar esta orden:</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {stockDetailWarning.dishesWithoutStock.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium mb-2">Platos sin stock suficiente:</h3>
                <ul className="list-disc list-inside space-y-1">
                  {stockDetailWarning.dishesWithoutStock.map((dish) => (
                    <li key={dish.id} className="text-amber-700">
                      {dish.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {stockDetailWarning.missingIngredients.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Ingredientes insuficientes:</h3>
                <div className="overflow-auto max-h-40">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Ingrediente</th>
                        <th className="text-right py-2">Disponible</th>
                        <th className="text-right py-2">Requerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockDetailWarning.missingIngredients.map((ing, idx) => (
                        <tr key={idx} className="border-b border-muted">
                          <td className="py-2">{ing.name}</td>
                          <td className="text-right py-2 text-red-500">
                            {ing.available} {ing.unit}
                          </td>
                          <td className="text-right py-2">
                            {ing.required} {ing.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="mt-4 text-sm text-muted-foreground">
              ¿Desea continuar de todos modos? Esto podría resultar en problemas en la cocina.
            </p>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="outline" onClick={() => handleCancelForceSendToKitchen()}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleForceSendToKitchen}>
              Enviar de todos modos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
