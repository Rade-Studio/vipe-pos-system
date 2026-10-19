"use client"

import { useEffect, useMemo, useState } from "react"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { log } from "@/lib/log"
import { Panel } from "@/components/admin/common/Panel"
import { StatCard } from "@/components/admin/common/StatCard"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
      <Panel title="Resumen de Caja">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <Skeleton className="mb-2 h-4 w-32" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Resumen de Caja" description={selectedDate?.toLocaleDateString()}>
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
                <TabsList className="mb-4 h-auto w-full flex-wrap justify-start sm:w-auto">
                  <TabsTrigger value="summary">Resumen</TabsTrigger>
                  <TabsTrigger value="details">Detalles</TabsTrigger>
                  <TabsTrigger value="cash">Movimientos de Efectivo</TabsTrigger>
                </TabsList>

                <TabsContent value="summary">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatCard
                      title="Efectivo Inicial"
                      value={formatCurrency(summary.initialCash)}
                      hint={selectedRegisters.length > 1 ? `${selectedRegisters.length} cajas seleccionadas` : undefined}
                    />
                    <StatCard title="Ventas Totales" value={formatCurrency(summary.totalSales)} />
                    <StatCard title="Efectivo esperado al cierre" value={formatCurrency(summary.expectedCashAfterTips)} />
                  </div>
                </TabsContent>

                <TabsContent value="details">
                  <div className="space-y-4">
                    {rows.length > 0 && (
                      <div className="rounded-lg border p-4">
                        <h3 className="mb-3 text-sm font-medium">Ventas por método</h3>
                        <div className="space-y-2 text-sm">
                          {rows.map((row) => (
                            <div key={row.paymentMethodId} className="flex justify-between">
                              <span>{row.name}</span>
                              <span className="font-medium tabular-nums">{formatCurrency(row.total)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between border-t pt-2 mt-2 font-medium">
                            <span>Total ventas</span>
                            <span>{formatCurrency(summary.totalSales)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border p-4">
                      <h3 className="mb-3 text-sm font-medium">Detalles de Efectivo</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span>Efectivo Inicial:</span>
                          <span className="font-medium tabular-nums">{formatCurrency(summary.initialCash)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Ventas en Efectivo:</span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(
                              rows.filter((r) => r.kind === "cash").reduce((s, r) => s + r.total, 0),
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Cambio Entregado:</span>
                          <span className="font-medium tabular-nums">-{formatCurrency(summary.totalChange)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Ingresos de Efectivo:</span>
                          <span className="font-medium tabular-nums">{formatCurrency(summary.cashDeposits)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Retiros de Efectivo:</span>
                          <span className="font-medium tabular-nums">-{formatCurrency(summary.cashWithdrawals)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span>Efectivo esperado:</span>
                          <span>{formatCurrency(summary.expectedCash)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Propinas a entregar a meseros:</span>
                          <span className="font-medium tabular-nums">-{formatCurrency(summary.tipsPayout)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 font-bold">
                          <span>Efectivo esperado después de propinas:</span>
                          <span>{formatCurrency(summary.expectedCashAfterTips)}</span>
                        </div>
                      </div>
                    </div>

                    {shortfall > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          El efectivo en caja no alcanza para pagar las propinas del turno.
                          Faltante: {formatCurrency(shortfall)}.
                        </AlertDescription>
                      </Alert>
                    )}

                    {showLegacy && (
                      <div className="rounded-lg border p-4">
                        <h3 className="mb-3 text-sm font-medium">Pagos del sistema anterior</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between gap-3">
                            <span>Pagos legacy</span>
                            <span className="font-medium tabular-nums">{summary.legacy.paymentsCount}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Total legacy</span>
                            <span className="font-medium tabular-nums">{formatCurrency(summary.legacy.total)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Propinas legacy</span>
                            <span className="font-medium tabular-nums">{formatCurrency(summary.legacy.tips)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Cambio legacy</span>
                            <span className="font-medium tabular-nums">{formatCurrency(summary.legacy.change)}</span>
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
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="px-3 py-2 text-left font-medium">Fecha</th>
                            <th className="px-3 py-2 text-left font-medium">Tipo</th>
                            <th className="px-3 py-2 text-left font-medium">Descripción</th>
                            <th className="px-3 py-2 text-right font-medium">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTransactions.map((transaction) => (
                            <tr key={transaction.id} className="border-b last:border-0">
                              <td className="whitespace-nowrap px-3 py-2 font-medium">
                                {new Date(transaction.timestamp).toLocaleString()}
                              </td>
                              <td className="px-3 py-2">
                                {transaction.type === "deposit" ? "Ingreso" : "Retiro"}
                              </td>
                              <td className="px-3 py-2">{transaction.description}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(transaction.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No hay movimientos de efectivo registrados
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {selectedRegisters.length === 0
                  ? "Seleccione al menos una caja para ver el resumen"
                  : "No hay datos disponibles para las cajas seleccionadas"}
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {selectedDate
              ? `No hay cajas registradas para el ${selectedDate.toLocaleDateString()}`
              : isOpen
                ? "No hay transacciones registradas"
                : "No hay una caja abierta"}
          </div>
        )}
    </Panel>
  )
}