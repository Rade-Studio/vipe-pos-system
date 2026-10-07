"use client"

import { useMemo, useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { log } from "@/lib/log"
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
import { listPaymentMethods } from "@/lib/supabase/payments-service"
import type { PaymentMethodOption } from "@/lib/payments/types"
import type { PaymentTransaction } from "@/types/cash-register"

export function TransactionsList() {
  const [searchTerm, setSearchTerm] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { currentRegister, loadCurrentRegister } = useCashRegisterStore()
  const { profiles } = useProfileStore()
  const { toast } = useToast()
  const [legacyOpen, setLegacyOpen] = useState(false)

  // Función para obtener el nombre del mesero por ID
  const getWaiterName = (waiterId: string | null | undefined) => {
    if (!waiterId) return "N/A"
    const waiter = profiles.find((p) => p.id === waiterId)
    return waiter ? waiter.name : "Desconocido"
  }

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        await loadCurrentRegister()
      } catch (error) {
        log.error("Error al cargar registro actual:", { error: String(error) })
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [loadCurrentRegister])

  // New payments ledger is the source of truth. Empty ids short-circuit the
  // query, so the cashier screen is safe before a register is opened.
  const paymentIds = useMemo(
    () => (currentRegister ? [currentRegister.id] : []),
    [currentRegister],
  )
  const { data: payments = [], isLoading: loadingPayments } = useRegisterPayments(paymentIds)

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

  // Per-method totals for the summary cards. One card per method in the
  // catalog (even when amount is 0) so the cashier sees the full picker.
  const methodCards = useMemo(() => {
    const cards: Array<{ id: string; name: string; amount: number }> = []
    for (const row of catalog) {
      const bucket = totalsByMethodMap[row.id]
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

  // Filter new payments by the search term.
  const filteredPayments = useMemo(() => {
    if (!searchTerm) return payments
    const lower = searchTerm.toLowerCase()
    return payments.filter(
      (p) =>
        p.orderId.toLowerCase().includes(lower) ||
        (p.cashierProfileId ?? "").toLowerCase().includes(lower) ||
        getWaiterName(p.cashierProfileId).toLowerCase().includes(lower) ||
        methodLabel(p, catalog).toLowerCase().includes(lower),
    )
  }, [payments, searchTerm, catalog])

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

  const reprintInvoice = async (orderId: string) => {
    try {
      toast({
        title: "Reimpresión de factura",
        description: `Reimprimiendo factura para la orden ${orderId.substring(0, 8)}`,
      })
    } catch (error) {
      log.error("Error al reimprimir factura:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudo reimprimir la factura",
        variant: "destructive",
      })
    }
  }

  const isLoadingAnything = isLoading || loadingPayments

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

        <div className="flex gap-2 w-full sm:w-auto">
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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {methodCards.slice(0, 4).map((card) => (
          <Card key={card.id}>
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
                              <button
                                type="button"
                                className="underline-offset-2 hover:underline"
                                onClick={() => reprintInvoice(payment.orderId)}
                              >
                                {payment.orderId.substring(0, 8)}
                              </button>
                            </TableCell>
                            <TableCell>{getWaiterName(payment.cashierProfileId)}</TableCell>
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