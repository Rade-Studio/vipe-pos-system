"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Profile, Order, CartItem } from "@/types"
import { Header } from "@/components/layout/Header"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useShallow } from "zustand/react/shallow"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate } from "@/utils/helpers"
import { CreditCard, SplitSquareVertical, Trash2, User, RefreshCw } from "lucide-react"
import { CashRegisterStatus } from "@/components/cashier/CashRegisterStatus"
import { PaymentMethodDialog } from "@/components/cashier/PaymentMethodDialog"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { PartialPaymentDialog } from "@/components/cashier/PartialPaymentDialog"
import { toast } from "@/utils/toast"
import { TransactionsList } from "@/components/cashier/TransactionsList"
import { Skeleton } from "@/components/ui/skeleton"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { orderService } from "@/lib/supabase/service"
import { queryClient } from "@/lib/queryClient"
import { log } from "@/lib/log"
import { buildSplitItems, pickSplitParent } from "@/lib/payments/split"
import { createSingleFlight } from "@/lib/payments/single-flight"
import { PaymentServiceError, splitOrder, undoSplit } from "@/lib/supabase/payments-service"
import { groupDineInOrdersByTable, orderTypeFromRow } from "@/lib/delivery/kitchen"
import { wireRowToPartialOrder } from "@/lib/realtime/order-merge"
import { DeliveryPaymentsPanel } from "@/components/cashier/DeliveryPaymentsPanel"

interface CashierViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

export function CashierView({ profile, onChangeProfile, authRole }: CashierViewProps) {
  const [activeTab, setActiveTab] = useState<"orders" | "transactions">("orders")
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [partialPaymentDialogOpen, setPartialPaymentDialogOpen] = useState(false)
  const [paymentMethodDialogOpen, setPaymentMethodDialogOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [showCompletedInvoice, setShowCompletedInvoice] = useState(false)
  const [completedInvoiceData, setCompletedInvoiceData] = useState<PrintableInvoice | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSplitting, setIsSplitting] = useState(false)
  const [isUndoingSplit, setIsUndoingSplit] = useState(false)
  // Synchronous gates: the state flags above only drive the UI.
  const [splitGate] = useState(createSingleFlight)
  const [undoGate] = useState(createSingleFlight)
  const [partialParentItems, setPartialParentItems] = useState<CartItem[]>([])

  // Estados para almacenar datos en tiempo real
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([])
  const [deliveredOrders, setDeliveredOrders] = useState<Order[]>([])
  const [partialOrders, setPartialOrders] = useState<Order[]>([])
  const [ordersByTable, setOrdersByTable] = useState<Record<string, Order[]>>({})
  const [refreshing, setRefreshing] = useState(false)

  

  // Fetch all orders via React Query
  const fetchAllOrders = async () => {
    const [activeData, kitchenData, deliveredData] = await Promise.all([
      orderService.getByStatus(["active"]),
      orderService.getByStatus(["kitchen"]),
      orderService.getByStatus(["delivered"]),
    ])

    const convertDBOrderToAppOrder = (dbOrder: any): Order => ({
      id: dbOrder.id,
      tableId: dbOrder.table_id ?? "",
      orderType: orderTypeFromRow(dbOrder),
      items: dbOrder.order_items.map((item: any) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        comments: item.comments || undefined,
        categoryId: "",
      })),
      status: dbOrder.status,
      bill: {
        subtotal: dbOrder.subtotal,
        tax: dbOrder.tax,
        taxPercentage: dbOrder.tax_percentage,
        tip: dbOrder.tip,
        tipPercentage: dbOrder.tip_percentage,
        total: dbOrder.total,
        totalDiscounts: dbOrder.total_discounts ?? 0,
      },
      waiter: dbOrder.waiter_id ?? "",
      createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
      isPartialOrder: dbOrder.is_partial_order || false,
      parentOrderId: dbOrder.parent_order_id || null,
    })

    const activeOrdersConverted = activeData.map(convertDBOrderToAppOrder)
    const kitchenOrdersConverted = kitchenData.map(convertDBOrderToAppOrder)
    const deliveredOrdersConverted = deliveredData.map(convertDBOrderToAppOrder)
    const allOrders = [...activeOrdersConverted, ...kitchenOrdersConverted, ...deliveredOrdersConverted]
    const partialOrdersFiltered = allOrders.filter((order) => order.isPartialOrder)
    // Delivery orders have no table: DeliveryPaymentsPanel lists them.
    const ordersByTableGrouped = groupDineInOrdersByTable(allOrders)

    return { activeOrdersConverted, kitchenOrdersConverted, deliveredOrdersConverted, partialOrdersFiltered, ordersByTableGrouped }
  }

  const { data: ordersData } = useQuery({
    queryKey: ['orders', 'cashier'],
    queryFn: fetchAllOrders,
  })

  // D6 Rule B: render-path reads project to a primitive (table number) via a
  // shallow-compared lookup map, never to the full `tables` array — see design.md D6.
  const tableNumberById = useTableStore(
    useShallow((s) => {
      const map: Record<string, number> = {}
      for (const t of s.tables) map[t.id] = t.number
      return map
    }),
  )
  const profiles = useProfileStore((s) => s.profiles)

  const { isRegisterOpen, loadCurrentRegister } = useCashRegisterStore()
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()

  // Función para cargar órdenes desde la base de datos
  const loadOrdersFromDB = useCallback(async () => {
    setIsLoading(true)
    try {
      // Cargar órdenes por estado en paralelo para mejorar el rendimiento
      const [activeOrdersData, kitchenOrdersData, deliveredOrdersData] = await Promise.all([
        orderService.getByStatus(["active"]),
        orderService.getByStatus(["kitchen"]),
        orderService.getByStatus(["delivered"]),
      ])

      // Convertir datos de la BD al formato de la aplicación
      const convertDBOrderToAppOrder = (dbOrder: any): Order => ({
        id: dbOrder.id,
        tableId: dbOrder.table_id ?? "",
        orderType: orderTypeFromRow(dbOrder),
        items: dbOrder.order_items.map((item: any) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          comments: item.comments || undefined,
          categoryId: "",
        })),
        status: dbOrder.status,
        bill: {
          subtotal: dbOrder.subtotal,
          tax: dbOrder.tax,
          taxPercentage: dbOrder.tax_percentage,
          tip: dbOrder.tip,
          tipPercentage: dbOrder.tip_percentage,
          total: dbOrder.total,
          totalDiscounts: dbOrder.total_discounts ?? 0,
        },
        waiter: dbOrder.waiter_id ?? "",
        createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
        isPartialOrder: dbOrder.is_partial_order || false,
        parentOrderId: dbOrder.parent_order_id || null,
      } as unknown as Order)

      // Convertir todas las órdenes
      const activeOrdersConverted = activeOrdersData.map(convertDBOrderToAppOrder)
      const kitchenOrdersConverted = kitchenOrdersData.map(convertDBOrderToAppOrder)
      const deliveredOrdersConverted = deliveredOrdersData.map(convertDBOrderToAppOrder)

      // Combinar todas las órdenes
      const allOrders = [...activeOrdersConverted, ...kitchenOrdersConverted, ...deliveredOrdersConverted]

      // Filtrar órdenes parciales
      const partialOrdersFiltered = allOrders.filter((order) => order.isPartialOrder)

      // Agrupar órdenes por mesa (excluyendo parciales y domicilios)
      const ordersByTableGrouped = groupDineInOrdersByTable(allOrders)

      // Actualizar estados
      setActiveOrders(activeOrdersConverted)
      setKitchenOrders(kitchenOrdersConverted)
      setDeliveredOrders(deliveredOrdersConverted)
      setPartialOrders(partialOrdersFiltered)
      setOrdersByTable(ordersByTableGrouped)
    } catch (error) {
      log.error("Error al cargar órdenes:", { error: String(error) })
      toast.error("Error al cargar órdenes desde la base de datos")
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Función para refrescar manualmente los datos
  const handleRefresh = () => {
    setRefreshing(true)
    queryClient.invalidateQueries({ queryKey: ['orders', 'cashier'] })
    setRefreshing(false)
  }

  // Sync orders data from React Query to local state
  useEffect(() => {
    if (ordersData) {
      setActiveOrders(ordersData.activeOrdersConverted)
      setKitchenOrders(ordersData.kitchenOrdersConverted)
      setDeliveredOrders(ordersData.deliveredOrdersConverted)
      setPartialOrders(ordersData.partialOrdersFiltered)
      setOrdersByTable(ordersData.ordersByTableGrouped)
    }
  }, [ordersData])

  // Cargar datos de caja al montar y suscribirse a realtime
  useEffect(() => {
    loadCurrentRegister()

    // Suscribirse a cambios en órdenes
    const unsubscribe = realtimeService.subscribeToOrders((payload) => {
      log.info("Cambio en orden recibido:", { payload })

      // S5: replace the per-event invalidateQueries with direct local-state
      // mutation. The cashier cache is a 5-derive object under ['orders','cashier'],
      // so patching the React Query cache alone would not reach any of the
      // local-state arrays this view renders from (activeOrders / kitchenOrders
      // / deliveredOrders / partialOrders / ordersByTable) until the next refetch.
      // D7 consequence 2: only carry fields the broadcast actually sent — do
      // not fabricate items/bill on INSERT; on UPDATE the { ...x, ...patch }
      // shape preserves untouched Order fields (items/bill/etc.) by reference.
      // Delivery invariant (odd/tasks/domicilios.md S13/S14): the shared
      // `wireRowToPartialOrder` maps the wire row with
      // `orderType: orderTypeFromRow(row)` — the same mapping the initial-load
      // converter uses — so a domicilio arriving over realtime keeps its
      // delivery flag instead of being labelled "Mesa ?".
      const id = (payload.new as any)?.id ?? (payload.old as any)?.id
      if (id) {
        if (payload.eventType === "INSERT") {
          const patch = wireRowToPartialOrder(payload.new)
          if (patch?.id && patch.status) {
            const o: Order = {
              id: patch.id,
              tableId: patch.tableId ?? "",
              orderType: patch.orderType,
              items: [],
              status: patch.status,
              bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
              waiter: patch.waiter ?? "",
              createdAt: new Date(),
            }
            if (o.status === "active") setActiveOrders((prev) => [...prev, o])
            else if (o.status === "kitchen") setKitchenOrders((prev) => [...prev, o])
            else if (o.status === "delivered") setDeliveredOrders((prev) => [...prev, o])
          }
        } else if (payload.eventType === "UPDATE") {
          const patch = wireRowToPartialOrder(payload.new) ?? {}
          const apply = (setter: React.Dispatch<React.SetStateAction<Order[]>>) =>
            setter((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
          apply(setActiveOrders)
          apply(setKitchenOrders)
          apply(setDeliveredOrders)
        } else if (payload.eventType === "DELETE") {
          setActiveOrders((prev) => prev.filter((x) => x.id !== id))
          setKitchenOrders((prev) => prev.filter((x) => x.id !== id))
          setDeliveredOrders((prev) => prev.filter((x) => x.id !== id))
          setPartialOrders((prev) => prev.filter((x) => x.id !== id))
          setOrdersByTable((prev) => {
            const out: Record<string, Order[]> = {}
            for (const [k, v] of Object.entries(prev)) {
              const filtered = (v || []).filter((x) => x.id !== id)
              if (filtered.length) out[k] = filtered
            }
            return out
          })
        }
      }
    })

    // Limpiar suscripción al desmontar
    return () => {
      unsubscribe()
    }
  }, [loadCurrentRegister])

  // Función para obtener una orden por ID
  const getOrderById = useCallback(
    (orderId: string): Order | undefined => {
      // Buscar en todas las órdenes
      const allOrders = [...activeOrders, ...kitchenOrders, ...deliveredOrders]
      return allOrders.find((order) => order.id === orderId)
    },
    [activeOrders, kitchenOrders, deliveredOrders],
  )

  // Función para obtener órdenes por mesa
  const getOrdersByTable = useCallback(
    (tableId: string): Order[] => {
      return ordersByTable[tableId] || []
    },
    [ordersByTable],
  )

  // Función para obtener el total de una mesa
  const getTableTotalAmount = useCallback(
    (tableId: string): number => {
      const orders = getOrdersByTable(tableId)
      return orders.reduce((total, order) => total + order.bill.total, 0)
    },
    [getOrdersByTable],
  )

  // Función para obtener todos los items de una mesa
  const getAllTableItems = useCallback(
    (tableId: string): CartItem[] => {
      const tableOrders = getOrdersByTable(tableId)
      const items = tableOrders.flatMap((order) => order.items)

      // Agrupar items por nombre y comentarios
      const groupedItems: Record<string, CartItem> = {}

      items.forEach((item) => {
        const key = `${item.name}-${item.comments || ""}`

        if (!groupedItems[key]) {
          groupedItems[key] = { ...item }
        } else {
          groupedItems[key].quantity += item.quantity
        }
      })

      return Object.values(groupedItems)
    },
    [getOrdersByTable],
  )

  // Handle opening payment dialog for a table
  const handleOpenPaymentDialog = (orderId: string) => {
    // Verificar si la caja está abierta
    if (!isRegisterOpen()) {
      toast.error("Debe abrir la caja antes de procesar pagos")
      return
    }

    setSelectedOrderId(orderId)
    setPaymentMethodDialogOpen(true)
  }

  // Handle completing payment after method selection
  const handlePaymentComplete = async () => {
    if (selectedOrderId) {
      try {
        // Limpiar estados
        setSelectedOrderId(null)
        setSelectedTableId(null)
        setPaymentMethodDialogOpen(false)

        // Recargar órdenes
        await loadOrdersFromDB()
      } catch (error) {
        log.error("Error al procesar el pago:", { error: String(error) })
      }
    }
  }

  // Handle partial payment
  const handleOpenPartialPayment = (tableId: string) => {
    // Verificar si la caja está abierta
    if (!isRegisterOpen()) {
      toast.error("Debe abrir la caja antes de procesar pagos")
      return
    }

    // The server's split_order RPC only accepts the parent's own
    // items, not the merged table view. Resolve the single splittable
    // parent (non-partial, active|kitchen|delivered) and bail out
    // early if the table is ambiguous.
    const tableOrders = getOrdersByTable(tableId)
    const parentId = pickSplitParent(
      tableOrders.map((o) => ({
        id: o.id,
        isPartialOrder: !!o.isPartialOrder,
        status: o.status,
      })),
    )
    if (!parentId) {
      toast.error(
        "No hay una orden principal válida para crear el pago parcial. Verifique que la mesa tenga una sola orden en estado activo, en cocina o entregada.",
      )
      return
    }
    const parentOrder = tableOrders.find((o) => o.id === parentId)
    if (!parentOrder) {
      toast.error("No se encontró la orden padre para el pago parcial")
      return
    }

    // Feed the dialog ONLY the parent's items (mirrors the server rule).
    const parentItems: CartItem[] = parentOrder.items.map((item) => ({ ...item }))
    if (parentItems.length === 1 && parentItems[0].quantity === 1) {
      toast.error("No se puede hacer pago parcial con un solo producto")
      return
    }

    setPartialParentItems(parentItems)
    setSelectedTableId(tableId)
    setPartialPaymentDialogOpen(true)
  }

  // Translate PaymentServiceError kinds into Spanish toast messages
  // the same way the rest of the cashier does (kept local so this
  // file stays the only place that knows the user-facing strings).
  const splitErrorMessage = (kind: string, fallback: string): string => {
    switch (kind) {
      case 'not-authorized':
        return 'No tiene permisos para modificar órdenes'
      case 'not-found':
        return 'La orden ya no existe o fue pagada'
      case 'rejected':
        return fallback // server message explains the business rule
      case 'invalid-input':
        return 'La selección de productos no es válida'
      default:
        return 'No se pudo procesar la operación. Intente nuevamente.'
    }
  }

  // Manejar la creación de una orden parcial
  const handleCreatePartialOrder = async (items: { itemId: string; quantity: number }[]) => {
    if (!selectedTableId || splitGate.isRunning()) return

    const tableOrders = getOrdersByTable(selectedTableId)
    const parentId = pickSplitParent(
      tableOrders.map((o) => ({
        id: o.id,
        isPartialOrder: !!o.isPartialOrder,
        status: o.status,
      })),
    )
    if (!parentId) {
      toast.error("La orden padre ya no está disponible para el pago parcial")
      return
    }

    // Convert the dialog payload (itemId/quantity) into the
    // buildSplitItems input keyed by the parent's order_item.id.
    const selection: Record<string, number> = {}
    for (const it of items) selection[it.itemId] = it.quantity

    const parentOrder = tableOrders.find((o) => o.id === parentId)
    if (!parentOrder) return
    const parentItems = parentOrder.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    }))

    const validation = buildSplitItems(parentItems, selection)
    if ('error' in validation) {
      const messages: Record<typeof validation.error, string> = {
        empty: 'Debe seleccionar al menos un producto para el pago parcial',
        'over-quantity':
          'La cantidad seleccionada supera la cantidad disponible en la orden',
        'unknown-item': 'Uno de los productos seleccionados ya no pertenece a la orden',
        'moves-everything':
          'Está moviendo toda la orden. Use el pago total en lugar del pago parcial',
        'too-many-lines': 'La orden parcial admite máximo 50 líneas',
      }
      toast.error(messages[validation.error])
      return
    }

    await splitGate.run(async () => {
      try {
        setIsSplitting(true)

        await splitOrder({
          parentOrderId: parentId,
          items: validation.items.map((i) => ({ orderItemId: i.order_item_id, quantity: i.quantity })),
        })

        toast.success('Se ha creado una nueva orden parcial para el pago')
        setPartialPaymentDialogOpen(false)
        await loadOrdersFromDB()
      } catch (error) {
        if (error instanceof PaymentServiceError) {
          log.error('Error al crear la orden parcial:', { kind: error.kind, message: error.message })
          toast.error(splitErrorMessage(error.kind, error.message))
        } else {
          log.error('Error al crear la orden parcial:', { error: String(error) })
          toast.error('No se pudo crear la orden parcial')
        }
      } finally {
        setIsSplitting(false)
      }
    })
  }

  // Manejar la eliminación (undo) de una orden parcial
  const handleDeletePartialOrder = async (partialOrderId: string) => {
    await undoGate.run(async () => {
      try {
        setIsUndoingSplit(true)

        await undoSplit({ childOrderId: partialOrderId })

        toast.success('Los productos han sido devueltos a la orden original')
        await loadOrdersFromDB()
      } catch (error) {
        if (error instanceof PaymentServiceError) {
          log.error('Error al eliminar la orden parcial:', { kind: error.kind, message: error.message })
          toast.error(splitErrorMessage(error.kind, error.message))
        } else {
          log.error('Error al eliminar la orden parcial:', { error: String(error) })
          toast.error('No se pudo eliminar la orden parcial')
        }
      } finally {
        setIsUndoingSplit(false)
      }
    })
  }

  // Función para mostrar la factura completada
  const showInvoice = (orderId: string) => {
    const order = getOrderById(orderId)
    if (!order) return

    // D6 Rule A: handler-only read, no subscription needed at the point of use.
    const table = useTableStore.getState().getTableById(order.tableId)
    const waiter = profiles.find((p) => p.id === order.waiter)

    if (!table || !waiter) return

    // Asegurarse de que los items y el bill estén correctos
    const items = order.items
    const bill = order.bill

    if (items.length === 0 || !bill) {
      toast.error("No se pueden generar facturas sin productos")
      return
    }

    const invoice: PrintableInvoice = {
      invoiceNumber: `INV-${Date.now()}`,
      date: new Date(),
      businessInfo: {
        name: businessName,
        address: businessAddress,
        phone: businessPhone,
        nit: businessNIT,
      },
      items: items,
      bill: bill,
      waiter: waiter.name,
      table: table.number,
      paymentMethod: (order as any).paymentMethod || "cash"
    }

    setCompletedInvoiceData(invoice)
    setShowCompletedInvoice(true)
  }

  // Calcular datos para análisis
  const calculateAnalytics = useCallback(() => {
    // Obtener todas las órdenes pagadas
    const paidOrders = [...activeOrders, ...kitchenOrders, ...deliveredOrders].filter(
      (order) => order.status === "paid",
    )

    // Total de ventas
    const totalSales = paidOrders.reduce((total, order) => total + order.bill.total, 0)

    // Número de órdenes completadas
    const completedOrdersCount = paidOrders.length

    // Valor promedio de orden
    const averageOrderValue = completedOrdersCount > 0 ? totalSales / completedOrdersCount : 0

    // Ventas diarias (últimos 7 días)
    const dailySales = (() => {
      const result = []
      const today = new Date()

      for (let i = 0; i < 7; i++) {
        const date = new Date(today)
        date.setDate(today.getDate() - i)
        const dateStr = date.toISOString().split("T")[0]

        const amount = paidOrders
          .filter((order) => order.createdAt.toISOString().split("T")[0] === dateStr)
          .reduce((sum, order) => sum + order.bill.total, 0)

        result.push({ date: dateStr, amount })
      }

      return result
    })()

    // Platos populares
    const popularDishes = (() => {
      const dishCounts: Record<string, number> = {}

      paidOrders.forEach((order) => {
        order.items.forEach((item) => {
          if (!dishCounts[item.name]) {
            dishCounts[item.name] = 0
          }
          dishCounts[item.name] += item.quantity
        })
      })

      return Object.entries(dishCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    })()

    // Ventas por categoría
    const categorySales = (() => {
      const sales: Record<string, number> = {}

      paidOrders.forEach((order) => {
        order.items.forEach((item) => {
          if (!sales[item.categoryId]) {
            sales[item.categoryId] = 0
          }
          sales[item.categoryId] += item.price * item.quantity
        })
      })

      return Object.entries(sales).map(([category, amount]) => ({ category, amount }))
    })()

    return {
      totalSales,
      completedOrdersCount,
      averageOrderValue,
      dailySales,
      popularDishes,
      categorySales,
    }
  }, [activeOrders, kitchenOrders, deliveredOrders])

  // Obtener datos de análisis
  const analytics = calculateAnalytics()

  // Category mapping
  const categoryMap: Record<string, string> = {
    "1": "Entradas",
    "2": "Platos Principales",
    "3": "Postres",
    "4": "Bebidas",
    "5": "Café",
  }

  return (
    <div className="flex flex-col h-screen p-4">
      <Header
        profile={profile}
        onChangeProfile={onChangeProfile}
        authRole={authRole}
        title={activeTab === "orders" ? "Caja - Órdenes para Facturar" : "Historial de Transacciones"}
      />
      <div className="flex justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || isLoading}
          className="ml-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar datos
        </Button>
      </div>

      <Tabs defaultValue="orders" onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList className="mb-4">
          <TabsTrigger value="orders">Órdenes</TabsTrigger>
          <TabsTrigger value="transactions">Transacciones</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <div className="mb-6">
            <CashRegisterStatus />
          </div>

          {isLoading ? (
            <div className="space-y-6">
              <div className="border rounded-lg p-4 bg-muted/10">
                <div className="flex justify-between items-center mb-4">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-6 w-32" />
                </div>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-3/4" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="border rounded-lg overflow-hidden">
                    <div className="p-4 border-b bg-muted/20">
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-5 w-24 rounded-full" />
                      </div>
                      <Skeleton className="h-4 w-40 mt-2" />
                    </div>

                    <div className="p-4 h-48">
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                        <div className="flex justify-between">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                        <div className="flex justify-between">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                      </div>
                    </div>

                    <div className="p-4 border-t bg-muted/10">
                      <div className="flex justify-between mb-4">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-24" />
                      </div>
                      <div className="flex gap-2">
                        <Skeleton className="h-9 w-full rounded-md" />
                        <Skeleton className="h-9 w-full rounded-md" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <DeliveryPaymentsPanel onPaid={() => void loadOrdersFromDB()} />

              {partialOrders.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-3">
                    {isLoading ? <Skeleton className="h-7 w-40 inline-block" /> : "Órdenes Parciales"}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {isLoading
                      ? // Skeletons para órdenes parciales
                        Array.from({ length: 2 }).map((_, i) => (
                          <Card key={`skeleton-partial-${i}`} className="overflow-hidden border-2 border-primary/10">
                            <CardContent className="p-0">
                              <div className="p-4 border-b bg-primary/5">
                                <div className="flex justify-between items-center">
                                  <Skeleton className="h-5 w-40" />
                                  <Skeleton className="h-5 w-24 rounded-full" />
                                </div>
                                <div className="flex items-center mt-1">
                                  <Skeleton className="h-4 w-24 mt-2" />
                                </div>
                                <Skeleton className="h-3 w-32 mt-1" />
                              </div>

                              <div className="h-48 p-4">
                                <div className="space-y-3">
                                  {Array.from({ length: 3 }).map((_, j) => (
                                    <div key={j} className="flex flex-col py-2 border-b">
                                      <div className="flex justify-between">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-4 w-20" />
                                      </div>
                                      <Skeleton className="h-3 w-40 mt-1" />
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="p-4 border-t bg-muted/5">
                                <div className="flex justify-between mb-4">
                                  <Skeleton className="h-5 w-16" />
                                  <Skeleton className="h-5 w-24" />
                                </div>
                                <div className="flex gap-2">
                                  <Skeleton className="h-9 w-full rounded-md" />
                                  <Skeleton className="h-9 w-full rounded-md" />
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      : // Contenido real de órdenes parciales
                        partialOrders.map((order) => {
                          // D6 Rule B: render path only needs the table's number.
                          const tableNumber = tableNumberById[order.tableId]
                          const waiter = profiles?.find((p) => p.id === order.waiter)

                          // Agrupar items por nombre y comentarios
                          const groupedItems: Record<string, CartItem> = {}
                          order.items.forEach((item) => {
                            const key = `${item.name}-${item.comments || ""}`
                            if (!groupedItems[key]) {
                              groupedItems[key] = { ...item }
                            } else {
                              groupedItems[key].quantity += item.quantity
                            }
                          })
                          const displayItems = Object.values(groupedItems)

                          return (
                            <Card key={order.id} className="overflow-hidden border-2 border-primary/30">
                              <CardContent className="p-0">
                                <div className="p-4 border-b bg-primary/10">
                                  <div className="flex justify-between items-center">
                                    <h3 className="font-bold">Mesa {tableNumber} - Orden Parcial</h3>
                                    <Badge variant="outline" className="bg-primary/20">
                                      {displayItems.reduce((total, item) => total + item.quantity, 0)} unidades
                                    </Badge>
                                  </div>
                                  {waiter && (
                                    <div className="flex items-center mt-1">
                                      <User className="h-3 w-3 mr-1 text-muted-foreground" />
                                      <Badge variant="secondary" className="text-xs">
                                        {waiter.name}
                                      </Badge>
                                    </div>
                                  )}
                                  <div className="text-sm text-muted-foreground">
                                    Creado: {formatDate(order.createdAt)}
                                  </div>
                                </div>

                                <ScrollArea className="h-48 p-4">
                                  {displayItems.map((item) => (
                                    <div
                                      key={`${item.name}-${item.comments || ""}`}
                                      className="flex flex-col py-2 border-b last:border-0"
                                    >
                                      <div className="flex justify-between">
                                        <div className="font-medium">{item.name}</div>
                                        <div className="font-medium">
                                          {formatCurrency(item.price * item.quantity)} ({item.quantity}x)
                                        </div>
                                      </div>
                                      {item.comments && (
                                        <div className="text-xs italic text-muted-foreground">{item.comments}</div>
                                      )}
                                    </div>
                                  ))}
                                </ScrollArea>

                                <div className="p-4 border-t bg-muted/10">
                                  <div className="flex justify-between font-bold mb-4">
                                    <span>Total:</span>
                                    <span>{formatCurrency(order.bill.total)}</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      className="flex-1"
                                      onClick={() => handleDeletePartialOrder(order.id)}
                                      disabled={isUndoingSplit}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Eliminar
                                    </Button>
                                    <Button className="flex-1" onClick={() => handleOpenPaymentDialog(order.id)}>
                                      <CreditCard className="mr-2 h-4 w-4" />
                                      Pago Total
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}
                  </div>
                </div>
              )}

              {/* Órdenes Regulares */}
              <h3 className="text-lg font-semibold mb-3">
                {isLoading ? <Skeleton className="h-7 w-40 inline-block" /> : "Órdenes Regulares"}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading ? (
                  // Skeletons para órdenes regulares
                  Array.from({ length: 4 }).map((_, i) => (
                    <Card key={`skeleton-regular-${i}`} className="overflow-hidden">
                      <CardContent className="p-0">
                        <div className="p-4 border-b bg-muted/20">
                          <div className="flex justify-between items-center">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-5 w-24 rounded-full" />
                          </div>
                          <div className="flex items-center mt-1">
                            <Skeleton className="h-4 w-24 mt-2" />
                          </div>
                          <Skeleton className="h-3 w-40 mt-1" />
                        </div>

                        <div className="h-48 p-4">
                          <div className="space-y-3">
                            {Array.from({ length: 4 }).map((_, j) => (
                              <div key={j} className="flex flex-col py-2 border-b">
                                <div className="flex justify-between">
                                  <Skeleton className="h-4 w-32" />
                                  <Skeleton className="h-4 w-20" />
                                </div>
                                <Skeleton className="h-3 w-40 mt-1" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="p-4 border-t bg-muted/10">
                          <div className="flex justify-between mb-4">
                            <Skeleton className="h-5 w-16" />
                            <Skeleton className="h-5 w-24" />
                          </div>
                          <div className="flex gap-2">
                            <Skeleton className="h-9 w-full rounded-md" />
                            <Skeleton className="h-9 w-full rounded-md" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : Object.keys(ordersByTable).length === 0 ? (
                  <div className="col-span-full text-center py-10 text-muted-foreground">
                    No hay órdenes pendientes para facturar
                  </div>
                ) : (
                  Object.entries(ordersByTable).map(([tableId, orders]) => {
                    // D6 Rule B: render path only needs the table's number.
                    const tableNumber = tableNumberById[tableId]
                    const tableTotal = getTableTotalAmount(tableId)

                    // Get all items from all orders for this table and group them
                    const allItems = getAllTableItems(tableId)

                    // Verificar si solo hay un producto con cantidad 1
                    const isSingleItemWithQuantityOne = allItems.length === 1 && allItems[0].quantity === 1

                    // Get the waiter from the first order
                    const waiter = profiles?.find((p) => p.id === orders[0].waiter)

                    return (
                      <Card key={tableId} className="overflow-hidden">
                        <CardContent className="p-0">
                          <div className="p-4 border-b bg-muted/20">
                            <div className="flex justify-between items-center">
                              <h3 className="font-bold">Mesa {tableNumber}</h3>
                              <Badge variant="default">
                                {allItems.reduce((total, item) => total + item.quantity, 0)} unidades
                              </Badge>
                            </div>
                            {waiter && (
                              <div className="flex items-center mt-1">
                                <User className="h-3 w-3 mr-1 text-muted-foreground" />
                                <Badge variant="secondary" className="text-xs">
                                  {waiter.name}
                                </Badge>
                              </div>
                            )}
                            <div className="text-sm text-muted-foreground">
                              Última actualización: {formatDate(orders[orders.length - 1].createdAt)}
                            </div>
                          </div>

                          <ScrollArea className="h-48 p-4">
                            {allItems.map((item) => (
                              <div
                                key={`${item.name}-${item.comments || ""}`}
                                className="flex flex-col py-2 border-b last:border-0"
                              >
                                <div className="flex justify-between">
                                  <div className="font-medium">{item.name}</div>
                                  <div className="font-medium">
                                    {formatCurrency(item.price * item.quantity)} ({item.quantity}x)
                                  </div>
                                </div>
                                {item.comments && (
                                  <div className="text-xs italic text-muted-foreground">{item.comments}</div>
                                )}
                              </div>
                            ))}
                          </ScrollArea>

                          <div className="p-4 border-t bg-muted/10">
                            <div className="flex justify-between font-bold mb-4">
                              <span>Total:</span>
                              <span>{formatCurrency(tableTotal)}</span>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                className="flex-1"
                                variant="outline"
                                onClick={() => handleOpenPartialPayment(tableId)}
                                disabled={isSingleItemWithQuantityOne}
                                title={
                                  isSingleItemWithQuantityOne
                                    ? "No se puede hacer pago parcial con un solo producto"
                                    : ""
                                }
                              >
                                <SplitSquareVertical className="mr-2 h-4 w-4" />
                                Pago Parcial
                              </Button>
                              <Button className="flex-1" onClick={() => handleOpenPaymentDialog(orders[0].id)}>
                                <CreditCard className="mr-2 h-4 w-4" />
                                Pago Total
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="transactions">
          <CashRegisterStatus />
          <div className="mt-6">
            <TransactionsList />
          </div>
        </TabsContent>
      </Tabs>

      {/* Partial Payment Dialog */}
      {selectedTableId && (
        <PartialPaymentDialog
          open={partialPaymentDialogOpen}
          onOpenChange={setPartialPaymentDialogOpen}
          tableItems={partialParentItems}
          onCreatePartialOrder={handleCreatePartialOrder}
          busy={isSplitting}
        />
      )}

      {/* Payment Method Dialog */}
      {selectedOrderId && (
        <PaymentMethodDialog
          open={paymentMethodDialogOpen}
          onOpenChange={setPaymentMethodDialogOpen}
          orderId={selectedOrderId}
          tableId={getOrderById(selectedOrderId)?.tableId || ""}
          amount={getOrderById(selectedOrderId)?.bill.total || 0}
          tableTotal={getTableTotalAmount(getOrderById(selectedOrderId)?.tableId || "")}
          onSuccess={handlePaymentComplete}
          isPartialPayment={getOrderById(selectedOrderId)?.isPartialOrder || false}
          selectedItems={[]}
        />
      )}

      {/* Completed Invoice View */}
      {completedInvoiceData && (
        <InvoicePrintView
          invoice={completedInvoiceData}
          open={showCompletedInvoice}
          onOpenChange={setShowCompletedInvoice}
          isPartialPayment={false}
        />
      )}
    </div>
  )
}
