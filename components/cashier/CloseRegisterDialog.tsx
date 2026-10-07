"use client"

import { useMemo, useState } from "react"
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
import { AlertTriangle, Loader2 } from "lucide-react"

interface CloseRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (summary: RegisterSummaryType) => void
}

/**
 * Close drawer. The browser never recomputes totals: the server
 * `close_register` RPC takes the row lock, builds the summary at the
 * lock instant, sets `final_cash = expected_cash_after_tips`, and
 * returns it. Anything the user sees in the dialog comes from
 * `useRegisterSummary(ids)` (same call the admin reports use) so the
 * preview and the lock-time numbers are guaranteed to use the same
 * definition.
 *
 * Render layout, in order:
 *   1. one row per catalog method (`summaryRows(summary)`)
 *   2. totals: ventas (totalSales), propinas (totalTips), cambio
 *      entregado (totalChange), ingresos (cashDeposits), retiros
 *      (cashWithdrawals)
 *   3. expected cash (`expectedCash`)
 *   4. "Propinas a entregar a meseros" line (`tipsPayout`) + expected
 *      cash after tips (`expectedCashAfterTips`)
 *   5. red advisory when `tipsShortfall(summary) > 0` (non-blocking)
 *   6. legacy block only when `hasLegacy(summary)`
 *   7. success screen showing the server `final_cash`
 *
 * The confirm button is gated by `createSingleFlight` so a double-click
 * cannot fire two `close_register` calls back-to-back (the RPC would
 * idempotently no-op the second, but the brief spinner flicker is still
 * confusing for the cashier).
 */
export function CloseRegisterDialog({ open, onOpenChange, onSuccess }: CloseRegisterDialogProps) {
  const { closeRegister, currentRegister } = useCashRegisterStore()
  const [closeFlight] = useState(createSingleFlight)
  const [running, setRunning] = useState(false)
  const [confirmedSummary, setConfirmedSummary] = useState<RegisterSummaryType | null>(null)

  const ids = useMemo(
    () => (currentRegister ? [currentRegister.id] : []),
    [currentRegister],
  )
  const { data: preview, isLoading: loadingPreview } = useRegisterSummary(ids)

  const handleClose = async () => {
    const flight = closeFlight.run(async () => {
      setRunning(true)
      try {
        const result = await closeRegister()
        if (!result) {
          toast.error("No se pudo cerrar la caja")
          return
        }
        setConfirmedSummary(result)
        toast.success(
          `La caja ha sido cerrada correctamente con un total de ${formatCurrency(result.totalSales)}`,
        )
        if (onSuccess) onSuccess(result)
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
    onOpenChange(false)
  }

  // Success screen.
  if (confirmedSummary) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cierre de Caja Completado</DialogTitle>
          </DialogHeader>
          <CloseSummaryView summary={confirmedSummary} heading="Resumen del Día" />
          <DialogFooter>
            <Button onClick={handleFinish}>Finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar Caja</DialogTitle>
          <DialogDescription>
            El servidor toma el lock de la caja y persiste el cierre. Esta es la vista previa
            con los números que verás confirmados al cerrar.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p>¿Está seguro que desea cerrar la caja?</p>

          {preview ? (
            <CloseSummaryView summary={preview} heading="Vista Previa del Cierre" compact />
          ) : loadingPreview ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando resumen...
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No hay caja abierta.</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Cancelar
          </Button>
          <Button onClick={handleClose} disabled={running || !preview}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cerrar Caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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