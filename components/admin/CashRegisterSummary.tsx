"use client"

import { useEffect, useMemo, useState } from "react"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { log } from "@/lib/log"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"
import { Skeleton } from "@/components/ui/skeleton"
import { RegisterSelector } from "./RegisterSelector"
import { useRegisterSummary } from "@/hooks/use-register-summary"
import {
  hasLegacy,
  summaryRows,
  tipsShortfall,
} from "@/lib/payments/register-summary"
import type { CashRegister } from "@/types/cash-register"
import type { CashTransaction } from "@/types/cash-register"
import { AlertTriangle } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { cashTransactionsQueryKey, registersByDateQueryKey, sortedRegisterIds } from "@/lib/admin/cash"

interface CashRegisterSummaryProps {
  selectedDate?: Date
}

/**
 * Admin summary card. Server-driven: the totals, methods array and
 * legacy block come from `register_summary` via `useRegisterSummary`,
 * not from the legacy `payment_transactions` aggregation. This view
 * and the close-register dialog render the same shape (see
 * `CloseRegisterDialog.tsx`), so the preview and the locked numbers are
 * built by the same code path.
 *
 * Per-day totals are the sum of the selected registers' `initial_cash`
 * (the per-day "efectivo inicial" the user wants); the rest of the
 * numbers are the aggregated snapshot for the selected set.
 */
export function CashRegisterSummary({ selectedDate }: CashRegisterSummaryProps) {
  const { isRegisterOpen, loadCurrentRegister } = useCashRegisterStore()
  const [selectedRegisters, setSelectedRegisters] = useState<string[]>([])
  const [fallbackRegisters, setFallbackRegisters] = useState<CashRegister[]>([])
  const [isLoadingFallback, setIsLoadingFallback] = useState(false)
  const isOpen = isRegisterOpen()

  // T9 (S1): "the registers that ran on the selected day" is a QUERY keyed on
  // that day. It used to be local state behind a `useEffect`, so it re-read the
  // day on every mount (Radix unmounts the whole Caja tab on every tab switch),
  // and `TransactionsByRegisterId` read the SAME day again for the SAME panel.
  const {
    data: registersForDate,
    isLoading: isLoadingDateRegisters,
    isError: isDateRegistersError,
  } = useQuery<CashRegister[]>({
    queryKey: registersByDateQueryKey(selectedDate),
    queryFn: () => cashRegisterService.getRegistersByDate(selectedDate as Date),
    enabled: Boolean(selectedDate),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (isDateRegistersError) {
      log.error("Error al cargar cajas por fecha:", { error: "getRegistersByDate failed" })
    }
  }, [isDateRegistersError])

  // Without a date the card falls back to the currently open register (the
  // cashier's path). Only that fallback still needs a hand-rolled load.
  useEffect(() => {
    if (selectedDate) return

    let cancelled = false
    const loadFallback = async () => {
      setIsLoadingFallback(true)
      try {
        await loadCurrentRegister()
        const currentRegister = useCashRegisterStore.getState().currentRegister
        if (cancelled) return
        if (currentRegister) {
          setFallbackRegisters([currentRegister])
          setSelectedRegisters([currentRegister.id])
        } else {
          setFallbackRegisters([])
          setSelectedRegisters([])
        }
      } catch (error) {
        log.error("Error al cargar registro actual:", { error: String(error) })
        setFallbackRegisters([])
        setSelectedRegisters([])
      } finally {
        if (!cancelled) setIsLoadingFallback(false)
      }
    }
    loadFallback()

    return () => {
      cancelled = true
    }
  }, [selectedDate, loadCurrentRegister])

  const registers = selectedDate ? (registersForDate ?? []) : fallbackRegisters

  // Same rule as before: a day with registers preselects all of them.
  useEffect(() => {
    if (!selectedDate) return
    setSelectedRegisters(
      registersForDate && registersForDate.length > 0 ? registersForDate.map((r) => r.id) : [],
    )
  }, [selectedDate, registersForDate])

  // Server snapshot for the selected set. Disabled when nothing is
  // selected so the hook never calls the RPC with an empty list.
  const { data: summary, isLoading: isLoadingSummary } = useRegisterSummary(selectedRegisters)

  // Initial cash per day: sum each register's `initial_cash` (the
  // server-aggregated `initial_cash` already does this for the
  // selected set, so we just read it from the snapshot).
  const rows = useMemo(() => (summary ? summaryRows(summary) : []), [summary])
  const shortfall = summary ? tipsShortfall(summary) : 0
  const showLegacy = summary ? hasLegacy(summary) : false

  // Movimientos tab: read ONLY while that tab is on screen. It used to fetch on
  // mount AND refetch every time the tab became active, for a key
  // `TransactionsByRegisterId` reads too — one click, two reads of one slot.
  const sortedRegisters = useMemo(() => sortedRegisterIds(selectedRegisters), [selectedRegisters])
  const [activeTab, setActiveTab] = useState<string>("summary")
  const { data: cashTransactions = [] } = useQuery<CashTransaction[]>({
    queryKey: cashTransactionsQueryKey(sortedRegisters),
    queryFn: () => cashRegisterService.getCashTransactionsByRegisters(sortedRegisters),
    enabled: sortedRegisters.length > 0 && activeTab === "cash",
    staleTime: 30_000,
  })

  const isLoadingRegisters = selectedDate ? isLoadingDateRegisters : isLoadingFallback

  if (isLoadingRegisters || isLoadingSummary) {
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
              <Tabs defaultValue="summary" onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="summary">Resumen</TabsTrigger>
                  <TabsTrigger value="details">Detalles</TabsTrigger>
                  <TabsTrigger value="cash">Movimientos de Efectivo</TabsTrigger>
                </TabsList>

                <TabsContent value="summary">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">
                        Efectivo Inicial
                      </h3>
                      <p className="text-2xl font-bold">{formatCurrency(summary.initialCash)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedRegisters.length > 1 && `${selectedRegisters.length} cajas seleccionadas`}
                      </p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">Ventas Totales</h3>
                      <p className="text-2xl font-bold">{formatCurrency(summary.totalSales)}</p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">
                        Efectivo esperado al cierre
                      </h3>
                      <p className="text-2xl font-bold">{formatCurrency(summary.expectedCashAfterTips)}</p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="details">
                  <div className="space-y-4">
                    {rows.length > 0 && (
                      <div className="bg-muted p-4 rounded-lg">
                        <h3 className="font-medium mb-2">Ventas por método</h3>
                        <div className="space-y-2">
                          {rows.map((row) => (
                            <div key={row.paymentMethodId} className="flex justify-between">
                              <span>{row.name}</span>
                              <span className="font-medium">{formatCurrency(row.total)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between border-t pt-2 mt-2 font-medium">
                            <span>Total ventas</span>
                            <span>{formatCurrency(summary.totalSales)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-muted p-4 rounded-lg">
                      <h3 className="font-medium mb-2">Detalles de Efectivo</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Efectivo Inicial:</span>
                          <span className="font-medium">{formatCurrency(summary.initialCash)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Ventas en Efectivo:</span>
                          <span className="font-medium">
                            {formatCurrency(
                              rows.filter((r) => r.kind === "cash").reduce((s, r) => s + r.total, 0),
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cambio Entregado:</span>
                          <span className="font-medium">-{formatCurrency(summary.totalChange)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Ingresos de Efectivo:</span>
                          <span className="font-medium">{formatCurrency(summary.cashDeposits)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Retiros de Efectivo:</span>
                          <span className="font-medium">-{formatCurrency(summary.cashWithdrawals)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span>Efectivo esperado:</span>
                          <span>{formatCurrency(summary.expectedCash)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Propinas a entregar a meseros:</span>
                          <span className="font-medium">-{formatCurrency(summary.tipsPayout)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 font-bold">
                          <span>Efectivo esperado después de propinas:</span>
                          <span>{formatCurrency(summary.expectedCashAfterTips)}</span>
                        </div>
                      </div>
                    </div>

                    {shortfall > 0 && (
                      <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                        <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                        <p>
                          El efectivo en caja no alcanza para pagar las propinas del turno.
                          Faltante: {formatCurrency(shortfall)}.
                        </p>
                      </div>
                    )}

                    {showLegacy && (
                      <div className="bg-muted p-4 rounded-lg">
                        <h3 className="font-medium mb-2">Pagos del sistema anterior</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span>Pagos legacy</span>
                            <span className="font-medium">{summary.legacy.paymentsCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total legacy</span>
                            <span className="font-medium">{formatCurrency(summary.legacy.total)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Propinas legacy</span>
                            <span className="font-medium">{formatCurrency(summary.legacy.tips)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Cambio legacy</span>
                            <span className="font-medium">{formatCurrency(summary.legacy.change)}</span>
                          </div>
                          {Object.entries(summary.legacy.byMethod).map(([m, total]) => (
                            <div key={m} className="flex justify-between text-sm">
                              <span>{m}</span>
                              <span>{formatCurrency(total)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="cash">
                  {cashTransactions.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2">Fecha</th>
                            <th className="text-left py-2">Tipo</th>
                            <th className="text-left py-2">Descripción</th>
                            <th className="text-right py-2">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTransactions.map((transaction) => (
                            <tr key={transaction.id} className="border-b">
                              <td className="py-2 font-medium">
                                {new Date(transaction.timestamp).toLocaleString()}
                              </td>
                              <td className="py-2">
                                {transaction.type === "deposit" ? "Ingreso" : "Retiro"}
                              </td>
                              <td className="py-2">{transaction.description}</td>
                              <td className="py-2 text-right">{formatCurrency(transaction.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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