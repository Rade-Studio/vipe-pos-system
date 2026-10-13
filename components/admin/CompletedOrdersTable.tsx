"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Table as TableUI, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Printer, RefreshCw } from "lucide-react"
import {formatCurrency, formatDate, formatDateTime} from "@/utils/helpers"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { Order, Table, Profile, PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { format } from "date-fns"
import { getOrdersByDate } from "@/lib/supabase/service"
import { listPaymentMethods } from "@/lib/supabase/payments-service"
import {
  invoiceTendersFromPayment,
  legacyInvoiceFields,
} from "@/lib/payments/invoice-tenders"
import { invoicePlaceLabel, isDeliveryOrder } from "@/lib/delivery/kitchen"
import { log } from "@/lib/log"
import { useToast } from "@/components/ui/use-toast"
import { localDayKey, startOfLocalDayMs } from "@/lib/admin/dates"
import { mergeOrderLists, paidOrdersOn } from "@/lib/admin/orders"
import { Skeleton } from "@/components/ui/skeleton"
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"

interface CompletedOrdersTableProps {
  selectedDate?: Date
}

/** Cache slot for "the paid orders of one local day". */
export function completedOrdersQueryKey(selectedDate?: Date) {
  return ["orders", "completed", localDayKey(selectedDate)] as const
}

export function CompletedOrdersTable({ selectedDate }: CompletedOrdersTableProps) {
  const orders = useOrderStore((s) => s.orders)
  const profiles = useProfileStore((s) => s.profiles)
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()
  const { toast } = useToast()

  const [selectedInvoice, setSelectedInvoice] = useState<PrintableInvoice | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  // T9 (S1/S2): the day's orders are a QUERY keyed on the day, not local state
  // behind a `useEffect`. The old version re-read the day on every mount (Radix
  // unmounts this sub-tab on every tab switch) and replaced the whole table with
  // skeletons while it did. `placeholderData: keepPreviousData` keeps the rows
  // of the previous day on screen while a new day loads, and `isError` (not the
  // discarded promise) reports a failed read through the same toast.
  const {
    data: dbOrders = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery<Order[]>({
    queryKey: completedOrdersQueryKey(selectedDate),
    queryFn: () => getOrdersByDate(selectedDate as Date),
    enabled: Boolean(selectedDate),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  })

  const loadOrdersFromDB = async () => {
    await refetch()
  }

  // A failed read is reported once per failure, exactly like the old
  // hand-rolled loader did (first load and manual refresh alike). Reading
  // `isError` instead of awaiting the promise keeps the message out of an
  // unhandled rejection.
  useEffect(() => {
    if (!isError) return
    log.error("Error al cargar órdenes:", { error: "getOrdersByDate failed" })
    toast({
      title: "Error",
      description: "No se pudieron cargar las órdenes de la base de datos",
      variant: "destructive",
    })
  }, [isError, toast])

  // Paid orders the order store already holds for that day, merged by id with
  // the day's query (unchanged contract: the store list is a subset of what
  // the query returns, and a store-only paid order still shows).
  const localCompletedOrders = useMemo(() => {
    if (!selectedDate) return orders.filter((order) => order.status === "paid")
    return paidOrdersOn(orders, startOfLocalDayMs(selectedDate))
  }, [orders, selectedDate])

  // The rows of the selected day, newest first.
  const allOrders = useMemo(() => {
    return [...mergeOrderLists(localCompletedOrders, dbOrders)].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })
  }, [localCompletedOrders, dbOrders])

  const completedOrders = useMemo(() => {
    if (!searchTerm) return allOrders

    const lowerSearch = searchTerm.toLowerCase().trim()
    const isNumeric = /^\d+$/.test(lowerSearch)

    // Buscar por ID (contiene el término)
    const byId = allOrders.filter((order: Order) => order.id.toLowerCase().includes(lowerSearch))

    // Buscar por nombre de mesero (contiene el término)
    const byWaiter = allOrders.filter((order: Order) => {
      const waiter = profiles.find((p: any) => p.id === order.waiter)
      return waiter && waiter.name.toLowerCase().includes(lowerSearch)
    })

    // Unir resultados sin duplicados
    const allMatches = [...byId, ...byWaiter]
    const uniqueOrders = Array.from(new Map(allMatches.map((o: Order) => [o.id, o])).values())
    return uniqueOrders
  }, [allOrders, searchTerm, profiles])

  // Usar el hook de paginación
  const { currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData } = usePagination({
    data: completedOrders,
    initialItemsPerPage: 10,
  })

  const handlePrintInvoice = async (order: Order) => {
    // Encontrar la mesa correspondiente (D6 Rule A: handler-only read, no subscription).
    // Async porque el flujo de pagos multi-método carga el catálogo antes de armar la factura.
    const table = useTableStore.getState().getTableById(order.tableId)
    // Encontrar el mesero correspondiente
    const waiter = profiles.find((p) => p.id === order.waiter)
    // Un domicilio no tiene mesa: se factura como DOMICILIO y no avisa
    // que falte la mesa. El mesero faltante sigue avisando como siempre.
    const missingTable = !table && !isDeliveryOrder(order)

    if (missingTable || !waiter) {
      log.error("Mesa o mesero no encontrado para la orden:", { orderId: order.id })
      toast({
        title: "Advertencia",
        description: "No se encontró información completa de la mesa o mesero para esta orden",
      })
    }

    // Asegurarnos de que tenemos todos los valores necesarios para la factura
    const subtotal = order.bill?.subtotal ?? 0
    const tax = order.bill?.tax ?? 0
    const taxPercentage = order.bill?.taxPercentage ?? 0
    const tip = order.bill?.tip ?? 0
    const tipPercentage = order.bill?.tipPercentage ?? 0
    const total = order.bill?.total ?? 0

    log.info("Datos de la orden para factura:", {
      id: order.id,
      subtotal,
      tax,
      taxPercentage,
      tip,
      tipPercentage,
      total,
      items: order.items?.length || 0,
    })

    // Multi-tender reprint: when the order has a ledger payment, build
    // the tender list from it (resolved through the active catalog)
    // and use the legacy helper so the single-label block is still
    // correct for the old Python listener. Orders without a ledger
    // payment (pre-pay-order flow) keep the original `paymentMethod`
    // label as-is.
    let tenders: PrintableInvoice["tenders"]
    let change: number | undefined
    let legacyPaymentMethod: PrintableInvoice["paymentMethod"] | undefined
    let legacyCashReceived: number | undefined
    let legacyCashChange: number | undefined
    if (order.ledgerPayment) {
      let catalog: Awaited<ReturnType<typeof listPaymentMethods>> | undefined
      try {
        catalog = await listPaymentMethods()
      } catch (err) {
        log.error("No se pudo cargar el catálogo para reimprimir:", {
          error: String(err),
        })
        toast({
          title: "Advertencia",
          description: "No se pudieron cargar los nombres de los métodos de pago; la factura muestra sus códigos",
        })
      }
      const resolved = invoiceTendersFromPayment(order.ledgerPayment, catalog)
      const legacy = legacyInvoiceFields(resolved)
      tenders = resolved
      change = legacy.cashChange
      legacyPaymentMethod = legacy.paymentMethod as PrintableInvoice["paymentMethod"]
      legacyCashReceived = legacy.cashReceived ?? undefined
      legacyCashChange = legacy.cashChange > 0 ? legacy.cashChange : undefined
    }

    // Generar la factura
    const invoice: PrintableInvoice = {
      invoiceNumber: order.id.substring(0, 8),
      date: order.createdAt || new Date(),
      businessInfo: {
        name: businessName,
        address: businessAddress,
        phone: businessPhone,
        nit: businessNIT,
      },
      items: order.items || [],
      bill: {
        subtotal,
        tax,
        taxPercentage,
        tip,
        tipPercentage,
        total,
        totalDiscounts: order.bill?.totalDiscounts || 0,
      },
      waiter: waiter?.name || "Desconocido",
      table: invoicePlaceLabel(order, table ?? null),
      paymentMethod: legacyPaymentMethod ?? (order.paymentMethod || "cash"),
      cashReceived: legacyCashReceived,
      cashChange: legacyCashChange,
      tenders,
      change,
    }

    setSelectedInvoice(invoice)
    setInvoiceOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Órdenes Completadas</h2>
        <Button variant="outline" size="sm" onClick={loadOrdersFromDB} disabled={isFetching || !selectedDate}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {selectedDate && (
        <div className="text-sm text-muted-foreground">Mostrando órdenes del {format(selectedDate, "dd/MM/yyyy")}</div>
      )}

      <div className="flex items-center mb-4">
        <input
          type="text"
          placeholder="Buscar por ID o mesero..."
          className="px-3 py-2 border rounded-md w-full max-w-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="border rounded-md">
        <TableUI>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Mesero</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Skeletons only when there is nothing to show yet: a refetch
              // (Actualizar, or coming back to the sub-tab) keeps the rows.
              Array(5)
                .fill(0)
                .map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-5 w-20 ml-auto" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
            ) : paginatedData.length > 0 ? (
              paginatedData.map((order) => {
                const waiter = profiles.find((p) => p.id === order.waiter)
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.id.substring(0, 8)}</TableCell>
                    <TableCell>{order.createdAt ? formatDateTime(order.createdAt) : "Fecha no disponible"}</TableCell>
                    <TableCell>{waiter ? waiter.name : "Desconocido"}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.bill?.total || 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handlePrintInvoice(order)}>
                        <Printer className="h-4 w-4 mr-1" />
                        Factura
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                  {searchTerm
                    ? "No se encontraron órdenes con ese término de búsqueda"
                    : `No hay órdenes completadas ${selectedDate ? "para esta fecha" : ""}`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableUI>
      </div>

      {/* Paginación */}
      {completedOrders.length > 0 && (
        <div className="flex items-center justify-between mt-4">
          <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]} />
          <div className="text-sm text-muted-foreground">
            Mostrando {paginatedData.length} de {completedOrders.length} órdenes
          </div>
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      )}

      {selectedInvoice && (
        <InvoicePrintView invoice={selectedInvoice} open={invoiceOpen} onOpenChange={setInvoiceOpen} />
      )}
    </div>
  )
}
