"use client"

import { useMemo, useState } from "react"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { OpenRegisterDialog } from "@/components/cashier/OpenRegisterDialog"
import { CloseRegisterDialog } from "@/components/cashier/CloseRegisterDialog"
import { AddCashDialog } from "@/components/cashier/AddCashDialog"
import { WithdrawCashDialog } from "@/components/cashier/WithdrawCashDialog"
import { formatCurrency } from "@/utils/helpers"
import { Lock, PlusCircle, MinusCircle, FileText, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { clockTime } from "@/lib/cashier/queue"
import { Chip, Money, focusRing } from "@/components/cashier/cashier-ui"
import { useRegisterSummary } from "@/hooks/use-register-summary"
import { queryClient } from "@/lib/queryClient"
import { registerSummaryQueryKey } from "@/lib/payments/register-summary"
import { registerPaymentsQueryKey } from "@/hooks/use-register-payments"
import type { CashRegisterWithOpener } from "@/lib/api/registers"
import { useConfigStore } from "@/store/use-config-store"
import { XReportModal, type XReportData } from "@/components/printing/XReportModal"
import { useTaxType } from "@/components/printing/tax-label"
import { usePrintingEnabled } from "@/lib/api/printing"
import { sendXReport, xReportFailure } from "@/lib/api/print"
import { toast } from "@/utils/toast"
import { toast as notify } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

export function CashRegisterStatus() {
  const [openDialog, setOpenDialog] = useState(false)
  const [closeDialog, setCloseDialog] = useState(false)
  const [addCashDialog, setAddCashDialog] = useState(false)
  const [withdrawCashDialog, setWithdrawCashDialog] = useState(false)
  const [xReport, setXReport] = useState<XReportData | null>(null)
  const [xReportOpen, setXReportOpen] = useState(false)
  const [sendingXReport, setSendingXReport] = useState(false)
  // informe-x-termico S1/S2: the invoice's condition (lib/api/printing) picks the thermal printer or the screen.
  const printingEnabled = usePrintingEnabled()

  const { isRegisterOpen, currentRegister } = useCashRegisterStore()
  const { businessName, businessNIT, businessAddress, taxPercentage } = useConfigStore()
  const taxType = useTaxType()
  const isOpen = isRegisterOpen()
  // The drawer-cash value comes from the server's `register_summary`
  // (its `expected_cash` is initial + cash-tender + deposits - withdrawals).
  // The browser does NOT recompute it from local transactions any more.
  const summaryIds = useMemo(
    () => (currentRegister ? [currentRegister.id] : []),
    [currentRegister],
  )
  const { data: summary } = useRegisterSummary(summaryIds)

  // Stable refresh used by the children dialogs (deposit/withdraw) so the
  // displayed "efectivo actual" re-renders right after they succeed.
  const refreshSummary = () => {
    if (summaryIds.length > 0) {
      queryClient.invalidateQueries({ queryKey: registerSummaryQueryKey(summaryIds) })
      queryClient.invalidateQueries({ queryKey: registerPaymentsQueryKey(summaryIds) })
    }
  }

  const expectedCash = summary?.expectedCash ?? 0

  const openedAt = currentRegister?.openingTimestamp
    ? clockTime(new Date(currentRegister.openingTimestamp))
    : null

  // The API's register carries who opened it (T18); older registers have none.
  const openerName = (currentRegister as Partial<CashRegisterWithOpener> | null)?.openedBy?.name ?? null
  const openedLabel = openerName
    ? `Caja abierta por ${openerName}${openedAt ? ` · ${openedAt}` : ""}`
    : `Caja abierta${openedAt ? ` · desde ${openedAt}` : ""}`

  // caja-cierres S4: "Informe X", a partial summary that resets nothing.
  const xReportData = (): XReportData | null =>
    currentRegister && summary
      ? {
          business: { name: businessName, nit: businessNIT, address: businessAddress },
          cashierName: openerName,
          openedAt: new Date(currentRegister.openingTimestamp),
          printedAt: new Date(),
          summary,
          tax: { type: taxType, rate: taxPercentage },
        }
      : null

  const showXReport = (report = xReportData()) => {
    if (!report) return
    setXReport(report)
    setXReportOpen(true)
  }

  // informe-x-termico S1: with thermal printers the summary goes to them as the server answered it; S2: else on screen.
  const xReportAction = async () => {
    const report = xReportData()
    if (!report) return
    if (!printingEnabled) {
      showXReport(report)
      return
    }
    setSendingXReport(true)
    try {
      await sendXReport(report)
      notify({ title: "Informe X enviado a la impresora" })
    } catch (error) {
      notify({
        title: "Error",
        description: xReportFailure(error),
        variant: "destructive",
        action: (
          <ToastAction altText="Ver en pantalla" onClick={() => showXReport(report)}>
            Ver en pantalla
          </ToastAction>
        ),
      })
    } finally {
      setSendingXReport(false)
    }
  }

  const action = cn(
    "inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-sm font-semibold text-fg hover:bg-surface-2",
    focusRing,
  )

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {isOpen ? (
          <>
            <Chip tone="ok" dot className="min-w-0 max-w-full shrink">
              <span className="truncate" title={openedLabel}>
                {openedLabel}
              </span>
            </Chip>
            <span className="whitespace-nowrap text-sm text-muted-fg">
              Efectivo actual: <Money className="font-semibold text-fg">{formatCurrency(expectedCash)}</Money>
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={action} onClick={() => setAddCashDialog(true)} aria-label="Agregar efectivo">
                <PlusCircle aria-hidden="true" className="h-4 w-4 text-status-ok-fg" />
                <span className="hidden min-[1600px]:inline">Agregar efectivo</span>
              </button>
              <button type="button" className={action} onClick={() => setWithdrawCashDialog(true)} aria-label="Retirar efectivo">
                <MinusCircle aria-hidden="true" className="h-4 w-4 text-status-danger-fg" />
                <span className="hidden min-[1600px]:inline">Retirar efectivo</span>
              </button>
              <button type="button" className={action} onClick={xReportAction} disabled={!summary || sendingXReport}>
                <FileText aria-hidden="true" className="h-4 w-4" />
                Informe X
              </button>
              {printingEnabled && (
                <button
                  type="button"
                  className={action}
                  onClick={() => showXReport()}
                  disabled={!summary}
                  aria-label="Ver Informe X en pantalla"
                  title="Ver Informe X en pantalla"
                >
                  <Eye aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              <button type="button" className={action} onClick={() => setCloseDialog(true)}>
                <Lock aria-hidden="true" className="h-4 w-4" />
                Cerrar caja
              </button>
            </div>
          </>
        ) : (
          <>
            <Chip tone="warning" dot>
              Caja cerrada
            </Chip>
            <span className="text-sm text-muted-fg">Debe abrir la caja para procesar pagos.</span>
            <button
              type="button"
              className={cn(action, "ml-auto border-transparent bg-brand text-brand-contrast hover:bg-brand-strong")}
              onClick={() => setOpenDialog(true)}
            >
              Abrir caja
            </button>
          </>
        )}
      </div>

      <OpenRegisterDialog open={openDialog} onOpenChange={setOpenDialog} />
      <CloseRegisterDialog open={closeDialog} onOpenChange={setCloseDialog} onSuccess={refreshSummary} />
      <AddCashDialog open={addCashDialog} onOpenChange={setAddCashDialog} onSuccess={refreshSummary} />
      <WithdrawCashDialog open={withdrawCashDialog} onOpenChange={setWithdrawCashDialog} onSuccess={refreshSummary} />
      <XReportModal
        open={xReportOpen}
        onOpenChange={setXReportOpen}
        report={xReport}
        onPrintBlocked={() => toast.error("El navegador bloqueó la ventana de impresión")}
      />
    </>
  )
}
