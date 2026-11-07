"use client"

import { useState, useEffect, useMemo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Bike, Printer, RefreshCw, Search } from "lucide-react"
import { formatCurrency } from "@/utils/helpers"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { Order, PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { format } from "date-fns"
import { listPaymentMethods } from "@/lib/api/payments"
import { useZones } from "@/hooks/use-zones"
import { Money, focusRing } from "@/components/cashier/cashier-ui"
import { OrderStatusPill, clockTime } from "@/components/admin/orders/order-ui"
import { completedOrdersQueryKey, useCompletedOrders } from "@/components/admin/orders/use-completed-orders"
import { cn } from "@/lib/utils"
import {
  invoiceTendersFromPayment,
  legacyInvoiceFields,
} from "@/lib/payments/invoice-tenders"
import { invoicePlaceLabel, isDeliveryOrder } from "@/lib/delivery/kitchen"
import { log } from "@/lib/log"
import { useToast } from "@/components/ui/use-toast"
import { completedTotals, normalizeSearch } from "@/lib/admin/orders"
import { Skeleton } from "@/components/ui/skeleton"
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"

interface CompletedOrdersTableProps {
  selectedDate?: Date
  /** Extra controls placed first in the toolbar row (e.g. the date picker). */
  toolbar?: ReactNode
}

export { completedOrdersQueryKey, useCompletedOrders }

/** "id:number:zone|...": changes only when a table's number or zone changes. */
export function tablePlacesKey(state: { tables: ReadonlyArray<{ id: string; number: number; zoneId?: string }> }): string {
  return state.tables.map((table) => `${table.id}:${table.number}:${table.zoneId ?? ""}`).join("|")
}

/** "#112", or the id prefix for an order read without its number. */
function orderLabel(order: Order): string {
  return typeof order.orderNumber === "number" ? `#${order.orderNumber}` : `#${order.id.substring(0, 8)}`
}

export function CompletedOrdersTable({ selectedDate, toolbar }: CompletedOrdersTableProps) {
  const profiles = useProfileStore((s) => s.profiles)
  // D6: a primitive projection of what the list shows (number, zone), so a
  // table status patch does not re-render the table; the lookup reads getState().
  const tablesKey = useTableStore(tablePlacesKey)
  const { data: zones } = useZones()
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
  const { orders: allOrders, isLoading, isFetching, isError, refetch } = useCompletedOrders(selectedDate)

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

  // "Completadas hoy" totals from the same rows (T28).
  const totals = useMemo(() => completedTotals(allOrders), [allOrders])

  const completedOrders = useMemo(() => {
    if (!searchTerm) return allOrders

    const lowerSearch = searchTerm.toLowerCase().trim()
    const bareNumber = lowerSearch.replace(/^#/, "")

    // Buscar por ID (contiene el término) o por número de orden exacto (#112)
    const byId = allOrders.filter(
      (order: Order) => order.id.toLowerCase().includes(lowerSearch) || String(order.orderNumber ?? "") === bareNumber,
    )

    // Buscar por nombre de mesero (contiene el término)
    const byWaiter = allOrders.filter((order: Order) => {
      const waiter = profiles.find((p: any) => p.id === order.waiter)
      return waiter && normalizeSearch(waiter.name).includes(normalizeSearch(lowerSearch))
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

  const tableById = useMemo(
    () => new Map(useTableStore.getState().tables.map((table) => [table.id, table])),
    // tablesKey is the trigger for the getState() read.
    [tablesKey],
  )
  const zoneById = useMemo(() => new Map((zones ?? []).map((zone) => [zone.id, zone.name])), [zones])

  /** "Mesa 9" + zone, or "Domicilio" (the day's read carries no delivery customer). */
  const placeOf = (order: Order): { title: string; detail: string | null; delivery: boolean } => {
    if (isDeliveryOrder(order)) return { title: "Domicilio", detail: null, delivery: true }
    const table = tableById.get(order.tableId)
    return {
      title: table ? `Mesa ${table.number}` : "Mesa ?",
      detail: (table?.zoneId && zoneById.get(table.zoneId)) || null,
      delivery: false,
    }
  }

  const summary: Array<{ label: string; value: ReactNode }> = [
    { label: "Órdenes pagadas", value: <span className="tabular-nums">{totals.paid}</span> },
    { label: "Ventas del día", value: <Money>{formatCurrency(totals.sales)}</Money> },
    { label: "Propinas", value: <Money>{formatCurrency(totals.tips)}</Money> },
    // Cancelling deletes the order (DELETE /orders/:id): nothing is stored to count.
    { label: "Canceladas", value: <span title="Cancelar una orden la elimina; no queda registro para contarla">—</span> },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label="Totales del día" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-sm">
            <p className="truncate text-xs text-muted-fg">{label}</p>
            <p className="mt-1 truncate text-xl font-bold text-fg sm:text-2xl">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {toolbar}
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" aria-hidden />
          <input
            type="search"
            placeholder="#112 o mesero"
            aria-label="Buscar por número o mesero"
            className={cn(
              "h-11 w-full rounded-pill border border-line bg-surface-2 pl-10 pr-3 text-sm text-fg placeholder:text-muted-fg",
              focusRing,
            )}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className="min-h-[44px] sm:ml-auto"
          onClick={loadOrdersFromDB}
          disabled={isFetching || !selectedDate}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {selectedDate && (
        <p className="text-sm text-muted-fg">Mostrando órdenes del {format(selectedDate, "dd/MM/yyyy")}</p>
      )}

      <section aria-label="Órdenes completadas" className="min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        <div
          aria-hidden
          className="hidden grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_64px_112px_104px_112px] items-center gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-xs font-semibold text-fg-2 lg:grid"
        >
          <span>#</span>
          <span>Lugar</span>
          <span>Mesero</span>
          <span>Cerrada</span>
          <span>Estado</span>
          <span className="text-right">Total</span>
          <span />
        </div>
        {isLoading ? (
          // Skeletons only when there is nothing to show yet: a refetch
          // (Actualizar, or coming back to the sub-tab) keeps the rows.
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`skeleton-${index}`} className="h-6 w-full" />
            ))}
          </div>
        ) : paginatedData.length > 0 ? (
          <ul className="divide-y divide-line">
            {paginatedData.map((order) => {
              const waiter = profiles.find((p) => p.id === order.waiter)
              const place = placeOf(order)
              const closedAt = order.ledgerPayment?.createdAt
              return (
                <li
                  key={order.id}
                  data-testid={`completed-order-${order.id}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm lg:grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_64px_112px_104px_112px] lg:gap-y-0 lg:py-2"
                >
                  <span className="font-bold tabular-nums text-fg">{orderLabel(order)}</span>
                  <span className="flex min-w-0 items-center gap-1.5" title={[place.title, place.detail].filter(Boolean).join(" · ")}>
                    {place.delivery && <Bike aria-hidden className="h-4 w-4 flex-none text-muted-fg" />}
                    <span className={cn("truncate", place.delivery ? "min-w-0" : "flex-none")}>{place.title}</span>
                    {place.detail && <span className="min-w-0 shrink-[2] truncate text-muted-fg">· {place.detail}</span>}
                  </span>
                  <Money className="text-right font-semibold text-fg lg:order-6 lg:font-normal">
                    {formatCurrency(order.bill?.total || 0)}
                  </Money>
                  <span className="col-span-2 truncate text-muted-fg lg:col-span-1 lg:order-3 lg:text-fg">
                    {waiter ? waiter.name : "Desconocido"}
                  </span>
                  <span
                    className="text-right tabular-nums text-muted-fg lg:order-4 lg:text-left"
                    title={closedAt ? "Hora del pago" : "Pago sin hora registrada"}
                  >
                    {closedAt ? clockTime(closedAt) : "—"}
                  </span>
                  <span className="lg:order-5">
                    <OrderStatusPill status={order.status} />
                  </span>
                  <span className="col-span-2 text-right lg:order-7 lg:col-span-1">
                    <Button
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => handlePrintInvoice(order)}
                    >
                      <Printer className="h-4 w-4 mr-1" />
                      Factura
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-fg">
            {searchTerm
              ? "No se encontraron órdenes con ese término de búsqueda"
              : `No hay órdenes completadas ${selectedDate ? "para esta fecha" : ""}`}
          </p>
        )}
      </section>

      {/* Paginación */}
      {completedOrders.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]} />
          <div className="text-sm text-muted-fg">
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
