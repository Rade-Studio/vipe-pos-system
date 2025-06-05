"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { Profile, Order } from "@/types"
import { Header } from "@/components/layout/Header"
import { usePOSStore } from "@/store/use-pos-store"
import { OrderCard } from "@/components/pos/OrderCard"
import { ConfirmOrderCard } from "@/components/pos/ConfirmOrderCard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TablesSection } from "@/components/pos/TablesSection"
import { WaiterSelectionModal } from "@/components/pos/WaiterSelectionModal"
import { orderService, tableService } from "@/lib/supabase/service"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { useToast } from "@/hooks/use-toast"
import { Bell, RefreshCw, Wifi, WifiOff, Filter, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase/client"
import { Skeleton } from "@/components/ui/skeleton"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useConfigStore } from "@/store/use-config-store"
import inventoryControlService from "@/lib/supabase/inventory-control-service"
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
}

// Normalizar IDs de platos para verificación de inventario
const normalizeDishId = (id: string): string => {
  if (id.length > 36 && id.includes("-")) {
    return id.substring(0, 36)
  }
  return id
}

export function KitchenView({ profile, onChangeProfile }: KitchenViewProps) {
  const [activeTab, setActiveTab] = useState<"orders" | "tables">("orders")
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [showWaiterDialog, setShowWaiterDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [newOrderAlert, setNewOrderAlert] = useState(false)
  const [newOrderCount, setNewOrderCount] = useState(0)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [newItems, setNewItems] = useState<Record<string, string[]>>({}) // Mapeo de orderId -> array de itemIds nuevos
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [orderToDeliver, setOrderToDeliver] = useState<string | null>(null)
  const [filterWaiter, setFilterWaiter] = useState<string | null>(null)
  const [filterTable, setFilterTable] = useState<number | null>(null)
  const { toast } = useToast()
  const { inventoryControlEnabled } = useConfigStore()

  const [showStockDetailWarning, setShowStockDetailWarning] = useState(false)
  const [stockDetailWarning, setStockDetailWarning] = useState<{
    dishesWithoutStock: { id: string; name: string }[]
    missingIngredients: { name: string; required: number; available: number; unit: string }[]
  }>({ dishesWithoutStock: [], missingIngredients: [] })
  const stockOrderIdRef = useRef<string | null>(null)
  const [orderStockIssues, setOrderStockIssues] = useState<Record<string, boolean>>({})

  // No usamos un estado separado para pendientes; se calculan desde las órdenes
  const confirmedOrdersRef = useRef<Set<string>>(new Set())

  const {
    tables,
    getOrdersByStatus,
    updateOrderStatus,
    profiles,
    assignWaiterToTable,
    setActiveTable,
    setOrders,
    addOrder,
    orders,
    updateTableStatus,
    setTables,
    updateOrder,
    removeOrder,
  } = usePOSStore()

  // Referencia para la función de cancelación de suscripción
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // Referencia para el último estado de órdenes
  const ordersRef = useRef(orders)

  // Actualizar la referencia cuando cambian las órdenes
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  // Cargar órdenes y mesas al iniciar y configurar suscripción en tiempo real
  useEffect(() => {
    loadInitialData()
    setupRealtimeSubscription()

    // Limpiar la suscripción al desmontar
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  // Convertir orden de la base de datos al formato del store
  const convertDbOrderToStoreOrder = (dbOrder) => {
    // Asegurarse de que order_items existe y es un array
    const orderItems = Array.isArray(dbOrder.order_items) ? dbOrder.order_items : []

    // Ordenar los items por fecha de creación
    orderItems.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    // Convertir los items de la orden conservando su estado
    const items = orderItems.map((item) => ({
      id: item.id, // Usar el ID del item
      dishId: item.dish_id || `item-${item.id}`,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments || undefined,
      categoryId: item.category_id || "",
      image: "/placeholder.svg?height=50&width=50", // Imagen por defecto
      status: item.status, // Incluir el estado del item
      addedAt: item.added_at ? new Date(item.created_at) : undefined,
    }))

    // Crear el objeto de orden para el store
    return {
      id: dbOrder.id,
      tableId: dbOrder.table_id,
      items,
      status: dbOrder.status,
      bill: {
        subtotal: dbOrder.subtotal || 0,
        tax: dbOrder.tax || 0,
        taxPercentage: dbOrder.tax_percentage || 0,
        tip: dbOrder.tip || 0,
        tipPercentage: dbOrder.tip_percentage || 0,
        total: dbOrder.total || 0,
      },
      waiter: dbOrder.waiter_id,
      createdAt: new Date(dbOrder.created_at),
      isPartialOrder: dbOrder.is_partial_order || false,
      parentOrderId: dbOrder.parent_order_id || null,
    }
  }

  // Verificar stock de una orden al llegar a cocina
  const checkStockForOrder = useCallback(
    async (order): Promise<boolean> => {
      if (!inventoryControlEnabled) return true

      try {
        const normalizedItems = order.items.map((item) => ({
          ...item,
          id: normalizeDishId(item.dishId || item.id),
        }))

        const stockCheck = await inventoryControlService.checkOrderStock(normalizedItems)

        if (!stockCheck.hasStock) {
          setStockDetailWarning({
            dishesWithoutStock: stockCheck.dishesWithoutStock,
            missingIngredients: stockCheck.missingIngredients,
          })
          stockOrderIdRef.current = order.id
          setShowStockDetailWarning(true)
          setOrderStockIssues((prev) => ({ ...prev, [order.id]: true }))
          return false
        }

        setOrderStockIssues((prev) => ({ ...prev, [order.id]: false }))
        return true
      } catch (error) {
        toast({
          title: "Error",
          description: "No se pudo verificar el stock de ingredientes.",
          variant: "destructive",
        })
        return false
      }
    },
    [inventoryControlEnabled, toast],
  )

  const reduceStockForOrder = useCallback(
    async (order: Order) => {
      if (!inventoryControlEnabled) return

      try {
        const normalizedItems = order.items.map((item) => ({
          ...item,
          id: normalizeDishId(item.dishId || item.id),
        }))
        await inventoryControlService.reduceStock(normalizedItems, order.id)
      } catch (error) {
        toast({
          title: "Advertencia",
          description: "La orden se confirmó, pero hubo un error al actualizar el inventario.",
          variant: "destructive",
        })
      }
    },
    [inventoryControlEnabled, toast],
  )

  // Configurar suscripción en tiempo real
  const setupRealtimeSubscription = () => {
    try {
      console.log("Configurando suscripción en tiempo real para cocina...")

      // Suscribirse a eventos de cocina
      const unsubscribe = realtimeService.subscribeToKitchen(
        // Callback para órdenes
        handleOrderUpdate,
        // Callback para items de órdenes
        handleOrderItemUpdate,
        // Callback para estado de conexión
        handleConnectionStatus,
      )

      // Guardar la función de cancelación
      unsubscribeRef.current = unsubscribe

      console.log("Suscripción configurada correctamente")
    } catch (error) {
      console.error("Error al configurar suscripción en tiempo real:", error)
      setRealtimeConnected(false)
      toast({
        title: "Error de conexión",
        description: "No se pudo establecer la conexión en tiempo real. Las actualizaciones podrían retrasarse.",
        variant: "destructive",
      })
    }
  }

  // Manejar actualizaciones de órdenes
  const handleOrderUpdate = async (payload, isNewOrder = false) => {
    try {
      console.log("Actualización de orden recibida:", payload)

      // Si es una eliminación de orden
      if (payload.eventType === "DELETE") {
        if (payload.old && payload.old.id) {
          // Eliminar la orden del store
          removeOrder(payload.old.id)

          // Eliminar la orden de la lista de nuevos items
          setNewItems((prev) => {
            const newState = { ...prev }
            delete newState[payload.old.id]
            return newState
          })
        }
        return
      }

      // Para inserciones y actualizaciones
      const orderDetails = payload.new

      // Si no hay detalles de la orden, salir
      if (!orderDetails) return

      // Cargar la orden completa con sus items
      const fullOrderDetails = await orderService.getById(orderDetails.id)
      if (!fullOrderDetails) {
        console.error("No se pudo cargar la orden completa:", orderDetails.id)
        return
      }

      // Convertir la orden al formato del store
      const storeOrder = convertDbOrderToStoreOrder(fullOrderDetails)

      // Si no hay items en cocina, no procesar
      if (!storeOrder) return

      // Verificar si la orden ya existe en el store
      const existingOrder = ordersRef.current.find((o) => o.id === orderDetails.id)

      if (existingOrder) {
        // Si existe, actualizar la orden
        console.log("Actualizando orden existente en el store:", orderDetails.id)
        updateOrder(orderDetails.id, storeOrder)
        checkStockForOrder(storeOrder)
      } else {
        // Si no existe, agregar la orden
        console.log("Agregando nueva orden al store:", orderDetails.id)
        addOrder(storeOrder)

        // Si es una nueva orden, mostrar notificación
        if (isNewOrder) {
          const table = tables.find((t) => t.id === storeOrder.tableId)
          toast({
            title: "¡Nueva orden!",
            description: `Nueva orden recibida para la mesa ${table?.number || storeOrder.tableId}.`,
          })

          // Marcar todos los items como nuevos
          setNewItems((prev) => ({
            ...prev,
            [orderDetails.id]: storeOrder.items.map((item) => item.id),
          }))

          // Actualizar el contador de nuevas órdenes y mostrar alerta
          setNewOrderCount((prev) => prev + 1)
          setNewOrderAlert(true)
        }
      }
    } catch (error) {
      console.error("Error al procesar actualización de orden:", error)
    }
  }

  // Manejar actualizaciones de items de órdenes
  const handleOrderItemUpdate = async (payload, isNewItem = false) => {
    try {
      console.log("Actualización de item recibido:", payload, "Es nuevo item:", isNewItem)

      // Si no hay datos de la orden o del item, salir
      if (!payload.new || !payload.new.order_id) return

      const orderId = payload.new.order_id
      const itemId = payload.new.id

      // Si un item fue entregado (cambió de estado "kitchen" a otro)
      if (payload.old && payload.old.status === "kitchen" && payload.new.status !== "kitchen") {
        console.log("Item entregado detectado:", itemId)

        // Eliminar el item de la lista de nuevos items
        setNewItems((prev) => {
          if (!prev[orderId]) return prev

          return {
            ...prev,
            [orderId]: prev[orderId].filter((id) => id !== itemId),
          }
        })

        // Cargar la orden completa para verificar si todavía tiene items en cocina
        const orderDetails = await orderService.getById(orderId)
        if (!orderDetails) return

        // Verificar si hay más items en estado "kitchen"
        const kitchenItems = orderDetails.order_items?.filter((item) => item.status === "kitchen") || []

        // Si no quedan items en cocina, eliminar la orden
        if (kitchenItems.length === 0) {
          removeOrder(orderId)

          // Eliminar la orden de la lista de nuevos items
          setNewItems((prev) => {
            const newState = { ...prev }
            delete newState[orderId]
            return newState
          })
        } else {
          // Convertir la orden al formato del store
          const storeOrder = convertDbOrderToStoreOrder(orderDetails)

          // Si aún hay items en cocina, actualizar la orden
          if (storeOrder) {
            updateOrder(orderId, storeOrder)
          }
        }

        return
      }

      // Si es un nuevo item o un item actualizado a estado "kitchen"
      if (isNewItem || (payload.old && payload.old.status !== "kitchen" && payload.new.status === "kitchen")) {
        // Cargar la orden completa con sus items
        const orderDetails = await orderService.getById(orderId)
        if (!orderDetails) return

        // Convertir la orden al formato del store
        const storeOrder = convertDbOrderToStoreOrder(orderDetails)

        // Si no hay items en cocina, no procesar
        if (!storeOrder) return

        // Verificar si la orden ya existe en el store
        const existingOrder = ordersRef.current.find((o) => o.id === orderId)

        if (existingOrder) {
          // Si existe, actualizar la orden
          console.log("Actualizando orden existente en el store con nuevo item:", orderId)
          updateOrder(orderId, storeOrder)
          checkStockForOrder(storeOrder)

          // Marcar el item como nuevo
          setNewItems((prev) => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), itemId],
          }))

          // Notificar al usuario
          const table = tables.find((t) => t.id === storeOrder.tableId)
          toast({
            title: "¡Nuevo producto en cocina!",
            description: `Se ha agregado un nuevo producto a la orden de la mesa ${table?.number || storeOrder.tableId}.`,
          })

          // Actualizar el contador de nuevas órdenes
          setNewOrderCount((prev) => prev + 1)
          setNewOrderAlert(true)
        } else {
          // Si no existe, agregar la orden
          console.log("Agregando orden con nuevo item al store:", orderId)
          addOrder(storeOrder)
          checkStockForOrder(storeOrder)

          // Marcar el item como nuevo
          setNewItems((prev) => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), itemId],
          }))

          // Notificar al usuario
          const table = tables.find((t) => t.id === storeOrder.tableId)
          toast({
            title: "¡Nueva orden en cocina!",
            description: `Se ha recibido una nueva orden para la mesa ${table?.number || storeOrder.tableId}.`,
          })

          // Actualizar el contador de nuevas órdenes
          setNewOrderCount((prev) => prev + 1)
          setNewOrderAlert(true)
        }
      }
    } catch (error) {
      console.error("Error al procesar actualización de item:", error)
    }
  }

  // Manejar estado de conexión
  const handleConnectionStatus = (status: boolean) => {
    setRealtimeConnected(status)

    if (status) {
      console.log("Conexión en tiempo real establecida")
    } else {
      console.log("Conexión en tiempo real perdida")
    }
  }

  // Cargar datos iniciales
  const loadInitialData = async () => {
    setLoading(true)
    try {
      // Cargar mesas
      const tablesData = await tableService.getAll()
      const formattedTables = tablesData.map((table) => ({
        id: table.id,
        number: table.number,
        status: table.status as any,
        waiter: table.waiter_id || undefined,
      }))
      setTables(formattedTables)

      // Cargar órdenes en cocina
      await loadKitchenOrders()
    } catch (error) {
      console.error("Error al cargar datos iniciales:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // Cargar órdenes en cocina
  const loadKitchenOrders = async () => {
    try {
      console.log("Iniciando carga de órdenes con items en cocina...")

      // Obtener órdenes pendientes y en cocina de la base de datos
      const activeOrders = await orderService.getByStatus(["pending", "kitchen"])
      console.log("Órdenes obtenidas de la BD:", activeOrders.length)

      // Procesar las órdenes para el store (incluyendo items pendientes)
      const storeOrders = activeOrders
        .map(convertDbOrderToStoreOrder)
        .filter((o) => o && o.items.length > 0)

      console.log("Órdenes convertidas para el store:", storeOrders.length)

      // Limpiar órdenes anteriores en el store
      setOrders([])

      // Limpiar la lista de nuevos items al cargar inicialmente
      setNewItems({})

      // Agregar las órdenes al store
      storeOrders.forEach((order) => {
        console.log("Agregando orden al store:", order.id)
        addOrder(order)
        checkStockForOrder(order)

        // Registrar los items de esta orden en el servicio de tiempo real
        if (order.items && order.items.length > 0) {
          realtimeService.registerItems(
            order.id,
            order.items.map((item) => item.id),
          )
        }
      })

      console.log("Órdenes agregadas al store correctamente")
    } catch (error) {
      console.error("Error al cargar órdenes de cocina:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar las órdenes de cocina.",
        variant: "destructive",
      })
    }
  }

  // Refrescar manualmente las órdenes
  const handleRefreshOrders = async () => {
    setRefreshing(true)
    try {
      await loadKitchenOrders()

      // Desactivar la alerta de nuevas órdenes al refrescar manualmente
      setNewOrderAlert(false)
      setNewOrderCount(0)

      toast({
        title: "Órdenes actualizadas",
        description: "Las órdenes se han actualizado correctamente.",
      })
    } catch (error) {
      console.error("Error al actualizar órdenes:", error)
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

      // Recargar órdenes para asegurar que tenemos los datos más recientes
      await loadKitchenOrders()

      toast({
        title: "Reconectando",
        description: "Intentando restablecer la conexión en tiempo real...",
      })
    } catch (error) {
      console.error("Error al reconectar:", error)
      toast({
        title: "Error",
        description: "No se pudo restablecer la conexión. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  // Separar órdenes con items pendientes y en cocina
  const pendingOrders = orders.filter((order) =>
    order.items.some((item) => item.status === "pending"),
  )
  const kitchenOrders = orders.filter((order) =>
    order.items.some((item) => item.status === "kitchen"),
  )

  // Aplicar filtros a las órdenes en cocina
  const filteredOrders = kitchenOrders.filter((order) => {
    // Filtrar por mesero si hay un filtro activo
    if (filterWaiter && order.waiter !== filterWaiter) {
      return false
    }

    // Filtrar por mesa si hay un filtro activo
    if (filterTable) {
      const table = tables.find((t) => t.id === order.tableId)
      if (!table || table.number !== filterTable) {
        return false
      }
    }

    return true
  })

  const waiters = profiles.filter((p) => p.role === "waiter" && p.id !== "waiter-1")

  // Limpiar filtros
  const clearFilters = () => {
    setFilterWaiter(null)
    setFilterTable(null)
  }

  // Handle marking an item as delivered (served)
  const handleMarkAsDelivered = async (orderId: string, itemId?: string) => {
    try {
      if (!itemId) {
        console.error("Se requiere el ID del item para marcarlo como entregado")
        toast({
          title: "Error",
          description: "No se pudo procesar la acción. Intente nuevamente.",
          variant: "destructive",
        })
        return
      }

      // Actualizar el estado del item a "served" en la base de datos
      const { error } = await supabase
        .from("order_items")
        .update({ status: "served", updated_at: new Date().toISOString() })
        .eq("id", itemId)

      if (error) {
        console.error("Error al actualizar estado del item:", error)
        throw error
      }

      toast({
        title: "Producto entregado",
        description: "El producto ha sido marcado como entregado.",
      })

      // La actualización del store se hará automáticamente a través de la suscripción
      // pero actualizamos localmente también para una respuesta más rápida
      const updatedOrders = orders
        .map((order) => {
          if (order.id === orderId) {
            // Filtrar el item que se marcó como entregado
            const updatedItems = order.items.filter((item) => item.id !== itemId)

            // Si no quedan items, no incluir esta orden
            if (updatedItems.length === 0) {
              return null
            }

            return {
              ...order,
              items: updatedItems,
            }
          }
          return order
        })
        .filter(Boolean) // Eliminar nulls

      // Actualizar el store con las órdenes actualizadas
      setOrders(updatedOrders)

      // Eliminar el item de la lista de nuevos items
      setNewItems((prev) => {
        if (!prev[orderId]) return prev

        return {
          ...prev,
          [orderId]: prev[orderId].filter((id) => id !== itemId),
        }
      })

      // Verificar si quedan más items en la orden
      const order = orders.find((o) => o.id === orderId)
      if (order) {
        const remainingItems = order.items.filter((item) => item.id !== itemId)

        // Si no quedan más items, actualizar el estado de la mesa a "served"
        if (remainingItems.length === 0) {
          const tableId = order.tableId
          await orderService.updateStatus(orderId, "delivered")

          // Actualizar también en el store local
          updateTableStatus(tableId, "served")
          updateOrderStatus(orderId, "delivered")

          toast({
            title: "Mesa actualizada",
            description: "La mesa ha sido marcada como servida.",
          })
        }
      }
    } catch (error) {
      console.error("Error al marcar el item como entregado:", error)
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
      const order = orders.find((o) => o.id === orderToDeliver)

      if (!order || order.items.length === 0) {
        console.error("Orden no encontrada o sin items")
        return
      }

      // Obtener los IDs de todos los items en estado "kitchen"
      const itemIds = order.items.map((item) => item.id)

      if (itemIds.length === 0) {
        console.log("No hay items para marcar como entregados")
        return
      }

      // Actualizar todos los items a estado "served" en la base de datos
      const { error } = await supabase
        .from("order_items")
        .update({ status: "served", updated_at: new Date().toISOString() })
        .in("id", itemIds)

      if (error) {
        console.error("Error al actualizar estado de los items:", error)
        throw error
      }

      // Actualizar el estado de la mesa a "served"
      const tableId = order.tableId
      await orderService.updateStatus(order.id, "delivered")

      // Actualizar también en el store local
      updateTableStatus(tableId, "served")
      updateOrderStatus(order.id, "delivered")

      toast({
        title: "Orden entregada",
        description: "Todos los productos han sido marcados como entregados y la mesa como servida.",
      })

      // Eliminar la orden del store ya que todos sus items han sido entregados
      removeOrder(orderToDeliver)

      // Eliminar la orden de la lista de nuevos items
      setNewItems((prev) => {
        const newState = { ...prev }
        delete newState[orderToDeliver]
        return newState
      })
    } catch (error) {
      console.error("Error al marcar todos los items como entregados:", error)
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

  // Cancelar una orden recién llegada
  const handleCancelOrder = useCallback(
    async (orderId: string) => {
      try {
        await orderService.deleteOrder(orderId)
        removeOrder(orderId)
        setOrderStockIssues((prev) => {
          const n = { ...prev }
          delete n[orderId]
          return n
        })
        setNewItems((prev) => {
          const newState = { ...prev }
          delete newState[orderId]
          return newState
        })
        toast({
          title: "Orden cancelada",
          description: "La orden fue eliminada correctamente.",
        })
      } catch (error) {
        console.error("Error al cancelar la orden:", error)
        toast({
          title: "Error",
          description: "No se pudo cancelar la orden.",
          variant: "destructive",
        })
      }
    },
    [removeOrder, toast],
  )

  // Confirmar la orden y verificar stock
  const handleConfirmOrder = useCallback(
    async (orderId: string) => {
      const order = ordersRef.current.find((o) => o.id === orderId)
      if (!order) return

      const hasStock = await checkStockForOrder(order)

      if (hasStock) {
        confirmedOrdersRef.current.add(orderId)
        reduceStockForOrder(order)
      }
    },
    [checkStockForOrder, reduceStockForOrder],
  )

  // Confirmar un item específico
  const handleConfirmItem = useCallback(
    async (orderId: string, itemId: string) => {
      const order = ordersRef.current.find((o) => o.id === orderId)
      if (!order) return

      const item = order.items.find((i) => i.id === itemId)
      if (!item) return

      const hasStock = await checkStockForOrder({ ...order, items: [item] })

      if (hasStock) {
        await supabase
          .from("order_items")
          .update({ status: "kitchen", updated_at: new Date().toISOString() })
          .eq("id", itemId)

        if (order.status === "pending") {
          await orderService.updateStatus(orderId, "kitchen")
        }

        reduceStockForOrder({ ...order, items: [item] })
        setOrderStockIssues((prev) => ({ ...prev, [orderId]: false }))
      }
    },
    [checkStockForOrder, reduceStockForOrder],
  )

  // Forzar confirmación cuando no hay stock
  const handleForceConfirmOrder = useCallback(() => {
    if (stockOrderIdRef.current) {
      const id = stockOrderIdRef.current
      const order = ordersRef.current.find((o) => o.id === id)
      if (order) {
        confirmedOrdersRef.current.add(id)
        reduceStockForOrder(order)
        setOrderStockIssues((prev) => ({ ...prev, [id]: false }))
      }
      stockOrderIdRef.current = null
    }
    setShowStockDetailWarning(false)
  }, [reduceStockForOrder])

  const handleCancelStockWarning = useCallback(() => {
    if (stockOrderIdRef.current) {
      handleCancelOrder(stockOrderIdRef.current)
      stockOrderIdRef.current = null
    }
    setShowStockDetailWarning(false)
  }, [handleCancelOrder])

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

  // Si estamos cargando, mostrar indicador
  if (loading) {
    return (
      <div className="flex flex-col h-screen p-4">
        <div className="flex items-center mb-4">
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>

        <div className="flex items-center mb-4">
          <div className="flex space-x-2">
            <Skeleton className="h-10 w-32 rounded-md" />
            <Skeleton className="h-10 w-32 rounded-md" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <div className="space-y-2 mb-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-9 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen p-4">
      <Header profile={profile} onChangeProfile={onChangeProfile} title="Cocina" />

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
                  Mesa: {filterTable}
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

          {pendingOrders.length > 0 && (
            <div className="mb-6">
              <h2 className="font-semibold mb-2">Órdenes nuevas por confirmar</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                {pendingOrders.map((order) => {
                  const table = tables.find((t) => t.id === order.tableId)
                  const waiter = profiles?.find((p) => p.id === order.waiter)
                  return (
                    <ConfirmOrderCard
                      key={order.id}
                      order={order}
                      table={table}
                      waiter={waiter}
                      hasStockIssue={orderStockIssues[order.id]}
                      onConfirmItem={(itemId) => handleConfirmItem(order.id, itemId)}
                      onCancelOrder={() => handleCancelOrder(order.id)}
                    />
                  )
                })}
              </div>
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
                const table = tables.find((t) => t.id === order.tableId)
                const waiter = profiles?.find((p) => p.id === order.waiter)

                return (
                  <OrderCard
                    key={order.id}
                    order={order}
                    table={table}
                    waiter={waiter}
                    onMarkAsDelivered={(itemId) => handleMarkAsDelivered(order.id, itemId)}
                    onMarkAllAsDelivered={() => handleMarkAllAsDelivered(order.id)}
                    isKitchenView={true}
                    newItems={newItems[order.id] || []}
                  />
                )
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="tables">
          <TablesSection
            tables={tables}
            activeTable={selectedTable}
            profile={profile}
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
        waiters={waiters}
        onSelect={handleWaiterSelect}
      />


      {/* Advertencia de inventario */}
      <Dialog open={showStockDetailWarning} onOpenChange={setShowStockDetailWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center text-amber-600">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Advertencia de Inventario
            </DialogTitle>
            <DialogDescription>
              No hay suficiente stock de ingredientes para completar esta orden:
            </DialogDescription>
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
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="outline" onClick={handleCancelStockWarning}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleForceConfirmOrder}>
              Preparar de todos modos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
