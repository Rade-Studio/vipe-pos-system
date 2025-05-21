"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePOSStore } from "@/store/use-pos-store"
import type { Profile, Dish, Table, Order } from "@/types"
import { Header } from "@/components/layout/Header"
import { TablesSection } from "@/components/pos/TablesSection"
import { MenuSection } from "@/components/pos/MenuSection"
import { CartSidebar } from "@/components/pos/CartSidebar"
import { AlertTriangle, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WaiterSelectionModal } from "@/components/pos/WaiterSelectionModal"
import { KitchenOrderPrintView } from "@/components/printing/KitchenOrderPrintView"
import type { PrintableKitchenOrder } from "@/types"
import { tableService, orderService, waiterService } from "@/lib/supabase/service"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { useToast } from "@/hooks/use-toast"
import { useConfigStore } from "@/store/use-config-store"
import inventoryControlService from "@/lib/supabase/inventory-control-service"
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
// Importar el nuevo componente CompactOrderCard
import { CompactOrderCard } from "@/components/pos/CompactOrderCard"
// Importar el hook para detectar dispositivos móviles
import { useIsMobile } from "@/hooks/use-mobile"

// Definir un ancho personalizado para el sidebar
const CUSTOM_SIDEBAR_WIDTH = "22rem" // Ajustado para optimizar espacio

interface WaiterViewProps {
  profile: Profile
  onChangeProfile: () => void
}

// Función para normalizar IDs de platos
const normalizeDishId = (id: string): string => {
  // Si el ID contiene un guión, tomar solo la primera parte (hasta 36 caracteres)
  if (id.length > 36 && id.includes("-")) {
    return id.substring(0, 36)
  }
  return id
}

export function WaiterView({ profile, onChangeProfile }: WaiterViewProps) {
  // Estados principales
  const [activeView, setActiveView] = useState<"tables" | "orders">("tables")
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [tables, setTables] = useState<Table[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
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
  const [tableSelectionTime, setTableSelectionTime] = useState<Record<string, number>>({})
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [forceRender, setForceRender] = useState(0)

  // Estado para controlar la visibilidad del sidebar en móviles
  const [showMobileCart, setShowMobileCart] = useState(false)

  // Referencias
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const menuSectionRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)
  const tablesSubscriptionRef = useRef<(() => void) | null>(null)
  const ordersSubscriptionRef = useRef<(() => void) | null>(null)
  const isLoadingTablesRef = useRef(false) // Referencia para evitar cargas simultáneas
  const localChangesRef = useRef<Set<string>>(new Set()) // Para rastrear cambios locales

  // Hooks
  const { toast } = useToast()
  const { tipPercentage, taxPercentage, inventoryControlEnabled } = useConfigStore()
  const isMobile = useIsMobile()

  // Zustand store
  const {
    addToCart,
    updateQuantity,
    updateItemComments,
    clearCart,
    getCartByTable,
    getCartTotal,
    calculateOrderBill,
    addOrder,
    setTables: setZustandTables,
    updateTableStatus: updateZustandTableStatus,
    reserveTable: reserveZustandTable,
    releaseTable: releaseZustandTable,
    assignWaiterToTable: assignZustandWaiterToTable,
  } = usePOSStore()

  // Obtener items del carrito para la mesa activa
  const cartItems = activeTable ? getCartByTable(activeTable) : []

  // Cargar meseros - función memoizada para evitar recreaciones innecesarias
  const loadWaiters = useCallback(async () => {
    try {
      const waitersData = await waiterService.getAll()

      const waiters = waitersData.map((waiter) => ({
        id: waiter.id,
        name: waiter.full_name,
        full_name: waiter.full_name,
        username: waiter.username,
        role: waiter.role,
      }))

      setProfiles(waiters)
      return waiters
    } catch (err) {
      toast({
        title: "Error",
        description: "No se pudieron cargar los meseros. Intente nuevamente.",
        variant: "destructive",
      })
      return []
    }
  }, [toast])

  // Cargar mesas - función memoizada completa (para carga inicial)
  const loadTables = useCallback(async () => {
    // Evitar cargas simultáneas
    if (isLoadingTablesRef.current) {
      return []
    }

    isLoadingTablesRef.current = true

    try {
      const data = await tableService.getAll()

      const formattedTables = data.map((table) => ({
        id: table.id,
        number: table.number,
        status: table.status as any,
        waiter: table.waiter_id || undefined,
        waiter_name: table.waiter_name || undefined,
      }))

      // Actualizar ambos estados de forma independiente para evitar ciclos
      setTables(formattedTables)
      setZustandTables(formattedTables)

      // Forzar re-renderizado
      setForceRender((prev) => prev + 1)

      return formattedTables
    } catch (err) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las mesas. Intente nuevamente.",
        variant: "destructive",
      })
      return []
    } finally {
      isLoadingTablesRef.current = false
    }
  }, [toast, setZustandTables])

  // Cargar órdenes - función memoizada
  const loadOrders = useCallback(async () => {
    try {
      const activeOrdersData = await orderService.getByStatus(["active"])

      const formattedOrders = activeOrdersData.map((order) => {
        const items = order.order_items.map((item) => ({
          id: item.id,
          dishId: item.dish_id || `item-${item.id}`,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          comments: item.comments || undefined,
          categoryId: item.category_id || "",
          image: "/placeholder.svg?height=50&width=50",
          status: item.status,
        }))

        return {
          id: order.id,
          tableId: order.table_id,
          items,
          status: order.status,
          bill: {
            subtotal: order.subtotal || 0,
            tax: order.tax || 0,
            taxPercentage: order.tax_percentage || 0,
            tip: order.tip || 0,
            tipPercentage: order.tip_percentage || 0,
            total: order.total || 0,
          },
          waiter: order.waiter_id,
          createdAt: new Date(order.created_at),
          isPartialOrder: order.is_partial_order || false,
          parentOrderId: order.parent_order_id || null,
        }
      })

      setActiveOrders(formattedOrders)
      return formattedOrders
    } catch (err) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las órdenes. Intente nuevamente.",
        variant: "destructive",
      })
      return []
    }
  }, [toast])

  // Configurar suscripciones en tiempo real
  const setupRealtimeSubscriptions = useCallback(() => {

    // Suscripción a cambios en mesas
    const unsubscribeTables = realtimeService.subscribeToTables((payload) => {
      // Verificar si este cambio fue originado por este cliente
      const tableId = payload.new?.id || payload.old?.id
      if (tableId && localChangesRef.current.has(tableId)) {
        localChangesRef.current.delete(tableId) // Limpiar el registro
        return
      }

      // Procesar el cambio que vino de otro cliente
      if (payload.eventType === "INSERT") {
        // Nueva mesa añadida
        const newTable = {
          id: payload.new.id,
          number: payload.new.number,
          status: payload.new.status,
          waiter: payload.new.waiter_id || undefined,
          waiter_name: payload.new.waiter_name || undefined,
        }

        // Actualizar estado local y store
        setTables((prevTables) => [...prevTables, newTable])
        setZustandTables((prevTables) => [...prevTables, newTable])
      } else if (payload.eventType === "UPDATE") {
        // Mesa actualizada
        const updatedTable = {
          id: payload.new.id,
          number: payload.new.number,
          status: payload.new.status,
          waiter: payload.new.waiter_id || undefined,
          waiter_name: payload.new.waiter_name || undefined,
        }

        // Actualizar estado local y store
        setTables((prevTables) => prevTables.map((table) => (table.id === updatedTable.id ? updatedTable : table)))
        setZustandTables((prevTables) =>
          prevTables.map((table) => (table.id === updatedTable.id ? updatedTable : table)),
        )

        // Si es la mesa activa, actualizar también el estado de mesa activa
        if (activeTable === updatedTable.id) {
          // Si la mesa fue liberada, limpiar la selección
          if (updatedTable.status === "available") {
            setActiveTable(null)
          }
        }
      } else if (payload.eventType === "DELETE") {
        // Mesa eliminada
        const deletedTableId = payload.old.id

        // Actualizar estado local y store
        setTables((prevTables) => prevTables.filter((table) => table.id !== deletedTableId))
        setZustandTables((prevTables) => prevTables.filter((table) => table.id !== deletedTableId))

        // Si es la mesa activa, limpiar la selección
        if (activeTable === deletedTableId) {
          setActiveTable(null)
        }
      }

      // Forzar re-renderizado
      setForceRender((prev) => prev + 1)
    })

    // Suscripción a cambios en órdenes
    const unsubscribeOrders = realtimeService.subscribeToOrders((payload) => {
      // Verificar si este cambio fue originado por este cliente
      const orderId = payload.new?.id || payload.old?.id
      if (orderId && localChangesRef.current.has(orderId)) {
        localChangesRef.current.delete(orderId) // Limpiar el registro
        return
      }

      // Procesar el cambio que vino de otro cliente
      if (payload.eventType === "INSERT") {
        // Nueva orden añadida
        if (payload.new && payload.new.status === "active") {
          // Convertir la orden al formato que espera el componente
          const newOrder = {
            id: payload.new.id,
            tableId: payload.new.table_id,
            items: (payload.new.order_items || []).map((item) => ({
              id: item.id,
              dishId: item.dish_id || `item-${item.id}`,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              comments: item.comments || undefined,
              categoryId: item.category_id || "",
              image: "/placeholder.svg?height=50&width=50",
              status: item.status,
            })),
            status: payload.new.status,
            bill: {
              subtotal: payload.new.subtotal || 0,
              tax: payload.new.tax || 0,
              taxPercentage: payload.new.tax_percentage || 0,
              tip: payload.new.tip || 0,
              tipPercentage: payload.new.tip_percentage || 0,
              total: payload.new.total || 0,
            },
            waiter: payload.new.waiter_id,
            createdAt: new Date(payload.new.created_at),
            isPartialOrder: payload.new.is_partial_order || false,
            parentOrderId: payload.new.parent_order_id || null,
          }

          // Actualizar el estado local
          setActiveOrders((prev) => [...prev, newOrder])
        }
      } else if (payload.eventType === "UPDATE") {
        // Orden actualizada
        if (payload.new) {
          setActiveOrders((prev) =>
            prev.map((order) =>
              order.id === payload.new.id
                ? {
                    ...order,
                    status: payload.new.status,
                    bill: {
                      subtotal: payload.new.subtotal || order.bill.subtotal,
                      tax: payload.new.tax || order.bill.tax,
                      taxPercentage: payload.new.tax_percentage || order.bill.taxPercentage,
                      tip: payload.new.tip || order.bill.tip,
                      tipPercentage: payload.new.tip_percentage || order.bill.tipPercentage,
                      total: payload.new.total || order.bill.total,
                    },
                    // Si hay items en el payload, actualizarlos también
                    items: payload.new.order_items
                      ? payload.new.order_items.map((item) => ({
                          id: item.id,
                          dishId: item.dish_id || `item-${item.id}`,
                          name: item.name,
                          price: item.price,
                          quantity: item.quantity,
                          comments: item.comments || undefined,
                          categoryId: item.category_id || "",
                          image: "/placeholder.svg?height=50&width=50",
                          status: item.status,
                        }))
                      : order.items,
                  }
                : order,
            ),
          )

          // Si la orden cambió a estado "paid", eliminarla de las órdenes activas
          if (payload.new.status === "paid") {
            setActiveOrders((prev) => prev.filter((order) => order.id !== payload.new.id))
          }
        }
      } else if (payload.eventType === "DELETE") {
        // Orden eliminada
        if (payload.old) {
          setActiveOrders((prev) => prev.filter((order) => order.id !== payload.old.id))
        }
      }
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
  }, [setZustandTables, activeTable])

  // Efecto para inicializar datos y suscripciones
  useEffect(() => {
    const initializeData = async () => {
      // Solo mostrar loading en la carga inicial
      if (isFirstRender.current) {
        setLoading(true)
        isFirstRender.current = false
      }

      try {
        await loadWaiters()
        await loadTables()
        await loadOrders()
      } catch (error) {
        toast({
          title: "Error",
          description: "No se pudieron cargar los datos iniciales. Intente nuevamente.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    initializeData()

    // Configurar suscripciones en tiempo real
    const cleanupSubscriptions = setupRealtimeSubscriptions()

    // Limpiar suscripciones al desmontar
    return () => {
      cleanupSubscriptions()
    }
  }, [loadWaiters, loadTables, loadOrders, setupRealtimeSubscriptions, toast])

  // Efecto para registrar tiempo de selección de mesa
  useEffect(() => {
    if (!activeTable || isFirstRender.current) {
      isFirstRender.current = false
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

  // Efecto para scroll suave a sección de menú
  useEffect(() => {
    if (activeTable && menuSectionRef.current) {
      const timer = setTimeout(() => {
        menuSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      }, 100)

      return () => clearTimeout(timer)
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
            localChangesRef.current.add(tableId)

            // Actualizar en base de datos
            await tableService.releaseTable(tableId)

            // Actualizar directamente en el store y estado local
            releaseZustandTable(tableId)
            setTables((prevTables) =>
              prevTables.map((table) =>
                table.id === tableId
                  ? { ...table, status: "available", waiter: undefined, waiter_name: undefined }
                  : table,
              ),
            )
          }
        } catch (err) {
          toast({
            title: "Error",
            description: "No se pudo verificar/liberar la mesa. Intente nuevamente.",
            variant: "destructive",
          })
        }
      }
    },
    [getCartByTable, tables, releaseZustandTable],
  )

  // Manejar selección de mesa
  const handleTableSelect = useCallback(
    (tableId: string | null) => {
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
          localChangesRef.current.add(tableId)

          // Actualizar en base de datos
          tableService
            .updateTableStatus(tableId, "occupied")
            .then(() => {
              // Actualizar directamente en el store y estado local
              updateZustandTableStatus(tableId, "occupied")
              setTables((prevTables) =>
                prevTables.map((table) => (table.id === tableId ? { ...table, status: "occupied" } : table)),
              )
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
        setSelectedTableForWaiter(tableId)
        setShowWaiterModal(true)
      }

      // Si estamos en móvil y seleccionamos una mesa, mostrar el carrito
      if (isMobile && tableId) {
        setShowMobileCart(true)
      }
    },
    [activeTable, checkEmptyCartAndReleaseTable, tables, updateZustandTableStatus, isMobile],
  )

  // Manejar selección de mesero
  const handleWaiterSelect = useCallback(
    async (waiterId: string) => {
      if (selectedTableForWaiter) {
        try {
          // Evitar mostrar loading
          setLoading(false)

          // Registrar este cambio como local
          localChangesRef.current.add(selectedTableForWaiter)

          // Actualizar en base de datos
          await tableService.assignWaiter(selectedTableForWaiter, waiterId, "occupied")

          // Buscar el nombre del mesero
          const waiterName = profiles.find((p) => p.id === waiterId)?.name

          // Actualizar directamente en el store y estado local
          assignZustandWaiterToTable(selectedTableForWaiter, waiterId)
          setTables((prevTables) =>
            prevTables.map((table) =>
              table.id === selectedTableForWaiter
                ? {
                    ...table,
                    status: "occupied",
                    waiter: waiterId,
                    waiter_name: waiterName,
                  }
                : table,
            ),
          )

          setActiveTable(selectedTableForWaiter)
          setSelectedTableForWaiter(null)
          setShowWaiterModal(false)

          // Si estamos en móvil, mostrar el carrito
          if (isMobile) {
            setShowMobileCart(true)
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
    [selectedTableForWaiter, toast, assignZustandWaiterToTable, profiles, isMobile],
  )

  // Completar reserva después de seleccionar mesero
  const completeReservation = useCallback(
    async (waiterId: string) => {
      if (selectedTableForWaiter) {
        try {
          // Evitar mostrar loading
          setLoading(false)

          // Registrar este cambio como local
          localChangesRef.current.add(selectedTableForWaiter)

          // Actualizar en base de datos
          await tableService.assignWaiter(selectedTableForWaiter, waiterId, "occupied")

          // Buscar el nombre del mesero
          const waiterName = profiles.find((p) => p.id === waiterId)?.name

          // Actualizar directamente en el store y estado local
          assignZustandWaiterToTable(selectedTableForWaiter, waiterId)
          setTables((prevTables) =>
            prevTables.map((table) =>
              table.id === selectedTableForWaiter
                ? {
                    ...table,
                    status: "occupied",
                    waiter: waiterId,
                    waiter_name: waiterName,
                  }
                : table,
            ),
          )

          setActiveTable(selectedTableForWaiter)
          setSelectedTableForWaiter(null)
          setShowWaiterModal(false)

          // Si estamos en móvil, mostrar el carrito
          if (isMobile) {
            setShowMobileCart(true)
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
    [selectedTableForWaiter, toast, assignZustandWaiterToTable, profiles, isMobile],
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
        localChangesRef.current.add(tableId)

        // Actualizar en base de datos
        await tableService.releaseTable(tableId)

        // Actualizar directamente en el store y estado local
        releaseZustandTable(tableId)
        setTables((prevTables) =>
          prevTables.map((table) =>
            table.id === tableId ? { ...table, status: "available", waiter: undefined, waiter_name: undefined } : table,
          ),
        )

        if (activeTable === tableId) {
          setActiveTable(null)

          // Si estamos en móvil, ocultar el carrito
          if (isMobile) {
            setShowMobileCart(false)
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
          description: "No se pudo liberar la mesa. Intente nuevamente.",
          variant: "destructive",
        })
      }
    },
    [tables, activeTable, toast, releaseZustandTable, isMobile],
  )

  // Agregar plato al carrito
  const handleAddToCart = useCallback(
    (dish: Dish, comments?: string) => {
      if (!activeTable) return

      addToCart(activeTable, {
        id: dish.id,
        name: dish.name,
        price: dish.price,
        quantity: 1,
        categoryId: dish.categoryId,
        image: dish.image,
        comments,
      })
    },
    [activeTable, addToCart, isMobile],
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

  // Verificar stock antes de enviar a cocina
  const checkStockBeforeSending = useCallback(async () => {
    if (!inventoryControlEnabled || forceSubmit) {
      return true
    }

    try {
      const normalizedCartItems = cartItems.map((item) => ({
        ...item,
        id: normalizeDishId(item.id),
      }))

      const stockCheck = await inventoryControlService.checkOrderStock(normalizedCartItems)

      if (!stockCheck.hasStock) {
        setStockDetailWarning({
          dishesWithoutStock: stockCheck.dishesWithoutStock,
          missingIngredients: stockCheck.missingIngredients,
        })
        setShowStockDetailWarning(true)
        return false
      }

      return true
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo verificar el stock de ingredientes. Intente nuevamente.",
        variant: "destructive",
      })
      return false
    }
  }, [inventoryControlEnabled, forceSubmit, cartItems, toast])

  // Reducir stock después de enviar a cocina
  const reduceStockAfterSending = useCallback(
    async (orderId: string) => {
      if (!inventoryControlEnabled) {
        return
      }

      try {
        const normalizedCartItems = cartItems.map((item) => ({
          ...item,
          id: normalizeDishId(item.id),
        }))

        await inventoryControlService.reduceStock(normalizedCartItems, orderId)
      } catch (error) {
        toast({
          title: "Advertencia",
          description: "La orden se envió correctamente, pero hubo un error al actualizar el inventario.",
          variant: "destructive",
        })
      }
    },
    [inventoryControlEnabled, cartItems, toast],
  )

  // Verificar si ya existe una orden activa para la mesa
  const checkExistingOrder = useCallback(
    async (tableId: string) => {
      try {
        const tableOrders = activeOrders.filter((order) => order.tableId === tableId && order.status === "active")
        return tableOrders.length > 0 ? tableOrders[0] : null
      } catch (error) {
        return null
      }
    },
    [activeOrders],
  )

  // Agregar nuevos productos a una orden existente
  const addItemsToExistingOrder = useCallback(async (orderId: string, items: any[]) => {
    try {
      const orderItems = items.map((item) => ({
        order_id: orderId,
        dish_id: item.id.includes("-") ? null : item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        comments: item.comments || null,
        status: "kitchen",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))

      const { data: insertedItems, error: itemsError } = await orderService.addItemsToOrder(orderId, orderItems)

      if (itemsError) {
        throw itemsError
      }

      await orderService.recalculateOrderTotals(orderId)
      return true
    } catch (error) {
      throw error
    }
  }, [])

  // Enviar a cocina
  const handleSendToKitchen = useCallback(async () => {
    if (!activeTable || cartItems.length === 0) return

    const stockOk = await checkStockBeforeSending()
    if (!stockOk) return

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
      const existingOrder = await checkExistingOrder(activeTable)

      if (existingOrder) {
        // Registrar este cambio como local
        localChangesRef.current.add(existingOrder.id)

        await addItemsToExistingOrder(existingOrder.id, cartItems)
        await reduceStockAfterSending(existingOrder.id)

        if (table.status !== "kitchen") {
          // Registrar este cambio como local
          localChangesRef.current.add(activeTable)

          // Actualizar en base de datos
          await tableService.updateTableStatus(activeTable, "kitchen")

          // Actualizar directamente en el store y estado local
          updateZustandTableStatus(activeTable, "kitchen")
          setTables((prevTables) => prevTables.map((t) => (t.id === activeTable ? { ...t, status: "kitchen" } : t)))
        }

        const orderNumber = `${Math.floor(Math.random() * 9000) + 1000}`

        const kitchenOrder: PrintableKitchenOrder = {
          orderNumber,
          date: new Date(),
          table: table.number,
          waiter: profiles.find((p) => p.id === waiterId)?.name || "Mesero",
          items: cartItems,
        }

        setKitchenOrderData(kitchenOrder)
        setShowKitchenOrder(true)
        clearCart(activeTable)

        toast({
          title: "Productos adicionales enviados",
          description: `Los nuevos productos para la mesa ${table.number} han sido enviados a cocina.`,
        })

        setActiveTable(null)

        // Si estamos en móvil, ocultar el carrito
        if (isMobile) {
          setShowMobileCart(false)
        }
      } else {
        // Asegurarse de que hay un mesero asignado
        if (!waiterId) {
          // Registrar este cambio como local
          localChangesRef.current.add(activeTable)

          // Actualizar en base de datos
          await tableService.assignWaiter(activeTable, profile.id, "occupied")

          // Actualizar directamente en el store y estado local
          assignZustandWaiterToTable(activeTable, profile.id)
          setTables((prevTables) =>
            prevTables.map((t) =>
              t.id === activeTable
                ? {
                    ...t,
                    status: "occupied",
                    waiter: profile.id,
                    waiter_name: profile.name,
                  }
                : t,
            ),
          )
        }

        // Calcular totales usando la función del store
        const bill = calculateOrderBill(cartItems, tipPercentage, taxPercentage)

        // Crear la orden en la base de datos
        const newOrder = await orderService.create({
          table_id: activeTable,
          waiter_id: waiterId,
          items: cartItems,
          subtotal: bill.subtotal,
          tax: bill.tax,
          tax_percentage: bill.taxPercentage,
          tip: bill.tip,
          tip_percentage: bill.tipPercentage,
          total: bill.total,
          status: "active", // Estado inicial: activo
        })

        // Registrar este cambio como local
        localChangesRef.current.add(newOrder.id)

        await reduceStockAfterSending(newOrder.id)

        // Registrar este cambio como local
        localChangesRef.current.add(activeTable)

        // Actualizar en base de datos
        await tableService.updateTableStatus(activeTable, "kitchen")

        // Actualizar directamente en el store y estado local
        updateZustandTableStatus(activeTable, "kitchen")
        setTables((prevTables) => prevTables.map((t) => (t.id === activeTable ? { ...t, status: "kitchen" } : t)))

        // Agregar la orden al store
        const storeOrder = {
          id: newOrder.id,
          tableId: activeTable,
          items: cartItems,
          status: "active" as any,
          bill,
          waiter: waiterId,
          createdAt: new Date(),
          isPartialOrder: false,
          parentOrderId: null,
        }

        addOrder(storeOrder)

        // Actualizar el estado local de órdenes activas
        setActiveOrders((prev) => [...prev, storeOrder])

        const orderNumber = `${Math.floor(Math.random() * 9000) + 1000}`

        const kitchenOrder: PrintableKitchenOrder = {
          orderNumber,
          date: new Date(),
          table: table.number,
          waiter: profiles.find((p) => p.id === waiterId)?.name || "Mesero",
          items: cartItems,
        }

        setKitchenOrderData(kitchenOrder)
        setShowKitchenOrder(true)
        clearCart(activeTable)

        toast({
          title: "Orden enviada",
          description: `La orden #${orderNumber} ha sido enviada a cocina.`,
        })

        setActiveTable(null)

        // Si estamos en móvil, ocultar el carrito
        if (isMobile) {
          setShowMobileCart(false)
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo enviar la orden a cocina. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setSendingToKitchen(false)
    }
  }, [
    activeTable,
    cartItems,
    checkStockBeforeSending,
    tables,
    profile.id,
    profile.name,
    checkExistingOrder,
    addItemsToExistingOrder,
    reduceStockAfterSending,
    tableService,
    profiles,
    clearCart,
    calculateOrderBill,
    tipPercentage,
    taxPercentage,
    addOrder,
    toast,
    updateZustandTableStatus,
    assignZustandWaiterToTable,
    isMobile,
  ])

  // Manejar envío forzado a cocina
  const handleForceSendToKitchen = useCallback(() => {
    setForceSubmit(true)
    setShowStockDetailWarning(false)

    setTimeout(handleSendToKitchen, 100)
  }, [handleSendToKitchen])

  const handleCancelForceSendToKitchen = useCallback(() => {
    setForceSubmit(false)
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
  const activeTableNumber = activeTable ? tables.find((t) => t.id === activeTable)?.number : undefined

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
      {/* Contenido principal */}
      <div className="flex-1 overflow-auto bg-muted/20 p-0">
        <div className="p-1 md:p-2">
          <Header profile={profile} onChangeProfile={onChangeProfile} />

          <div className="flex justify-between items-center mb-1">
            <Tabs
              defaultValue={activeView}
              onValueChange={(value) => setActiveView(value as "tables" | "orders")}
              className="w-full"
            >
              <TabsList>
                <TabsTrigger value="tables">Mesas</TabsTrigger>
                <TabsTrigger value="orders">Órdenes</TabsTrigger>
              </TabsList>

              <TabsContent value="tables" className="mt-0 p-0">
                {/* Table selection */}
                <TablesSection
                  tables={tables}
                  activeTable={activeTable}
                  profile={profile}
                  profiles={profiles}
                  onSelectTable={handleTableSelect}
                  onReserveTable={handleReserveTable}
                  onReleaseTable={handleReleaseTable}
                  isTableAccessible={checkTableAccess}
                  key={`tables-section-${forceRender}`}
                />

                {activeTable && (
                  <div className="mt-2" ref={menuSectionRef}>
                    <MenuSection onAddToCart={handleAddToCart} />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="orders" className="mt-0 p-0">
                {activeOrders.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">No hay órdenes activas</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-2">
                    {activeOrders.map((order) => {
                      const table = tables.find((t) => t.id === order.tableId)
                      const waiter = profiles.find((p) => p.id === order.waiter)

                      return <CompactOrderCard key={order.id} order={order} table={table} waiter={waiter} />
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
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

      {/* Botón flotante para mostrar carrito en móvil */}
      {isMobile && activeTable && (
        <Button
          onClick={() => setShowMobileCart(true)}
          className="fixed bottom-4 right-4 rounded-full w-14 h-14 shadow-lg flex items-center justify-center z-50"
          size="icon"
          variant="default"
        >
          <ShoppingCart className="h-6 w-6" />
          {cartItems.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
              {cartItems.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          )}
        </Button>
      )}

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
