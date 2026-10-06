"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/utils/helpers"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"
import { log } from "@/lib/log"
import { Search, Download, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useProfileStore } from "@/store/useProfileStore"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CashTransaction, PaymentTransaction } from "@/types/cash-register"
import { Skeleton } from "@/components/ui/skeleton"
import { useQuery } from "@tanstack/react-query"
import { useRegisterPayments } from "@/hooks/use-register-payments"
import { totalsByMethod, methodLabel, toCsvRows, csvEscape } from "@/lib/payments/payment-list"
import type { PaymentRow } from "@/lib/payments/payment-list"
import { listPaymentMethods } from "@/lib/supabase/payments-service"
import type { PaymentMethodOption } from "@/lib/payments/types"

interface TransactionsByDateListProps {
  selectedDate?: Date
}

export function TransactionsByRegisterId({ selectedDate: propSelectedDate }: TransactionsByDateListProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDate, setSelectedDate] = useState<Date>(propSelectedDate || new Date())
  const [registers, setRegisters] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const { toast } = useToast()
  const { profiles } = useProfileStore()

  // Función para obtener el nombre del mesero por ID
  const getWaiterName = (waiterId: string | null | undefined) => {
    if (!waiterId) return "N/A"
    const waiter = profiles.find((p) => p.id === waiterId)
    return waiter ? waiter.name : "Desconocido"
  }

  useEffect(() => {
    if (propSelectedDate) {
      setSelectedDate(propSelectedDate)
    }
  }, [propSelectedDate])

  useEffect(() => {
    const loadRegisters = async () => {
      setIsLoading(true)
      try {
        const registersForDate = await cashRegisterService.getRegistersByDate(selectedDate)
        setRegisters(registersForDate.map((r) => r.id))
      } catch (error) {
        log.error("Error al cargar cajas por fecha:", { error: String(error) })
        setRegisters([])
      } finally {
        setIsLoading(false)
      }
    }

    loadRegisters()
  }, [selectedDate])

  // New payments ledger is the source of truth. Empty ids short-circuit
  // the query, so the admin screen is safe before the date picker fires.
  const sortedRegisters = useMemo(() => [...registers].sort(), [registers])
  const { data: payments = [], isLoading: loadingPayments } = useRegisterPayments(sortedRegisters)

  // Catalog for the method label + summary cards.
  const { data: catalog = [] } = useQuery<PaymentMethodOption[]>({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
    staleTime: 60_000,
  })

  // Legacy rows stay readable for the legacy block. Empty ids short-circuit.
  const { data: legacyTransactions = [] } = useQuery<PaymentTransaction[]>({
    queryKey: ["legacy-payments-by-registers", sortedRegisters],
    queryFn: () =>
      sortedRegisters.length === 0
        ? Promise.resolve([])
        : cashRegisterService.getTransactionsByRegisters(sortedRegisters),
    enabled: sortedRegisters.length > 0,
  })

  // Cash movements remain a separate read; not driven by the new ledger.
  const { data: cashTransactions = [] } = useQuery<CashTransaction[]>({
    queryKey: ["cash-transactions-by-registers", sortedRegisters],
    queryFn: () =>
      sortedRegisters.length === 0
        ? Promise.resolve([])
        : cashRegisterService.getCashTransactionsByRegisters(sortedRegisters),
    enabled: sortedRegisters.length > 0,
  })

  const methodById = useMemo(
    () => new Map(catalog.map((m) => [m.id, m] as const)),
    [catalog],
  )
  const totalsByMethodMap = useMemo(() => totalsByMethod(payments, catalog), [payments, catalog])
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

  const filteredPayments = useMemo(() => {
    if (!searchTerm) return payments
    const lower = searchTerm.toLowerCase()
    return payments.filter(
      (p) =>
        p.orderId.toLowerCase().includes(lower) ||
        p.id.toLowerCase().includes(lower) ||
        methodLabel(p, catalog).toLowerCase().includes(lower) ||
        getWaiterName(p.cashierProfileId).toLowerCase().includes(lower),
    )
  }, [payments, searchTerm, catalog])

  const filteredLegacyTransactions = useMemo(() => {
    if (!searchTerm) return legacyTransactions
    const lower = searchTerm.toLowerCase()
    return legacyTransactions.filter(
      (tx) =>
        tx.orderId?.toLowerCase().includes(lower) ||
        tx.method?.toLowerCase().includes(lower) ||
        tx.id?.toLowerCase().includes(lower) ||
        (tx.waiterId && getWaiterName(tx.waiterId).toLowerCase().includes(lower)),
    )
  }, [legacyTransactions, searchTerm])

  const filteredCashTransactions = useMemo(() => {
    if (!searchTerm) return cashTransactions
    const lower = searchTerm.toLowerCase()
    return cashTransactions.filter(
      (tx) =>
        tx.description?.toLowerCase().includes(lower) ||
        tx.type?.toLowerCase().includes(lower),
    )
  }, [cashTransactions, searchTerm])

  const exportToCSV = () => {
    if (payments.length === 0 && legacyTransactions.length === 0) {
      toast({
        title: "No hay datos para exportar",
        description: "No hay transacciones disponibles para la fecha seleccionada",
        variant: "destructive",
      })
      return
    }

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
        const date = new Date(tx.timestamp)
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
          date.toISOString(),
        ]
        merged.push(row.map(csvEscape).join(","))
      }
    } else {
      merged = lines
    }

    const blob = new Blob([merged.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `transacciones-${selectedDate.toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: "Exportación completada",
      description: "Las transacciones se han exportado correctamente",
    })
  }

  const exportCashTransactionsToCSV = () => {
    if (!cashTransactions.length) {
      toast({
        title: "No hay datos para exportar",
        description: "No hay movimientos de efectivo disponibles para la fecha seleccionada",
        variant: "destructive",
      })
      return
    }

    const headers = ["Caja", "Transaccion", "Tipo", "Descripción", "Monto", "Fecha", "Hora"]

    const csvData = cashTransactions.map((tx) => {
      const date = new Date(tx.timestamp)
      return [
        tx.cash_register_id.substring(0, 8),
        tx.id.substring(0, 8),
        tx.type === "deposit" ? "Ingreso" : "Retiro",
        tx.description,
        tx.amount,
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
      ]
    })

    const csvContent = [headers.join(","), ...csvData.map((row) => row.join(","))].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `movimientos-efectivo-${selectedDate.toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: "Exportación completada",
      description: "Los movimientos de efectivo se han exportado correctamente",
    })
  }

  const isLoadingAnything = isLoading || loadingPayments

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        {!propSelectedDate && (
          <div className="flex items-center w-full sm:w-auto">
            <DatePicker date={selectedDate} setDate={setSelectedDate as any} />
          </div>
        )}

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
              <CardTitle>
                Transacciones de Venta
                {selectedDate && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {selectedDate.toLocaleDateString()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingAnything ? (
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card key={i}>
                        <CardHeader className="pb-2">
                          <Skeleton className="h-4 w-24" />
                        </CardHeader>
                        <CardContent>
                          <Skeleton className="h-8 w-24" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Card>
                    <CardHeader>
                      <Skeleton className="h-6 w-48" />
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead><Skeleton className="h-4 w-16" /></TableHead>
                              <TableHead><Skeleton className="h-4 w-16" /></TableHead>
                              <TableHead><Skeleton className="h-4 w-24" /></TableHead>
                              <TableHead><Skeleton className="h-4 w-20" /></TableHead>
                              <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableHead>
                              <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableHead>
                              <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableHead>
                              <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                                <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                                <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                                <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                                <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : filteredPayments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm
                    ? "No se encontraron transacciones que coincidan con la búsqueda"
                    : selectedDate
                      ? `No hay transacciones registradas para el ${selectedDate.toLocaleDateString()}`
                      : "No hay transacciones registradas"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Transaccion</TableHead>
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
                              {new Date(payment.createdAt).toLocaleTimeString()}
                            </TableCell>
                            <TableCell className="font-medium">{payment.id.substring(0, 8)}</TableCell>
                            <TableCell>{payment.orderId.substring(0, 8)}</TableCell>
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
                          <TableHead>Transaccion</TableHead>
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
                            <TableCell className="font-medium">
                              {new Date(tx.timestamp).toLocaleTimeString()}
                            </TableCell>
                            <TableCell className="font-medium">{tx.id.substring(0, 8)}</TableCell>
                            <TableCell>{tx.orderId?.substring(0, 8) || "N/A"}</TableCell>
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
          <Card>
            <CardHeader>
              <CardTitle>
                Movimientos de Efectivo
                {selectedDate && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {selectedDate.toLocaleDateString()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredCashTransactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm
                    ? "No se encontraron movimientos de efectivo que coincidan con la búsqueda"
                    : selectedDate
                      ? `No hay movimientos de efectivo registrados para el ${selectedDate.toLocaleDateString()}`
                      : "No hay movimientos de efectivo registrados"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCashTransactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell className="font-medium">
                            {new Date(transaction.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant={transaction.type === "deposit" ? "default" : "destructive"}>
                              {transaction.type === "deposit" ? "Ingreso" : "Retiro"}
                            </Badge>
                          </TableCell>
                          <TableCell>{transaction.description}</TableCell>
                          <TableCell className="text-right">{formatCurrency(transaction.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}