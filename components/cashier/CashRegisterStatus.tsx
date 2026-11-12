"use client"

import { useMemo, useState } from "react"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { OpenRegisterDialog } from "@/components/cashier/OpenRegisterDialog"
import { CloseRegisterDialog } from "@/components/cashier/CloseRegisterDialog"
import { AddCashDialog } from "@/components/cashier/AddCashDialog"
import { WithdrawCashDialog } from "@/components/cashier/WithdrawCashDialog"
import { formatCurrency } from "@/utils/helpers"
import { Lock, PlusCircle, MinusCircle, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { clockTime } from "@/lib/cashier/queue"
import { Chip, Money, focusRing } from "@/components/cashier/cashier-ui"
import { useRegisterSummary } from "@/hooks/use-register-summary"
import { queryClient } from "@/lib/queryClient"
import { registerSummaryQueryKey } from "@/lib/payments/register-summary"
import { registerPaymentsQueryKey } from "@/hooks/use-register-payments"
import type { CashRegisterWithOpener } from "@/lib/api/registers"
import { useConfigStore } from "@/store/use-config-store"
import { XReportSlip } from "@/components/printing/XReportSlip"
import { printSlip } from "@/components/printing/slip-format"
import { toast } from "@/utils/toast"

export function CashRegisterStatus() {
  const [openDialog, setOpenDialog] = useState(false)
  const [closeDialog, setCloseDialog] = useState(false)
  const [addCashDialog, setAddCashDialog] = useState(false)
  const [withdrawCashDialog, setWithdrawCashDialog] = useState(false)

  const { isRegisterOpen, currentRegister } = useCashRegisterStore()
  const { businessName, businessNIT, businessAddress } = useConfigStore()
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
  const printXReport = () => {
    if (!currentRegister || !summary) return
    const printed = printSlip(
      <XReportSlip
        business={{ name: businessName, nit: businessNIT, address: businessAddress }}
        cashierName={openerName}
        openedAt={new Date(currentRegister.openingTimestamp)}
        printedAt={new Date()}
        summary={summary}
      />,
      { title: "Informe X" },
    )
    if (!printed) toast.error("El navegador bloqueó la ventana de impresión")
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
              <button type="button" className={action} onClick={printXReport} disabled={!summary}>
                <FileText aria-hidden="true" className="h-4 w-4" />
                Informe X
              </button>
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
    </>
  )
}
