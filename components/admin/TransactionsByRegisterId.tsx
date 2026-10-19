"use client"

import { useState, useEffect, useMemo } from "react"
import { Panel, Toolbar, segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { StatCard } from "@/components/admin/common/StatCard"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/utils/helpers"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"
import { log } from "@/lib/log"
import { Search, Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useProfileStore } from "@/store/useProfileStore"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CashTransaction, PaymentTransaction } from "@/types/cash-register"
import { Skeleton } from "@/components/ui/skeleton"
import { useQuery } from "@tanstack/react-query"
import { cashTransactionsQueryKey, registersByDateQueryKey, sortedRegisterIds } from "@/lib/admin/cash"
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
  const [activeTab, setActiveTab] = useState("sales")
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

  // T9 (S1): the day's registers are a QUERY keyed on the day, shared with
  // `CashRegisterSummary` — this panel used to re-read the very same day on
  // every mount of the Caja tab through its own `useEffect`.
  const {
    data: registersForDate,
    isLoading: isLoadingRegisters,
    isError: isRegistersError,
  } = useQuery<{ id: string }[]>({
    queryKey: registersByDateQueryKey(selectedDate),
    queryFn: () => cashRegisterService.getRegistersByDate(selectedDate),
    enabled: Boolean(selectedDate),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (isRegistersError) {
      log.error("Error al cargar cajas por fecha:", { error: "getRegistersByDate failed" })
    }
  }, [isRegistersError])

  const registers = useMemo(
    () => (registersForDate ?? []).map((register) => register.id),
    [registersForDate],
  )

  // New payments ledger is the source of truth. Empty ids short-circuit
  // the query, so the admin screen is safe before the date picker fires.
  const sortedRegisters = useMemo(() => sortedRegisterIds(registers), [registers])
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

  // Cash movements remain a separate read, gated on the tab that shows them
  // and keyed exactly like `CashRegisterSummary`'s, so the two panels of the
  // same Caja tab are one cache slot, not two reads.
  const { data: cashTransactions = [] } = useQuery<CashTransaction[]>({
    queryKey: cashTransactionsQueryKey(sortedRegisters),
    queryFn: () =>
      sortedRegisters.length === 0
        ? Promise.resolve([])
        : cashRegisterService.getCashTransactionsByRegisters(sortedRegisters),
    enabled: sortedRegisters.length > 0 && activeTab === "cash",
    staleTime: 30_000,
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

  const isLoadingAnything = isLoadingRegisters || loadingPayments

  const rowSkeleton = (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )

  const emptyText = (text: string) => <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>

  return (
    <div className="space-y-4">
      <Toolbar
        actions={
          <>
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
          </>
        }
      >
        {!propSelectedDate && <DatePicker date={selectedDate} setDate={setSelectedDate as any} />}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar transacciones..."
            aria-label="Buscar transacciones"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </Toolbar>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {isLoadingAnything
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4">
                <Skeleton className="mb-2 h-4 w-20" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))
          : (
            <>
              {methodCards.slice(0, 4).map((card) => (
                <StatCard key={card.id} title={card.name} value={formatCurrency(card.amount)} />
              ))}
              <StatCard title="Propinas" value={formatCurrency(tipsTotal)} />
            </>
          )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={segmentedListClass}>
          <TabsTrigger value="sales" className={segmentedTriggerClass}>Ventas</TabsTrigger>
          <TabsTrigger value="cash" className={segmentedTriggerClass}>Movimientos de Efectivo</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-0 space-y-4">
          <Panel title="Transacciones de venta" description={selectedDate?.toLocaleDateString()} contentClassName="p-0">
            {isLoadingAnything ? (
              <div className="p-4">{rowSkeleton}</div>
            ) : filteredPayments.length === 0 ? (
              emptyText(
                searchTerm
                  ? "No se encontraron transacciones que coincidan con la búsqueda"
                  : selectedDate
                    ? `No hay transacciones registradas para el ${selectedDate.toLocaleDateString()}`
                    : "No hay transacciones registradas",
              )
            ) : (
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
                        <TableCell className="whitespace-nowrap font-medium">
                          {new Date(payment.createdAt).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="font-medium">{payment.id.substring(0, 8)}</TableCell>
                        <TableCell>{payment.orderId.substring(0, 8)}</TableCell>
                        <TableCell className="whitespace-nowrap">{getWaiterName(payment.cashierProfileId)}</TableCell>
                        <TableCell>
                          <Badge variant={badgeVariant}>{label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(payment.totalCharged)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(payment.tipAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(payment.changeGiven)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>

          {legacyTransactions.length > 0 && (
            <Panel
              title="Pagos del sistema anterior"
              description={`${legacyTransactions.length} registros de solo lectura`}
              contentClassName={legacyOpen ? "p-0" : "hidden"}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLegacyOpen((v) => !v)}
                  aria-expanded={legacyOpen}
                >
                  {legacyOpen ? "Ocultar" : "Mostrar"}
                </Button>
              }
            >
              {legacyOpen && (
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
                        <TableCell className="whitespace-nowrap font-medium">
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="font-medium">{tx.id.substring(0, 8)}</TableCell>
                        <TableCell>{tx.orderId?.substring(0, 8) || "N/A"}</TableCell>
                        <TableCell>{tx.waiterId ? getWaiterName(tx.waiterId) : "N/A"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{tx.method}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(tx.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(tx.tipAmount || 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tx.cashChange ? formatCurrency(tx.cashChange) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="cash" className="mt-0">
          <Panel title="Movimientos de efectivo" description={selectedDate?.toLocaleDateString()} contentClassName="p-0">
            {isLoadingRegisters ? (
              <div className="p-4">{rowSkeleton}</div>
            ) : filteredCashTransactions.length === 0 ? (
              emptyText(
                searchTerm
                  ? "No se encontraron movimientos de efectivo que coincidan con la búsqueda"
                  : selectedDate
                    ? `No hay movimientos de efectivo registrados para el ${selectedDate.toLocaleDateString()}`
                    : "No hay movimientos de efectivo registrados",
              )
            ) : (
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
                      <TableCell className="whitespace-nowrap font-medium">
                        {new Date(transaction.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.type === "deposit" ? "secondary" : "outline"}>
                          {transaction.type === "deposit" ? "Ingreso" : "Retiro"}
                        </Badge>
                      </TableCell>
                      <TableCell>{transaction.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(transaction.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  )
}
