"use client"

import type React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { Profile, Order, CartItem } from "@/types"
import { Header } from "@/components/layout/Header"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useShallow } from "zustand/react/shallow"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/utils/helpers"
import { RefreshCw, WifiOff, AlertTriangle, BarChart3, Plus } from "lucide-react"
import { CashRegisterStatus } from "@/components/cashier/CashRegisterStatus"
import { PaymentPanel, type PaymentPanelTotals } from "@/components/cashier/PaymentPanel"
import { CashierQueue, type QueueTab } from "@/components/cashier/CashierQueue"
import { OrderDetail } from "@/components/cashier/OrderDetail"
import { Money, focusRing } from "@/components/cashier/cashier-ui"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { PartialPaymentDialog } from "@/components/cashier/PartialPaymentDialog"
import { toast } from "@/utils/toast"
import { TransactionsList } from "@/components/cashier/TransactionsList"
import { realtimeService } from "@/lib/api/realtime"
import { getByStatus } from "@/lib/api/orders"
import { queryClient } from "@/lib/queryClient"
import { log } from "@/lib/log"
import { buildSplitItems, pickSplitParent } from "@/lib/payments/split"
import { createSingleFlight } from "@/lib/payments/single-flight"
import { splitOrder, undoSplit } from "@/lib/api/payments"
import { PaymentServiceError } from "@/lib/payments/types"
import {
  CASHIER_ORDER_INCLUDES,
  CASHIER_ORDER_STATUSES,
  applyCashierOrderEvent,
  billSourceFromOrder,
  cashierOrdersQueryKey,
  type CashierOrder,
  deriveCashierViews,
  toCashierOrder,
} from "@/lib/cashier/orders"
import { BillChangedBanner } from "@/components/cashier/BillChangedBanner"
import { usePhone } from "@/lib/cashier/use-phone"
import { DeliveryPaymentsPanel } from "@/components/cashier/DeliveryPaymentsPanel"
import { PaidOrdersList, registerPaidOrdersQueryKey } from "@/components/cashier/PaidOrdersList"
import { VoidFlow } from "@/components/voids/VoidFlow"
import type { VoidLine, VoidTarget } from "@/components/voids/flow"
import type { PaidOrderRow } from "@/lib/cashier/paid-orders"
import { ShiftSummarySheet } from "@/components/cashier/ShiftSummarySheet"
import { LivePill } from "@/components/cashier/LivePill"
import { CashierTablesView } from "@/components/cashier/CashierTablesView"
import { useZones } from "@/hooks/use-zones"
import type { CashRegisterWithOpener } from "@/lib/api/registers"
import { useActiveDeliveries } from "@/hooks/use-active-deliveries"
import { pendingDeliveryPayments } from "@/lib/delivery/kitchen"
import {
  clockTime,
  entryTotals,
  billLineKey,
  groupItems,
  matchesQueueSearch,
  partialEntries,
  tableEntries,
  takeawayEntries,
  takeawayLabel,
  type QueueEntry,
} from "@/lib/cashier/queue"
import { TakeawayStartDialog } from "@/components/takeaway/TakeawayStartDialog"
import { TakeawayOrderFlow } from "@/components/takeaway/TakeawayOrderFlow"
import type { TakeawayCustomer } from "@/components/takeaway/customer"
import { useOnlineStatus } from "@/lib/cashier/use-online-status"
import { cn } from "@/lib/utils"

type CashierTab = "orders" | "tables" | "transactions"
const TAB_TITLES: Record<CashierTab, string> = { orders: "Caja", tables: "Plano de mesas", transactions: "Resumen del turno" }

/** Stable empty reference so the query's default value never re-allocates. */
const NO_ORDERS: Order[] = []

interface CashierViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

export function CashierView({ profile, onChangeProfile, authRole }: CashierViewProps) {
  const [activeTab, setActiveTab] = useState<CashierTab>("orders")
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [partialPaymentDialogOpen, setPartialPaymentDialogOpen] = useState(false)
  // T14: the queue row whose detail and payment panel are on screen.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [queueTab, setQueueTab] = useState<QueueTab>("tables")
  const [query, setQuery] = useState("")
  // Phone step flow (Órdenes → Detalle → Pago); tablet and desktop show the panes together.
  const [step, setStep] = useState<"queue" | "detail" | "pay">("queue")
  const [payTotals, setPayTotals] = useState<PaymentPanelTotals | null>(null)
  const [showCompletedInvoice, setShowCompletedInvoice] = useState(false)
  const [completedInvoiceData, setCompletedInvoiceData] = useState<PrintableInvoice | null>(null)
  // A paid invoice closes the order when dismissed; a reprint only closes itself.
  const [invoiceIsPayment, setInvoiceIsPayment] = useState(false)
  const [isSplitting, setIsSplitting] = useState(false)
  const [isUndoingSplit, setIsUndoingSplit] = useState(false)
  // Synchronous gates: the state flags above only drive the UI.
  const [splitGate] = useState(createSingleFlight)
  const [undoGate] = useState(createSingleFlight)
  const [partialParentItems, setPartialParentItems] = useState<CartItem[]>([])
  const [shiftSheetOpen, setShiftSheetOpen] = useState(false)
  // "Precio cambió" (T24): reported by the payment panel, shown over the detail
  // pane (on phone at the top of the current step), as in the design.
  const [billNotice, setBillNotice] = useState<string | null>(null)
  const phone = usePhone()
  // F3: the cancellation / void being taken through the step sheet.
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  // S8: "Para llevar" asks the customer, then takes the order with the waiter's step flow.
  const [takeawayDialogOpen, setTakeawayDialogOpen] = useState(false)
  const [takeawayCustomer, setTakeawayCustomer] = useState<TakeawayCustomer | null>(null)
  // M5b: the open takeaway order "Agregar productos" adds to; null = a new order.
  const [takeawayOrder, setTakeawayOrder] = useState<Order | null>(null)

  // The whole screen renders from ONE loaded list (mount, "Actualizar" and the
  // realtime patch share this cache slot); every bucket the view shows is
  // derived from it in `lib/cashier/orders.ts`, so there is nothing left to
  // re-sync by hand after a payment, a split or an undo.
  const [registerSettled, setRegisterSettled] = useState(false)

  // ONE request for the three statuses the cashier lists (S1). It used to be
  // three `getByStatus` calls, one per status, feeding three arrays plus a
  // by-table group that every refresh had to re-sync.
  // T24: with the waiter's name (include=waiter); the profile store is the fallback.
  const fetchCashierOrders = async (): Promise<Order[]> =>
    (await getByStatus(CASHIER_ORDER_STATUSES, { include: CASHIER_ORDER_INCLUDES })).map(toCashierOrder)

  const {
    data: orders = NO_ORDERS,
    isLoading,
    isFetching,
    isError,
    dataUpdatedAt,
  } = useQuery<Order[]>({
    queryKey: cashierOrdersQueryKey,
    queryFn: fetchCashierOrders,
  })

  // Active / kitchen / delivered / partial / by-table, all derived. A realtime
  // status change re-buckets the row here, with no refetch.
  const { partial: partialOrders, byTable: ordersByTable, takeaway: takeawayOrders } = useMemo(
    () => deriveCashierViews(orders),
    [orders],
  )

  // D6 Rule B: render-path reads project to a primitive (table number) via a
  // shallow-compared lookup map, never to the full `tables` array — see design.md D6.
  const tableNumberById = useTableStore(
    useShallow((s) => {
      const map: Record<string, number> = {}
      for (const t of s.tables) map[t.id] = t.number
      return map
    }),
  )
  // T24: the zone each table sits in, by name, for the queue and the detail.
  const zoneIdByTableId = useTableStore(
    useShallow((s) => {
      const map: Record<string, string> = {}
      for (const t of s.tables) if (t.zoneId) map[t.id] = t.zoneId
      return map
    }),
  )
  const { data: zones } = useZones()
  const zoneNameByTableId = useMemo(() => {
    const names = new Map((zones ?? []).map((z) => [z.id, z.name] as const))
    const map: Record<string, string> = {}
    for (const [tableId, zoneId] of Object.entries(zoneIdByTableId)) {
      const name = names.get(zoneId)
      if (name) map[tableId] = name
    }
    return map
  }, [zones, zoneIdByTableId])
  const profiles = useProfileStore((s) => s.profiles)
  const online = useOnlineStatus()

  // Deliveries owing money: the same shared query the delivery panel renders,
  // read here only to count the "Domicilios" tab.
  const { data: deliveries = [] } = useActiveDeliveries()
  const pendingDeliveries = useMemo(() => pendingDeliveryPayments(deliveries), [deliveries])

  // The queue rows, derived from the one loaded list. The payment panel bills
  // the very order the row holds, so selecting it never re-reads it.
  const waiterName = useCallback((id: string) => profiles?.find((p) => p.id === id)?.name, [profiles])
  const tableRows = useMemo(
    () => tableEntries({ byTable: ordersByTable, partial: partialOrders, tableNumberById, zoneNameByTableId, waiterName }),
    [ordersByTable, partialOrders, tableNumberById, zoneNameByTableId, waiterName],
  )
  const partialRows = useMemo(
    () => partialEntries({ byTable: ordersByTable, partial: partialOrders, tableNumberById, zoneNameByTableId, waiterName }),
    [ordersByTable, partialOrders, tableNumberById, zoneNameByTableId, waiterName],
  )
  const takeawayRows = useMemo(
    () => takeawayEntries({ byTable: ordersByTable, partial: partialOrders, takeaway: takeawayOrders, tableNumberById, waiterName }),
    [ordersByTable, partialOrders, takeawayOrders, tableNumberById, waiterName],
  )
  const tabRows = queueTab === "partials" ? partialRows : queueTab === "takeaway" ? takeawayRows : tableRows
  const visibleRows = useMemo(() => tabRows.filter((row) => matchesQueueSearch(row, query)), [tabRows, query])
  const selectedEntry: QueueEntry | undefined = useMemo(
    () => [...tableRows, ...partialRows, ...takeawayRows].find((row) => row.key === selectedKey),
    [tableRows, partialRows, takeawayRows, selectedKey],
  )

  const selectEntry = (entry: QueueEntry) => {
    if (entry.key !== selectedKey) {
      setPayTotals(null)
      setBillNotice(null)
    }
    setSelectedKey(entry.key)
    setStep("detail")
  }
  const clearSelection = () => {
    setSelectedKey(null)
    setBillNotice(null)
    setPayTotals(null)
    setStep("queue")
  }

  const { isRegisterOpen, loadCurrentRegister, currentRegister } = useCashRegisterStore()
  const openRegisterId = isRegisterOpen() ? (currentRegister?.id ?? null) : null
  const openerName = (currentRegister as Partial<CashRegisterWithOpener> | null)?.openedBy?.name ?? null
  const registerOpenedAt = currentRegister?.openingTimestamp ? clockTime(new Date(currentRegister.openingTimestamp)) : null
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()

  // Función para refrescar manualmente los datos
  //
  // A refresh invalidates the ONE orders query. It never flips a local
  // `isLoading`: React Query keeps the previous data while it refetches, so the
  // "Órdenes" tab (and the delivery panel above it) stay mounted instead of
  // being replaced by skeletons on every payment, split, undo or manual
  // refresh (S2). The same call backs the "Actualizar" button, whose spinner is
  // driven by the query's real `isFetching`.
  const refreshOrders = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: cashierOrdersQueryKey })
    } catch (error) {
      log.error("Error al cargar órdenes:", { error: String(error) })
      toast.error("Error al cargar órdenes desde la base de datos")
    }
  }, [])

  // Cargar datos de caja al montar y suscribirse a realtime
  useEffect(() => {
    // The open register is owned by this screen (T5): the "Transacciones" tab
    // and `DeliveryPaymentsPanel` read it from the store instead of loading it
    // again. `registerSettled` lets the tab keep its spinner until it is known.
    let alive = true
    void Promise.resolve(loadCurrentRegister()).finally(() => {
      if (alive) setRegisterSettled(true)
    })

    // Suscribirse a cambios en órdenes
    const unsubscribe = realtimeService.subscribeToOrders((payload) => {
      log.info("Cambio en orden recibido:", { payload })

      // S5/T8: the payload is applied IN PLACE on the single orders cache slot
      // the screen renders from. The buckets are derived from that list, so an
      // `active -> kitchen` move re-buckets the card and a move to `paid` takes
      // it off the screen — with no `invalidateQueries` and no refetch.
      // D7 consequence 2: only fields the broadcast actually sent are carried,
      // so an UPDATE that omits items/bill keeps them by reference.
      // Delivery invariant (odd/tasks/domicilios.md S13/S14): the shared
      // `wireRowToPartialOrder` maps the wire row with
      // `orderType: orderTypeFromRow(row)` — the same mapping the initial-load
      // converter uses — so a domicilio arriving over realtime keeps its
      // delivery flag instead of being labelled "Mesa ?".
      queryClient.setQueryData<Order[]>([...cashierOrdersQueryKey], (prev: Order[] | undefined) =>
        applyCashierOrderEvent(prev ?? [], payload as { eventType: string }),
      )
    })

    // Limpiar suscripción al desmontar
    return () => {
      alive = false
      unsubscribe()
    }
  }, [loadCurrentRegister])

  // Función para obtener una orden por ID
  const getOrderById = useCallback(
    (orderId: string): Order | undefined => orders.find((order) => order.id === orderId),
    [orders],
  )

  // Función para obtener órdenes por mesa
  const getOrdersByTable = useCallback(
    (tableId: string): Order[] => {
      return ordersByTable[tableId] || []
    },
    [ordersByTable],
  )

  // Función para obtener todos los items de una mesa
  const getAllTableItems = useCallback(
    (tableId: string): CartItem[] => {
      const tableOrders = getOrdersByTable(tableId)
      const items = tableOrders.flatMap((order) => order.items)

      // Agrupar items por nombre, comentarios y opciones (F7)
      const groupedItems: Record<string, CartItem> = {}

      items.forEach((item) => {
        const key = billLineKey(item)

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

  // Handle completing payment: the invoice was dismissed, so the order is done.
  const handlePaymentComplete = async () => {
    try {
      // Limpiar estados
      clearSelection()
      setSelectedTableId(null)

      // Recargar órdenes (sin parpadeo: la lista sigue montada)
      await refreshOrders()
    } catch (error) {
      log.error("Error al procesar el pago:", { error: String(error) })
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
        await refreshOrders()
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
        await refreshOrders()
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
    const takeaway = order.orderType === "takeaway"
    const table = takeaway ? undefined : useTableStore.getState().getTableById(order.tableId)
    const waiter = profiles.find((p) => p.id === order.waiter)

    // A takeaway order has no table: the invoice names its customer instead (S8).
    if ((!takeaway && !table) || (!takeaway && !waiter)) return

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
      waiter: waiter?.name ?? "N/A",
      table: table ? table.number : takeawayLabel(order),
      ...(order.orderType
        ? { orderType: order.orderType, ...(takeaway ? { customerName: order.customerName ?? null } : {}) }
        : {}),
      paymentMethod: (order as any).paymentMethod || "cash"
    }

    setInvoiceIsPayment(false)
    setCompletedInvoiceData(invoice)
    setShowCompletedInvoice(true)
  }

  const handlePaid = (invoice: PrintableInvoice) => {
    setInvoiceIsPayment(true)
    setCompletedInvoiceData(invoice)
    setShowCompletedInvoice(true)
  }

  // Calcular datos para análisis
  const calculateAnalytics = useCallback(() => {
    // Obtener todas las órdenes pagadas
    const paidOrders = orders.filter((order) => order.status === "paid")

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
  }, [orders])

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

  const detailItems = selectedEntry
    ? selectedEntry.kind === "table"
      ? getAllTableItems(selectedEntry.tableId)
      : groupItems(selectedEntry.payOrder.items)
    : []
  const isSingleItemWithQuantityOne = detailItems.length === 1 && detailItems[0].quantity === 1
  const lastUpdate = dataUpdatedAt ? clockTime(new Date(dataUpdatedAt)) : null
  const dockAmount = payTotals?.remaining ?? selectedEntry?.total ?? 0

  // F3: the voids act on the order the payment panel charges (`payOrder`).
  const voidLabel = (entry: QueueEntry) =>
    [entry.payOrder.orderNumber ? `#${entry.payOrder.orderNumber}` : null, entry.label].filter(Boolean).join(" · ")
  const voidLines = (order: Order): VoidLine[] =>
    order.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments,
      ...(item.modifiers?.length ? { modifiers: item.modifiers } : {}),
    }))
  const openPaymentVoid = (row: PaidOrderRow) =>
    setVoidTarget({
      action: "payment",
      orderId: row.orderId,
      label: [row.folio, row.place].filter(Boolean).join(" · "),
      payments: [{ id: row.key, title: row.methods, detail: row.time, amount: row.total }],
      paymentId: row.key,
    })
  const handleVoided = () => {
    void refreshOrders()
    void queryClient.invalidateQueries({ queryKey: registerPaidOrdersQueryKey(openRegisterId ?? "") })
    void queryClient.invalidateQueries({ queryKey: ["register-summary"] })
    void queryClient.invalidateQueries({ queryKey: ["register-payments"] })
  }

  const pane = "min-w-0 rounded-card border border-line bg-surface min-[1180px]:min-h-0 min-[1180px]:overflow-y-auto min-[1180px]:[scrollbar-gutter:stable]"
  const steps = [
    { id: "queue", label: "Órdenes" },
    { id: "detail", label: "Detalle" },
    { id: "pay", label: "Pago" },
  ] as const

  // The screen is its own scroller with the gutter reserved, so a list that
  // starts or stops scrolling never narrows the queue or its tabs (S6).
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-canvas px-3 [scrollbar-gutter:stable] sm:px-4">
      <Header
        profile={profile}
        onChangeProfile={onChangeProfile}
        authRole={authRole}
        title={TAB_TITLES[activeTab]}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CashierTab)}
        className="flex flex-1 flex-col gap-3 pb-3 min-[1180px]:min-h-0"
      >
        {/* Top bar: real register state and its actions, the shift summary, refresh. */}
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2 sm:p-3">
          <div className="min-w-0 flex-1 basis-full lg:basis-auto">
            <CashRegisterStatus />
          </div>
          <TabsList className="h-11 bg-surface-2">
            <TabsTrigger value="orders" className="h-9 px-3">
              Cobro
            </TabsTrigger>
            <TabsTrigger value="tables" className="h-9 px-3">
              Plano de mesas
            </TabsTrigger>
            <TabsTrigger value="transactions" className="h-9 px-3">
              Resumen del turno
            </TabsTrigger>
          </TabsList>
          <LivePill />
          <Button
            variant="outline"
            onClick={() => setShiftSheetOpen(true)}
            aria-label="Cifras del turno"
            className="h-11 w-11 p-0 sm:w-auto sm:px-3"
          >
            <BarChart3 aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Cifras del turno</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => void refreshOrders()}
            // `isFetching` is the real refetch in flight (first load included);
            // the spinner shows exactly while a request is running.
            disabled={isFetching}
            aria-label="Actualizar datos"
            className="h-11 w-11 p-0 sm:w-auto sm:px-3"
          >
            <RefreshCw aria-hidden="true" className={cn("h-4 w-4", isFetching && "motion-safe:animate-spin")} />
            <span className="hidden sm:inline">Actualizar datos</span>
          </Button>
        </div>

        <TabsContent value="orders" className="mt-0 flex flex-1 flex-col gap-3 data-[state=inactive]:hidden min-[1180px]:min-h-0">
          {!online ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-card border border-status-danger-line bg-status-danger-bg p-3 text-sm text-status-danger-fg"
            >
              <WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b>Sin conexión.</b>
                {lastUpdate && ` Última actualización ${lastUpdate}.`} El cobro está pausado para evitar cobros dobles;
                nada se ha registrado.
              </p>
            </div>
          ) : isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg"
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">
                No se pudieron actualizar las órdenes.
                {orders.length > 0 && lastUpdate && ` Se muestra lo cargado a las ${lastUpdate}.`}
              </p>
              <Button variant="outline" className="h-11" onClick={() => void refreshOrders()}>
                Reintentar
              </Button>
            </div>
          ) : null}

          {/* Phone: one pane at a time. */}
          <nav aria-label="Pasos del cobro" className="grid grid-cols-3 gap-1 rounded-md bg-surface-2 p-1 md:hidden">
            {steps.map(({ id, label }, index) => (
              <button
                key={id}
                type="button"
                aria-current={step === id ? "step" : undefined}
                disabled={id !== "queue" && !selectedEntry}
                onClick={() => setStep(id)}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md text-sm font-semibold disabled:opacity-50",
                  focusRing,
                  step === id ? "bg-surface text-fg shadow-sm" : "text-muted-fg",
                )}
              >
                <b className="tabular-nums">{index + 1}</b>
                {label}
              </button>
            ))}
          </nav>

          {phone && billNotice && <BillChangedBanner notice={billNotice} onDismiss={() => setBillNotice(null)} />}

          <div className="grid flex-1 gap-3 md:grid-cols-2 min-[1180px]:min-h-0 min-[1180px]:grid-cols-[minmax(320px,360px)_minmax(0,1fr)_minmax(360px,420px)]">
            <section
              aria-label="Órdenes por cobrar"
              className={cn(pane, "md:col-span-2 min-[1180px]:col-span-1", step !== "queue" && "max-md:hidden")}
            >
              <CashierQueue
                tab={queueTab}
                onTabChange={setQueueTab}
                counts={{ tables: tableRows.length, takeaway: takeawayRows.length, deliveries: pendingDeliveries.length, partials: partialRows.length }}
                onNewTakeaway={() => setTakeawayDialogOpen(true)}
                query={query}
                onQueryChange={setQuery}
                entries={visibleRows}
                unfilteredCount={tabRows.length}
                selectedKey={selectedEntry?.key ?? null}
                onSelect={selectEntry}
                loading={isLoading}
                deliveries={<DeliveryPaymentsPanel onPaid={() => void refreshOrders()} />}
                paid={<PaidOrdersList registerId={openRegisterId} onVoid={openPaymentVoid} />}
              />
            </section>

            <section
              aria-label="Detalle de la orden"
              className={cn(pane, step !== "detail" && "max-md:hidden")}
            >
              {!phone && billNotice && (
                <div className="p-3 pb-0 sm:p-4 sm:pb-0">
                  <BillChangedBanner notice={billNotice} onDismiss={() => setBillNotice(null)} />
                </div>
              )}
              {selectedEntry?.kind === "takeaway" && (
                <div className="p-3 pb-0 sm:p-4 sm:pb-0">
                  {/* M5b: a sent takeaway order takes more items, like a table's order. */}
                  <Button
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => {
                      const open = selectedEntry.payOrder
                      setTakeawayOrder(open)
                      setTakeawayCustomer({ name: open.customerName ?? "", phone: open.customerPhone ?? null })
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    Agregar productos
                  </Button>
                </div>
              )}
              {selectedEntry ? (
                <OrderDetail
                  entry={selectedEntry}
                  items={detailItems}
                  totals={entryTotals(selectedEntry.orders)}
                  onSplit={
                    selectedEntry.kind === "table" ? () => handleOpenPartialPayment(selectedEntry.tableId) : undefined
                  }
                  splitDisabledReason={
                    isSingleItemWithQuantityOne ? "No se puede hacer pago parcial con un solo producto" : undefined
                  }
                  onUndoSplit={
                    selectedEntry.kind === "partial" ? () => handleDeletePartialOrder(selectedEntry.payOrder.id) : undefined
                  }
                  undoBusy={isUndoingSplit}
                  onReprint={() => showInvoice(selectedEntry.payOrder.id)}

                  onVoidItem={
                    selectedEntry.payOrder.items.length > 0
                      ? () =>
                          setVoidTarget({
                            action: "item",
                            orderId: selectedEntry.payOrder.id,
                            label: voidLabel(selectedEntry),
                            lines: voidLines(selectedEntry.payOrder),
                            totalDiscounts: selectedEntry.payOrder.bill.totalDiscounts,
                          })
                      : undefined
                  }
                  onCancelOrder={() =>
                    setVoidTarget({
                      action: "order",
                      orderId: selectedEntry.payOrder.id,
                      label: voidLabel(selectedEntry),
                      lines: voidLines(selectedEntry.payOrder),
                      total: selectedEntry.payOrder.bill.total,
                    })
                  }
                />
              ) : (
                <div className="flex h-full min-h-[10rem] items-center justify-center p-6 text-center text-sm text-muted-fg">
                  {isLoading ? "Cargando órdenes…" : "Elige una orden de la lista para ver su detalle."}
                </div>
              )}
            </section>

            <section
              aria-label="Pago"
              className={cn(pane, "flex flex-col", step !== "pay" && "max-md:hidden")}
            >
              {selectedEntry ? (
                <PaymentPanel
                  key={selectedEntry.payOrder.id}
                  layout="inline"
                  orderId={selectedEntry.payOrder.id}
                  order={{
                    ...billSourceFromOrder(selectedEntry.payOrder),
                    discounts: (selectedEntry.payOrder as CashierOrder).discounts,
                    gross_subtotal: (selectedEntry.payOrder as CashierOrder).grossSubtotal,
                    ...(selectedEntry.payOrder.orderType ? { order_type: selectedEntry.payOrder.orderType } : {}),
                    ...(selectedEntry.payOrder.orderType === "takeaway"
                      ? { customer_name: selectedEntry.payOrder.customerName ?? null }
                      : {}),
                  }}
                  eyebrow={`Cobrar · ${selectedEntry.label}`}
                  onCancel={clearSelection}
                  onPaid={handlePaid}
                  onTotalsChange={setPayTotals}
                  waiterName={selectedEntry.waiterName}
                  undoWindow
                  onBillStale={() => void refreshOrders()}
                  onBillNotice={setBillNotice}
                />
              ) : (
                <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-1 p-6 text-center">
                  <p className="font-semibold text-fg">Selecciona una orden para cobrar</p>
                  <p className="text-sm text-muted-fg">El restante, los pagos y el cambio aparecen aquí.</p>
                </div>
              )}
            </section>
          </div>

          {/* Phone: sticky "restante" bar while moving between the steps. */}
          {selectedEntry && step !== "pay" && (
            <div className="sticky bottom-0 z-10 flex items-center gap-3 rounded-card border border-line px-3 py-2 shadow-elevated md:hidden [background:linear-gradient(var(--surface),var(--surface)),var(--canvas)]">
              <div className="min-w-0 flex-1">
                <small className="block truncate text-xs text-muted-fg">{selectedEntry.label} · restante</small>
                <Money className="text-lg font-bold text-fg">{formatCurrency(dockAmount)}</Money>
              </div>
              <Button
                className="h-11 bg-brand text-brand-contrast hover:bg-brand-strong"
                onClick={() => setStep(step === "queue" ? "detail" : "pay")}
              >
                {step === "queue" ? "Ver detalle →" : "Ir a pagar →"}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* reservas-mesas T3 (S4): the waiter's floor map and table panel. */}
        <TabsContent value="tables" className="mt-0">
          <CashierTablesView />
        </TabsContent>

        <TabsContent value="transactions" className="mt-0">
          {/* The open register is loaded once, by this screen; the list only
              renders it and keeps a spinner until it is known. */}
          <TransactionsList registerLoading={!registerSettled} />
        </TabsContent>
      </Tabs>

      <ShiftSummarySheet
        open={shiftSheetOpen}
        onOpenChange={setShiftSheetOpen}
        registerId={openRegisterId}
        openerName={openerName}
        openedAt={registerOpenedAt}
        pendingCount={tableRows.length + takeawayRows.length + partialRows.length + pendingDeliveries.length}
        onShowMovements={() => {
          setShiftSheetOpen(false)
          setActiveTab("transactions")
        }}
      />

      <VoidFlow target={voidTarget} onClose={() => setVoidTarget(null)} onDone={handleVoided} />

      <TakeawayStartDialog
        open={takeawayDialogOpen}
        onClose={() => setTakeawayDialogOpen(false)}
        onStart={(customer) => {
          setTakeawayDialogOpen(false)
          setTakeawayCustomer(customer)
        }}
      />
      {takeawayCustomer && (
        <TakeawayOrderFlow
          customer={takeawayCustomer}
          order={takeawayOrder ?? undefined}
          onClose={() => {
            setTakeawayCustomer(null)
            setTakeawayOrder(null)
          }}
          onSent={() => {
            setTakeawayCustomer(null)
            setTakeawayOrder(null)
            setQueueTab("takeaway")
            void refreshOrders()
          }}
        />
      )}

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

      {/* Paid invoice (closes the order when dismissed) or a reprint */}
      {completedInvoiceData && (
        <InvoicePrintView
          invoice={completedInvoiceData}
          open={showCompletedInvoice}
          onOpenChange={(open) => {
            setShowCompletedInvoice(open)
            if (!open && invoiceIsPayment) {
              setInvoiceIsPayment(false)
              setCompletedInvoiceData(null)
              void handlePaymentComplete()
            }
          }}
          {...(invoiceIsPayment ? { isPending: false } : { isPartialPayment: false })}
        />
      )}
    </div>
  )
}
