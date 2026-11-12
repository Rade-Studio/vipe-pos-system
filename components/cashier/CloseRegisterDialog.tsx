"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useConfigStore } from "@/store/use-config-store"
import { formatCurrency } from "@/utils/helpers"
import { toast } from "@/utils/toast"
import { useRegisterSummary } from "@/hooks/use-register-summary"
import type { RegisterSummary as RegisterSummaryType } from "@/lib/payments/register-summary"
import {
  hasLegacy,
  summaryRows,
  tipsShortfall,
} from "@/lib/payments/register-summary"
import { createSingleFlight } from "@/lib/payments/single-flight"
import {
  closeNoteValid,
  countedTotal,
  denominationsOf,
  type DenominationCounts,
} from "@/lib/payments/denominations"
import { AlertTriangle, Loader2, Printer } from "lucide-react"
import { VoidFlow } from "@/components/voids/VoidFlow"
import type { VoidTarget } from "@/components/voids/flow"
import { getByStatus, type OrderDto } from "@/lib/api/orders"
import { closeRefusalOf, openOrdersConflictOf } from "@/lib/api/payments"
import { getCashTransactionsByRegisterId, type CashMovement, type CashRegisterWithOpener } from "@/lib/api/registers"
import { ShiftCloseSlip, type ShiftCloseSlipProps } from "@/components/printing/ShiftCloseSlip"
import { printSlip } from "@/components/printing/slip-format"
import { useTaxType } from "@/components/printing/tax-label"
import {
  OPEN_ORDER_STATUSES,
  OpenOrdersList,
  cancelTarget,
  leaveOpenOrdersLabel,
} from "./close-register/OpenOrdersList"
import { CLOSE_STEP_PANEL_ID, CloseStepper, closeStepTabId, type CloseStep } from "./close-register/CloseStepper"
import { MovementsStep } from "./close-register/MovementsStep"
import { ArqueoStep } from "./close-register/ArqueoStep"
import { ConfirmStep } from "./close-register/ConfirmStep"

interface CloseRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (summary: RegisterSummaryType) => void
}

const STEP_TITLES = ["Órdenes abiertas", "Movimientos y propinas", "Arqueo", "Confirmar"] as const

/** A whole, non-negative peso amount typed by the cashier, or null. */
const wholePesos = (input: string): number | null => {
  if (input.trim() === "") return null
  const value = Number(input)
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * "Cerrar turno" (caja-cierres S3, design 05): a four-step wizard. The
 * browser never recomputes totals: the server `close_register` takes the row
 * lock, builds the summary at that instant and stores the count; the preview
 * comes from `useRegisterSummary(ids)`, the same definition.
 *
 *   1. Órdenes abiertas (ordenes-abiertas-caja S2): each cancellable through
 *      the audited VoidFlow; with any left the close needs "Dejar N órdenes
 *      abiertas" and sends `leaveOpenOrders` (a 409 open_orders race brings
 *      the cashier back here with the server message).
 *   2. Movimientos y propinas: the shift's entries and withdrawals with reason
 *      and author (GET cash-transactions), the tips and the cash tips payout.
 *   3. Arqueo: bills and coins with steppers, or "Arqueo rápido: solo total";
 *      the cuadre card compares with `expectedCashAfterTips`, and a
 *      difference needs a 3–300 character note (the API's note_required).
 *   4. Confirmar: the summary, "Imprimir cierre de turno" (a preview) and
 *      "Cerrar turno", which sends countedCash (+ the non-zero denominations
 *      when the grid was used) + note + leaveOpenOrders. The API's 422/409
 *      messages show inline.
 *
 * The success screen reprints the slip with the stored count and closer.
 * The close is gated by `createSingleFlight` so a double-click cannot fire
 * two `close_register` calls back-to-back.
 */
export function CloseRegisterDialog({ open, onOpenChange, onSuccess }: CloseRegisterDialogProps) {
  const { closeRegister, currentRegister } = useCashRegisterStore()
  const { businessName, businessNIT, businessAddress, taxPercentage } = useConfigStore()
  const taxType = useTaxType()
  const [closeFlight] = useState(createSingleFlight)
  const [running, setRunning] = useState(false)
  const [confirmedSummary, setConfirmedSummary] = useState<RegisterSummaryType | null>(null)
  const [closedSlip, setClosedSlip] = useState<ShiftCloseSlipProps | null>(null)

  const ids = useMemo(
    () => (currentRegister ? [currentRegister.id] : []),
    [currentRegister],
  )
  const { data: preview, isLoading: loadingPreview } = useRegisterSummary(ids)

  const [step, setStep] = useState(0)
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]))
  const panelHeading = useRef<HTMLHeadingElement>(null)
  const [openOrders, setOpenOrders] = useState<OrderDto[] | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  const [movements, setMovements] = useState<CashMovement[] | null>(null)
  const [counts, setCounts] = useState<DenominationCounts>({})
  const [quick, setQuick] = useState(false)
  const [quickInput, setQuickInput] = useState("")
  const [note, setNote] = useState("")

  const loadOpenOrders = useCallback(async () => {
    try {
      setOpenOrders(await getByStatus(OPEN_ORDER_STATUSES, { include: ["table", "waiter"] }))
    } catch {
      setOpenOrders([])
      toast.error("No se pudieron cargar las órdenes abiertas")
    }
    setLeaveOpen(false)
  }, [])

  const registerId = currentRegister?.id
  useEffect(() => {
    if (!open) return
    setServerError(null)
    setStep(0)
    setVisited(new Set([0]))
    setCounts({})
    setQuick(false)
    setQuickInput("")
    setNote("")
    void loadOpenOrders()
  }, [open, loadOpenOrders])

  useEffect(() => {
    if (!open || !registerId) return
    let live = true
    setMovements(null)
    getCashTransactionsByRegisterId(registerId)
      .then((rows) => live && setMovements(rows))
      .catch(() => live && setMovements((useCashRegisterStore.getState().currentRegister?.cashTransactions ?? []) as CashMovement[]))
    return () => {
      live = false
    }
  }, [open, registerId])

  const openCount = openOrders?.length ?? 0
  const counted = quick ? wholePesos(quickInput) : countedTotal(counts)
  const difference = counted !== null && preview ? counted - preview.expectedCashAfterTips : 0
  const trimmedNote = note.trim()
  const noteValid = closeNoteValid(note, difference)
  const ordersReady = openOrders !== null && (openCount === 0 || leaveOpen)
  const countReady = counted !== null && noteValid
  const denominations = quick ? [] : denominationsOf(counts)

  const goTo = (index: number, focusPanel = false) => {
    setStep(index)
    setVisited((seen) => new Set(seen).add(index))
    if (focusPanel) requestAnimationFrame(() => panelHeading.current?.focus())
  }

  const steps: CloseStep[] = [
    {
      title: STEP_TITLES[0],
      done: ordersReady,
      status: openOrders === null ? "Cargando…" : openCount === 0 ? "Listo" : leaveOpen ? `${openCount} dejadas` : `${openCount} abiertas`,
    },
    { title: STEP_TITLES[1], done: visited.has(1), status: visited.has(1) ? "Revisado" : "Revisar" },
    { title: STEP_TITLES[2], done: countReady && visited.has(2), status: countReady && visited.has(2) ? "Listo" : "Contar efectivo" },
    { title: STEP_TITLES[3], done: false, status: "Cerrar turno" },
  ]

  const slipBase = () => ({
    business: { name: businessName, nit: businessNIT, address: businessAddress },
    cashierName: (currentRegister as Partial<CashRegisterWithOpener> | null)?.openedBy?.name ?? null,
    openedAt: new Date(currentRegister?.openingTimestamp ?? Date.now()),
    movements: movements ?? [],
    tax: { type: taxType, rate: taxPercentage },
  })

  const print = (slip: ShiftCloseSlipProps) => {
    if (!printSlip(<ShiftCloseSlip {...slip} />, { title: "Cierre de turno" })) {
      toast.error("El navegador bloqueó la ventana de impresión")
    }
  }

  const printPreview = () => {
    if (!preview || counted === null) return
    print({
      ...slipBase(),
      summary: preview,
      preview: true,
      closedAt: null,
      closedByName: null,
      countedCash: counted,
      difference,
      note: difference !== 0 && trimmedNote ? trimmedNote : null,
      denominations: quick ? null : denominations,
    })
  }

  const handleClose = async () => {
    const flight = closeFlight.run(async () => {
      setRunning(true)
      setServerError(null)
      try {
        if (counted === null) return
        const base = slipBase()
        const result = await closeRegister({
          ...(openCount > 0 ? { leaveOpenOrders: true } : {}),
          countedCash: counted,
          ...(denominations.length > 0 ? { denominations } : {}),
          ...(difference !== 0 && trimmedNote ? { note: trimmedNote } : {}),
        })
        if (!result) {
          setServerError("No se pudo cerrar la caja. Intenta de nuevo.")
          return
        }
        const stored = useCashRegisterStore.getState().lastClose
        setClosedSlip({
          ...base,
          summary: result,
          closedAt: stored?.closingTimestamp ?? new Date(),
          closedByName: stored?.closedBy?.name ?? null,
          countedCash: stored?.countedCash ?? counted,
          difference: stored?.cashDifference ?? counted - result.expectedCashAfterTips,
          note: stored ? (stored.closeNote ?? null) : trimmedNote || null,
          denominations: stored ? (stored.denominations ?? null) : denominations,
        })
        setConfirmedSummary(result)
        toast.success(
          `La caja ha sido cerrada correctamente con un total de ${formatCurrency(result.totalSales)}`,
        )
        if (onSuccess) onSuccess(result)
      } catch (error) {
        const refusal = closeRefusalOf(error)
        if (refusal) {
          setServerError(refusal.message)
          return
        }
        const openOrdersConflict = openOrdersConflictOf(error)
        if (!openOrdersConflict) throw error
        setServerError(openOrdersConflict.message)
        goTo(0)
        await loadOpenOrders()
      } finally {
        setRunning(false)
      }
    })
    if (!flight) {
      // A previous close is still running; ignore the second click.
      return
    }
    await flight
  }

  const handleFinish = () => {
    setConfirmedSummary(null)
    setClosedSlip(null)
    onOpenChange(false)
  }

  const sheet =
    "flex max-h-[100dvh] flex-col gap-3 max-sm:h-[100dvh] max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:max-h-[92vh]"

  // Success screen.
  if (confirmedSummary) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`${sheet} sm:max-w-md`}>
          <DialogHeader>
            <DialogTitle>Turno cerrado</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CloseSummaryView summary={confirmedSummary} heading="Resumen del turno" />
          </div>
          <DialogFooter className="gap-2">
            {closedSlip && (
              <Button variant="outline" className="h-11" onClick={() => print(closedSlip)}>
                <Printer aria-hidden="true" className="h-4 w-4" />
                Imprimir cierre de turno
              </Button>
            )}
            <Button className="h-11" onClick={handleFinish}>Finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const last = STEP_TITLES.length - 1
  const canClose = !running && !!preview && ordersReady && countReady

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${sheet} sm:max-w-3xl`}>
        <DialogHeader>
          <DialogTitle>Cierre de turno</DialogTitle>
          <DialogDescription>
            Revisa las órdenes y los movimientos, cuenta el efectivo y confirma. El servidor guarda el cierre.
          </DialogDescription>
        </DialogHeader>

        <CloseStepper steps={steps} active={step} onSelect={(index) => goTo(index)} />

        {serverError && (
          <p role="alert" className="rounded-md border border-status-danger-line bg-status-danger-bg p-3 text-sm text-status-danger-fg">
            {serverError}
          </p>
        )}

        <div
          role="tabpanel"
          id={CLOSE_STEP_PANEL_ID}
          aria-labelledby={closeStepTabId(step)}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1"
        >
          <h3 ref={panelHeading} tabIndex={-1} className="text-base font-semibold focus:outline-none">
            {STEP_TITLES[step]}
          </h3>

          {step === 0 &&
            (openOrders === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-fg">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando órdenes…
              </div>
            ) : openCount === 0 ? (
              <p className="text-sm text-muted-fg">No hay órdenes abiertas.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-fg">
                  Cóbralas o cancélalas antes de cerrar, o confirma que pasan a la siguiente caja.
                </p>
                <OpenOrdersList orders={openOrders} now={Date.now()} onCancel={(order) => setVoidTarget(cancelTarget(order))} />
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={leaveOpen}
                    onChange={(event) => setLeaveOpen(event.target.checked)}
                  />
                  {leaveOpenOrdersLabel(openCount)}
                </label>
              </div>
            ))}

          {step === 1 && <MovementsStep movements={movements} summary={preview} />}

          {step === 2 && (
            <ArqueoStep
              summary={preview}
              counts={counts}
              onCountsChange={setCounts}
              quick={quick}
              onQuickChange={setQuick}
              quickInput={quickInput}
              onQuickInputChange={setQuickInput}
              counted={counted}
              note={note}
              onNoteChange={setNote}
            />
          )}

          {step === 3 &&
            (preview ? (
              <>
                <ConfirmStep summary={preview} counted={counted} note={note} leftOpen={leaveOpen ? openCount : 0} />
                <CloseSummaryAdvisories summary={preview} />
              </>
            ) : loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-muted-fg">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculando resumen...
              </div>
            ) : (
              <p className="text-sm text-muted-fg">No hay caja abierta.</p>
            ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" className="h-11" onClick={() => goTo(step - 1, true)} disabled={step === 0 || running}>
            Atrás
          </Button>
          {step < last ? (
            <Button className="h-11" onClick={() => goTo(step + 1, true)}>
              Continuar
            </Button>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" className="h-11" onClick={printPreview} disabled={!preview || counted === null}>
                <Printer aria-hidden="true" className="h-4 w-4" />
                Imprimir cierre de turno
              </Button>
              <Button className="h-11" onClick={handleClose} disabled={!canClose}>
                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cerrar turno
              </Button>
            </div>
          )}
        </DialogFooter>
        <VoidFlow
          target={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => void loadOpenOrders()}
        />
      </DialogContent>
    </Dialog>
  )
}

/** The tips-shortfall advisory of the close (non-blocking). */
function CloseSummaryAdvisories({ summary }: { summary: RegisterSummaryType }) {
  const shortfall = tipsShortfall(summary)
  if (shortfall <= 0) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-status-danger-line bg-status-danger-bg p-3 text-sm text-status-danger-fg">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <p>
        El efectivo en caja no alcanza para pagar las propinas del turno. Faltante: {formatCurrency(shortfall)}. No
        bloquea el cierre.
      </p>
    </div>
  )
}

function CloseSummaryView({
  summary,
  heading,
  compact = false,
}: {
  summary: RegisterSummaryType
  heading: string
  compact?: boolean
}) {
  const rows = summaryRows(summary)
  const shortfall = tipsShortfall(summary)

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{heading}</h3>

      {rows.length > 0 && (
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">Ventas por método</p>
          {rows.map((row) => (
            <div key={row.paymentMethodId} className="flex justify-between">
              <span>{row.name}</span>
              <span>{formatCurrency(row.total)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 rounded-md border p-3 text-sm">
        <div className="flex justify-between">
          <span>Efectivo inicial</span>
          <span>{formatCurrency(summary.initialCash)}</span>
        </div>
        <div className="flex justify-between">
          <span>Ventas</span>
          <span>{formatCurrency(summary.totalSales)}</span>
        </div>
        <div className="flex justify-between">
          <span>Propinas</span>
          <span>{formatCurrency(summary.totalTips)}</span>
        </div>
        <div className="flex justify-between">
          <span>Cambio entregado</span>
          <span>-{formatCurrency(summary.totalChange)}</span>
        </div>
        <div className="flex justify-between">
          <span>Ingresos de efectivo</span>
          <span>{formatCurrency(summary.cashDeposits)}</span>
        </div>
        <div className="flex justify-between">
          <span>Retiros de efectivo</span>
          <span>-{formatCurrency(summary.cashWithdrawals)}</span>
        </div>
        <div className="flex justify-between border-t pt-1 font-medium">
          <span>Efectivo esperado</span>
          <span>{formatCurrency(summary.expectedCash)}</span>
        </div>
        <div className="flex justify-between">
          <span>Propinas a entregar a meseros</span>
          <span>-{formatCurrency(summary.tipsPayout)}</span>
        </div>
        <div className="flex justify-between border-t pt-1 font-bold">
          <span>Efectivo esperado después de propinas</span>
          <span>{formatCurrency(summary.expectedCashAfterTips)}</span>
        </div>
      </div>

      {shortfall > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <p>
            El efectivo en caja no alcanza para pagar las propinas del turno. Faltante:
            {formatCurrency(shortfall)}. Esta caja solo paga, no bloquea el cierre.
          </p>
        </div>
      )}

      {hasLegacy(summary) && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Pagos del sistema anterior</p>
          <div className="flex justify-between">
            <span>Pagos legacy</span>
            <span>{summary.legacy.paymentsCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Total legacy</span>
            <span>{formatCurrency(summary.legacy.total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Propinas legacy</span>
            <span>{formatCurrency(summary.legacy.tips)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cambio legacy</span>
            <span>{formatCurrency(summary.legacy.change)}</span>
          </div>
          {!compact && Object.keys(summary.legacy.byMethod).length > 0 && (
            <div className="mt-1 border-t pt-1">
              <p className="text-xs text-muted-foreground">Por método legacy</p>
              {Object.entries(summary.legacy.byMethod).map(([m, total]) => (
                <div key={m} className="flex justify-between text-xs">
                  <span>{m}</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border p-3 text-sm">
        <div className="flex justify-between">
          <span>Cuentas pagadas</span>
          <span>{summary.paymentsCount}</span>
        </div>
        <div className="flex justify-between">
          <span>Total facturado</span>
          <span>{formatCurrency(summary.totalBilled)}</span>
        </div>
      </div>
    </div>
  )
}