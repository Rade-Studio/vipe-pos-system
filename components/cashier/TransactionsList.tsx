"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDateTime } from "@/utils/helpers"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { Search, Download, Loader2 } from "lucide-react"
import { useProfileStore } from "@/store/useProfileStore"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CashTransactionsList } from "./CashTransactionsList"
import { useToast } from "@/hooks/use-toast"
import { useQuery } from "@tanstack/react-query"
import { useRegisterPayments } from "@/hooks/use-register-payments"
import { totalsByMethod, methodLabel, toCsvRows, csvEscape } from "@/lib/payments/payment-list"
import type { PaymentRow } from "@/lib/payments/payment-list"
import { listPaymentMethods } from "@/lib/api/payments"
import { usePrintingEnabled } from "@/lib/api/printing"
import type { PaymentMethodOption } from "@/lib/payments/types"
import type { PaymentTransaction } from "@/types/cash-register"
import { getRegisterPaidOrders } from "@/lib/api/registers"
import { registerPaidOrdersQueryKey } from "./PaidOrdersList"

interface TransactionsListProps {
  /**
   * True while the OWNER of the open-register load (the cashier screen) is
   * still resolving it. The list renders the spinner from there instead of
   * loading the register a second time when the tab mounts (S1).
   */
  registerLoading?: boolean
  /** H-069: reprints the invoice of a paid order (the order id action). */
  onReprint?: (orderId: string) => void
}

export function TransactionsList({ registerLoading = false, onReprint }: TransactionsListProps = {}) {
  const [searchTerm, setSearchTerm] = useState("")
  const { currentRegister, lastClose } = useCashRegisterStore()
  const { profiles } = useProfileStore()
  const { toast } = useToast()
  const [legacyOpen, setLegacyOpen] = useState(false)
  // S2 (F6): without thermal printers the order id is not a reprint action.
  const printingEnabled = usePrintingEnabled()

  // Función para obtener el nombre del mesero por ID
  const getWaiterName = (waiterId: string | null | undefined) => {
    if (!waiterId) return "N/A"
    const waiter = profiles.find((p) => p.id === waiterId)
    return waiter ? waiter.name : "Desconocido"
  }

  // The open register is loaded ONCE by the screen that owns it (CashierView).
  // This list used to run `loadCurrentRegister` again on every mount, i.e. a
  // second register read each time the "Transacciones" tab was opened (S1).

  // New payments ledger is the source of truth. Empty ids short-circuit the
  // query, so the cashier screen is safe before a register is opened.
  // H-069: once the register closes, the shift just closed stays listed.
  const registerId = currentRegister?.id ?? lastClose?.cashRegisterId ?? null
  const showingClosed = !currentRegister && registerId !== null
  const paymentIds = useMemo(() => (registerId ? [registerId] : []), [registerId])
  const { data: payments = [], isLoading: loadingPayments } = useRegisterPayments(paymentIds)

  // H-069: the waiter is the order's (the payment only knows the cashier).
  const { data: paidOrders = [], isLoading: loadingWaiters } = useQuery({
    queryKey: registerPaidOrdersQueryKey(registerId ?? ""),
    queryFn: () => getRegisterPaidOrders(registerId!),
    enabled: registerId !== null,
  })
  const waiterByPayment = useMemo(
    () => new Map(paidOrders.map((row) => [row.paymentId, row.waiter?.name ?? null] as const)),
    [paidOrders],
  )
  const waiterOf = (payment: PaymentRow) => waiterByPayment.get(payment.id) ?? null

  // Catalog is shared with the checkout picker (PaymentMethodDialog). Loaded
  // for the method label and the "Efectivo" badge so we don't hardcode the
  // four legacy codes anywhere in the cashier screens.
  const { data: catalog = [] } = useQuery<PaymentMethodOption[]>({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
    staleTime: 60_000,
  })

  // Legacy rows remain visible as a separate read-only block; nothing reads
  // them for new sales.
  const legacyTransactions: PaymentTransaction[] = currentRegister?.transactions || []
  const cashTransactions = currentRegister?.cashTransactions || []

  const methodById = useMemo(
    () => new Map(catalog.map((m) => [m.id, m] as const)),
    [catalog],
  )
  const totalsByMethodMap = useMemo(() => totalsByMethod(payments, catalog), [payments, catalog])

  // Per-method totals for the summary cards (H-018): every active method
  // (even at 0) and every method with movements in this register, in catalog
  // order. An inactive method without movements is left out.
  const methodCards = useMemo(() => {
    const cards: Array<{ id: string; name: string; amount: number }> = []
    for (const row of [...catalog].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const bucket = totalsByMethodMap[row.id]
      if (!row.isActive && !bucket?.tendersCount) continue
      cards.push({
        id: row.id,
        name: row.name,
        amount: bucket ? bucket.amount : 0,
      })
    }
    return cards
  }, [catalog, totalsByMethodMap])

  const tipsTotal = useMemo(
    () => payments.reduce((sum, p) => sum + p.tipAmount, 0),
    [payments],
  )

  // Filter new payments by the search term: the order, the waiter, or any
  // tender's method (H-069: "Nequi" finds a Nequi + Efectivo payment).
  const filteredPayments = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase()
    if (!lower) return payments
    return payments.filter(
      (p) =>
        p.orderId.toLowerCase().includes(lower) ||
        (waiterByPayment.get(p.id) ?? "").toLowerCase().includes(lower) ||
        methodLabel(p, catalog).toLowerCase().includes(lower) ||
        p.tenders.some((t) =>
          [methodById.get(t.paymentMethodId)?.name ?? "", t.methodCode].some((name) => name.toLowerCase().includes(lower)),
        ),
    )
  }, [payments, searchTerm, catalog, methodById, waiterByPayment])

  // Filter legacy transactions by the search term (kept for the legacy block).
  const filteredLegacyTransactions = useMemo(() => {
    if (!searchTerm) return legacyTransactions
    const lower = searchTerm.toLowerCase()
    return legacyTransactions.filter(
      (tx) =>
        tx.orderId.toLowerCase().includes(lower) ||
        tx.method.toLowerCase().includes(lower) ||
        (tx.waiterId && getWaiterName(tx.waiterId).toLowerCase().includes(lower)),
    )
  }, [legacyTransactions, searchTerm])

  // Filter cash movements by the search term.
  const filteredCashTransactions = useMemo(() => {
    if (!searchTerm) return cashTransactions
    const lower = searchTerm.toLowerCase()
    return cashTransactions.filter(
      (tx) =>
        tx.description.toLowerCase().includes(lower) ||
        tx.type.toLowerCase().includes(lower),
    )
  }, [cashTransactions, searchTerm])

  // CSV: one row per new payment (toCsvRows), plus a section header and the
  // legacy rows marked as such so the export stays a single artifact.
  const exportToCSV = () => {
    if (payments.length === 0 && legacyTransactions.length === 0) return

    const newCsv = toCsvRows(payments, catalog)
    const lines = newCsv.split("\n")
    let merged: string[]
    if (legacyTransactions.length > 0) {
      merged = [
        ...lines,
        "",
        "Origen,ID,Orden,Caja,Monto,Propina,Método,Recibido,Cambio,Fecha",
      ]
      for (const tx of legacyTransactions) {
        const row = [
          "legacy",
          tx.id,
          tx.orderId,
          tx.cash_register_id,
          tx.amount,
          tx.tipAmount || 0,
          tx.method,
          tx.cashReceived || "",
          tx.cashChange || "",
          new Date(tx.timestamp).toISOString(),
        ]
        merged.push(row.map(csvEscape).join(","))
      }
    } else {
      merged = lines
    }
    const csvContent = merged.join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `transacciones-${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportCashTransactionsToCSV = () => {
    if (!cashTransactions.length) return

    const headers = ["ID", "Tipo", "Descripción", "Monto", "Fecha"]

    const csvData = cashTransactions.map((tx) => [
      tx.id.substring(0, 8),
      tx.type === "deposit" ? "Ingreso" : "Retiro",
      tx.description,
      tx.amount,
      new Date(tx.timestamp).toLocaleString(),
    ])

    const csvContent = [headers.join(","), ...csvData.map((row) => row.join(","))].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `movimientos-efectivo-${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const reprintInvoice = (orderId: string) => {
    if (onReprint) {
      onReprint(orderId)
      return
    }
    toast({
      title: "Reimpresión de factura",
      description: `Reimprimiendo factura para la orden ${orderId.substring(0, 8)}`,
    })
  }

  const isLoadingAnything = registerLoading || loadingPayments

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center w-full sm:w-auto">
          <Input
            placeholder="Buscar transacciones..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
          <Button variant="ghost" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            disabled={payments.length === 0 && legacyTransactions.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar Ventas
          </Button>
          <Button variant="outline" size="sm" onClick={exportCashTransactionsToCSV} disabled={!cashTransactions.length}>
            <Download className="h-4 w-4 mr-2" />
            Exportar Mov. Efectivo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {methodCards.map((card) => (
          <Card key={card.id} data-testid="method-card" data-method={card.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{card.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(card.amount)}</div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Propinas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(tipsTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Ventas</TabsTrigger>
          <TabsTrigger value="cash">Movimientos de Efectivo</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle>Transacciones de Venta</CardTitle>
              {showingClosed && (
                <p className="text-sm text-muted-foreground">Caja cerrada: estas son las ventas del último turno.</p>
              )}
            </CardHeader>
            <CardContent>
              {isLoadingAnything ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredPayments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm
                    ? "No se encontraron transacciones que coincidan con la búsqueda"
                    : "No hay transacciones registradas"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Orden</TableHead>
                        <TableHead>Mesero</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Propina</TableHead>
                        <TableHead className="text-right">Cambio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPayments.map((payment: PaymentRow) => {
                        const label = methodLabel(payment, catalog)
                        const badgeVariant: "default" | "outline" | "secondary" | "destructive" =
                          label === "Múltiples"
                            ? "outline"
                            : (() => {
                                const kind = methodById.get(payment.tenders[0]?.paymentMethodId ?? "")?.kind
                                return kind === "cash" ? "default" : "secondary"
                              })()
                        return (
                          <TableRow key={payment.id}>
                            <TableCell className="font-medium">
                              {formatDateTime(new Date(payment.createdAt))}
                            </TableCell>
                            <TableCell>
                              {printingEnabled ? (
                                <button
                                  type="button"
                                  className="underline-offset-2 hover:underline"
                                  onClick={() => reprintInvoice(payment.orderId)}
                                >
                                  {payment.orderId.substring(0, 8)}
                                </button>
                              ) : (
                                payment.orderId.substring(0, 8)
                              )}
                            </TableCell>
                            <TableCell>{waiterOf(payment) ?? (loadingWaiters ? "…" : "Sin mesero")}</TableCell>
                            <TableCell>
                              <Badge variant={badgeVariant}>{label}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(payment.totalCharged)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payment.tipAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(payment.changeGiven)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {legacyTransactions.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Pagos del sistema anterior
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({legacyTransactions.length} registros de solo lectura)
                    </span>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLegacyOpen((v) => !v)}
                    aria-expanded={legacyOpen}
                  >
                    {legacyOpen ? "Ocultar" : "Mostrar"}
                  </Button>
                </div>
              </CardHeader>
              {legacyOpen && (
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Orden</TableHead>
                          <TableHead>Mesero</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-right">Propina</TableHead>
                          <TableHead className="text-right">Cambio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLegacyTransactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell className="font-medium">{formatDateTime(tx.timestamp)}</TableCell>
                            <TableCell>{tx.orderId.substring(0, 8)}</TableCell>
                            <TableCell>{tx.waiterId ? getWaiterName(tx.waiterId) : "N/A"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{tx.method}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(tx.amount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(tx.tipAmount || 0)}</TableCell>
                            <TableCell className="text-right">
                              {tx.cashChange ? formatCurrency(tx.cashChange) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cash">
          {isLoadingAnything ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <CashTransactionsList transactions={filteredCashTransactions} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}