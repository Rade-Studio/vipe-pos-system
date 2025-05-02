"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/utils/helpers"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { Search, Download, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { usePOSStore } from "@/store/use-pos-store"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CashTransaction, PaymentTransaction } from "@/types/cash-register"
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"

interface TransactionsByDateListProps {
  selectedDate?: Date
}

export function TransactionsByDateList({ selectedDate: propSelectedDate }: TransactionsByDateListProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>(propSelectedDate || new Date())
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([])
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const { loadTransactionsByDate } = useCashRegisterStore()
  const { toast } = useToast()
  const { profiles } = usePOSStore()

  // Función para obtener el nombre del mesero por ID
  const getWaiterName = (waiterId: string) => {
    const waiter = profiles.find((p) => p.id === waiterId)
    return waiter ? waiter.name : "Desconocido"
  }

  // Función para obtener el método de pago en formato legible
  const getPaymentMethodName = (method: string) => {
    switch (method) {
      case "cash":
        return "Efectivo"
      case "transfer":
        return "Transferencia"
      case "nequi":
        return "Nequi"
      case "bancolombia":
        return "Bancolombia"
      default:
        return method
    }
  }

  useEffect(() => {
    if (propSelectedDate) {
      setSelectedDate(propSelectedDate)
    }
  }, [propSelectedDate])

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        const result = await loadTransactionsByDate(selectedDate)
        if (result) {
          setTransactions(result.transactions || [])
          // Cargar las transacciones de efectivo si existen
          if (result.cashTransactions) {
            setCashTransactions(result.cashTransactions)
          } else {
            setCashTransactions([])
          }
        } else {
          setTransactions([])
          setCashTransactions([])
        }
      } catch (error) {
        console.error("Error al cargar transacciones:", error)
        setTransactions([])
        setCashTransactions([])
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [selectedDate, loadTransactionsByDate])

  // Filtrar transacciones por término de búsqueda
  const filteredTransactions = transactions.filter(
    (tx) =>
      tx.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.method?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.waiterId && getWaiterName(tx.waiterId).toLowerCase().includes(searchTerm.toLowerCase())),
  )

  // Filtrar transacciones de efectivo por término de búsqueda
  const filteredCashTransactions = cashTransactions.filter(
    (tx) =>
      tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.type?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Calcular totales por método de pago
  const totals = {
    cash: 0,
    transfer: 0,
    nequi: 0,
    bancolombia: 0,
    tips: 0,
  }

  transactions.forEach((tx) => {
    if (tx.method === "cash") totals.cash += tx.amount
    if (tx.method === "transfer") totals.transfer += tx.amount
    if (tx.method === "nequi") totals.nequi += tx.amount
    if (tx.method === "bancolombia") totals.bancolombia += tx.amount
    if (tx.tipAmount) totals.tips += tx.tipAmount
  })

  const exportToCSV = () => {
    if (!transactions.length) {
      toast({
        title: "No hay datos para exportar",
        description: "No hay transacciones disponibles para la fecha seleccionada",
        variant: "destructive",
      })
      return
    }

    const headers = [
      "ID",
      "Orden",
      "Mesero",
      "Monto",
      "Propina",
      "Método",
      "Efectivo Recibido",
      "Cambio",
      "Fecha",
      "Hora",
    ]

    const csvData = transactions.map((tx) => {
      const date = new Date(tx.timestamp)
      return [
        tx.id.substring(0, 8), // Solo los primeros 8 caracteres del ID
        tx.orderId?.substring(0, 8) || "N/A", // Solo los primeros 8 caracteres de la orden
        tx.waiterId ? getWaiterName(tx.waiterId) : "No asignado", // Nombre del mesero en lugar del UUID
        tx.amount,
        tx.tipAmount || 0,
        getPaymentMethodName(tx.method), // Nombre del método de pago en lugar del código
        tx.cashReceived || "",
        tx.cashChange || "",
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
      ]
    })

    const csvContent = [headers.join(","), ...csvData.map((row) => row.join(","))].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
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

    const headers = ["ID", "Tipo", "Descripción", "Monto", "Fecha", "Hora"]

    const csvData = cashTransactions.map((tx) => {
      const date = new Date(tx.timestamp)
      return [
        tx.id.substring(0, 8), // Solo los primeros 8 caracteres del ID
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        {!propSelectedDate && (
          <div className="flex items-center w-full sm:w-auto">
            <DatePicker date={selectedDate} setDate={setSelectedDate} />
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
          <Button variant="outline" size="sm" onClick={exportToCSV} disabled={!transactions.length}>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Efectivo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.cash)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Transferencias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.transfer)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Nequi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.nequi)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Bancolombia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.bancolombia)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Propinas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.tips)}</div>
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
              {isLoading ? (
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
                              <TableHead>
                                <Skeleton className="h-4 w-16" />
                              </TableHead>
                              <TableHead>
                                <Skeleton className="h-4 w-16" />
                              </TableHead>
                              <TableHead>
                                <Skeleton className="h-4 w-24" />
                              </TableHead>
                              <TableHead>
                                <Skeleton className="h-4 w-20" />
                              </TableHead>
                              <TableHead className="text-right">
                                <Skeleton className="h-4 w-16 ml-auto" />
                              </TableHead>
                              <TableHead className="text-right">
                                <Skeleton className="h-4 w-16 ml-auto" />
                              </TableHead>
                              <TableHead className="text-right">
                                <Skeleton className="h-4 w-16 ml-auto" />
                              </TableHead>
                              <TableHead className="text-right">
                                <Skeleton className="h-4 w-16 ml-auto" />
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <TableRow key={i}>
                                <TableCell>
                                  <Skeleton className="h-4 w-24" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-20" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-32" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-6 w-24 rounded-full" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="h-4 w-16 ml-auto" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="h-4 w-16 ml-auto" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="h-4 w-16 ml-auto" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="h-4 w-16 ml-auto" />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : filteredTransactions.length === 0 ? (
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
                        <TableHead>Orden</TableHead>
                        <TableHead>Mesero</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Propina</TableHead>
                        <TableHead className="text-right">Recibido</TableHead>
                        <TableHead className="text-right">Cambio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell className="font-medium">
                            {new Date(transaction.timestamp).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>{transaction.orderId?.substring(0, 8) || "N/A"}</TableCell>
                          <TableCell>{transaction.waiterId ? getWaiterName(transaction.waiterId) : "N/A"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                transaction.method === "cash"
                                  ? "default"
                                  : transaction.method === "transfer"
                                    ? "outline"
                                    : transaction.method === "nequi"
                                      ? "secondary"
                                      : "destructive"
                              }
                            >
                              {getPaymentMethodName(transaction.method)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(transaction.amount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(transaction.tipAmount || 0)}</TableCell>
                          <TableCell className="text-right">
                            {transaction.cashReceived ? formatCurrency(transaction.cashReceived) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {transaction.cashChange ? formatCurrency(transaction.cashChange) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
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
