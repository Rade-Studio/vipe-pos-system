"use client"

import { useEffect, useState } from "react"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { log } from "@/lib/log"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  CashRegisterSummary as CashRegisterSummaryType,
  CashTransaction,
  CashRegister,
} from "@/types/cash-register"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { RegisterSelector } from "./RegisterSelector"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"
import { Skeleton } from "@/components/ui/skeleton"

interface CashRegisterSummaryProps {
  selectedDate?: Date
}

export function CashRegisterSummary({ selectedDate }: CashRegisterSummaryProps) {
  const { getCurrentRegisterSummary, isRegisterOpen, loadTransactionsByDate, loadCurrentRegister } =
    useCashRegisterStore()
  const [summary, setSummary] = useState<CashRegisterSummaryType | null>(null)
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [selectedRegisters, setSelectedRegisters] = useState<string[]>([])
  const isOpen = isRegisterOpen()

  // Cargar cajas registradoras para la fecha seleccionada
  useEffect(() => {
    const loadRegisters = async () => {
      if (selectedDate) {
        setIsLoading(true)
        try {
          // Obtener cajas para la fecha seleccionada
          const registersForDate = await cashRegisterService.getRegistersByDate(selectedDate)
          setRegisters(registersForDate)

          // Si hay cajas, seleccionar todas por defecto
          if (registersForDate.length > 0) {
            setSelectedRegisters(registersForDate.map((r) => r.id))
          } else {
            setSelectedRegisters([])
          }
        } catch (error) {
          log.error("Error al cargar cajas por fecha:", { error: String(error) })
          setRegisters([])
          setSelectedRegisters([])
        } finally {
          setIsLoading(false)
        }
      } else {
        // Si no hay fecha seleccionada, usar el registro actual
        const loadCurrent = async () => {
          try {
            await loadCurrentRegister()
            const currentRegister = useCashRegisterStore.getState().currentRegister
            if (currentRegister) {
              setRegisters([currentRegister])
              setSelectedRegisters([currentRegister.id])
            } else {
              setRegisters([])
              setSelectedRegisters([])
            }
          } catch (error) {
            log.error("Error al cargar registro actual:", { error: String(error) })
            setRegisters([])
            setSelectedRegisters([])
          }
        }

        loadCurrent()
      }
    }

    loadRegisters()
  }, [selectedDate, loadCurrentRegister])

  // Cargar datos cuando cambian los registros seleccionados
  useEffect(() => {
    const loadData = async () => {
      if (selectedRegisters.length === 0) {
        setSummary(null)
        setCashTransactions([])
        return
      }

      setIsLoading(true)
      try {
        // Cargar transacciones para los registros seleccionados
        const { transactions, cashTransactions: cashTxs } =
          await cashRegisterService.loadTransactionsForRegisters(selectedRegisters)

        // Cargar los registros completos con sus transacciones
        const selectedRegistersFull = await Promise.all(
          selectedRegisters.map(async (id) => {
            const register = registers.find((r) => r.id === id)
            if (!register) return null

            // Filtrar las transacciones para este registro
            const registerTransactions = transactions.filter((t) => t.cash_register_id === id)
            const registerCashTransactions = cashTxs.filter((t) => t.cash_register_id === id)

            return {
              ...register,
              transactions: registerTransactions,
              cashTransactions: registerCashTransactions,
            }
          }),
        ).then((results) => results.filter(Boolean) as CashRegister[])

        // Calcular el resumen combinado
        const combinedSummary = cashRegisterService.calculateMultipleRegistersSummary(selectedRegistersFull)
        setSummary(combinedSummary)
        setCashTransactions(cashTxs)
      } catch (error) {
        log.error("Error al cargar datos:", { error: String(error) })
        setSummary(null)
        setCashTransactions([])
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [selectedRegisters, registers])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resumen de Caja</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-muted p-4 rounded-lg">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-8 w-24 mb-1" />
                  <Skeleton className="h-3 w-40" />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg">
                <Skeleton className="h-5 w-48 mb-3" />
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <Skeleton className="h-5 w-40 mb-3" />
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Resumen de Caja
          {selectedDate && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{selectedDate.toLocaleDateString()}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {registers.length > 0 ? (
          <>
            {registers.length > 1 && (
              <div className="mb-4">
                <RegisterSelector
                  registers={registers}
                  selectedRegisters={selectedRegisters}
                  onSelectionChange={setSelectedRegisters}
                />
              </div>
            )}

            {summary ? (
              <Tabs defaultValue="summary">
                <TabsList className="mb-4">
                  <TabsTrigger value="summary">Resumen</TabsTrigger>
                  <TabsTrigger value="details">Detalles</TabsTrigger>
                  <TabsTrigger value="cash">Movimientos de Efectivo</TabsTrigger>
                </TabsList>

                <TabsContent value="summary">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">Efectivo Inicial</h3>
                      <p className="text-2xl font-bold">
                        {summary && typeof summary.initialCash !== "undefined"
                          ? formatCurrency(summary.initialCash)
                          : formatCurrency(0)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedRegisters.length > 1 && `${selectedRegisters.length} cajas seleccionadas`}
                      </p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">Ventas Totales</h3>
                      <p className="text-2xl font-bold">{formatCurrency(summary.totalSales || 0)}</p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">Efectivo Final</h3>
                      <p className="text-2xl font-bold">{formatCurrency(summary.finalCash || 0)}</p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="details">
                  <div className="space-y-4">
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium mb-2">Desglose por Método de Pago</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Efectivo:</span>
                          <span className="font-medium">{formatCurrency(summary.totalCash || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Transferencia:</span>
                          <span className="font-medium">{formatCurrency(summary.totalTransfer || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Nequi:</span>
                          <span className="font-medium">{formatCurrency(summary.totalNequi || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Bancolombia:</span>
                          <span className="font-medium">{formatCurrency(summary.totalBancolombia || 0)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-2 mt-2">
                          <span>Propinas:</span>
                          <span className="font-medium">{formatCurrency(summary.totalTips || 0)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium mb-2">Detalles de Efectivo</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Efectivo Inicial:</span>
                          <span className="font-medium">{formatCurrency(summary.initialCash || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Ventas en Efectivo:</span>
                          <span className="font-medium">{formatCurrency(summary.totalCash || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cambio Entregado:</span>
                          <span className="font-medium">-{formatCurrency(summary.totalChange || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Ingresos de Efectivo:</span>
                          <span className="font-medium">{formatCurrency(summary.totalCashDeposits || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Retiros de Efectivo:</span>
                          <span className="font-medium">-{formatCurrency(summary.totalCashWithdrawals || 0)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span>Efectivo Final:</span>
                          <span>{formatCurrency(summary.finalCash || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="cash">
                  {cashTransactions.length > 0 ? (
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
                          {cashTransactions.map((transaction) => (
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
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No hay movimientos de efectivo registrados
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                {selectedRegisters.length === 0
                  ? "Seleccione al menos una caja para ver el resumen"
                  : "No hay datos disponibles para las cajas seleccionadas"}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            {selectedDate
              ? `No hay cajas registradas para el ${selectedDate.toLocaleDateString()}`
              : isOpen
                ? "No hay transacciones registradas"
                : "No hay una caja abierta"}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
