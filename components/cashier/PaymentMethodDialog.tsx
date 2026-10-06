"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { AlertTriangle, Check, X } from "lucide-react"
import { useConfigStore } from "@/store/use-config-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { PrintableInvoice, CartItem } from "@/types"
import { toast } from "@/utils/toast"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { listPaymentMethods, payOrder } from "@/lib/supabase/payments-service"
import { PaymentServiceError } from "@/lib/payments/types"
import type {
  PayOrderResult,
  PaymentMethodOption,
  PaymentServiceErrorKind,
} from "@/lib/payments/types"
import { computeBill } from "@/lib/payments/bill"
import { buildPayOrderTenders } from "@/lib/payments/tenders"
import { newIdempotencyKey } from "@/lib/payments/idempotency"
import {
  computeSurplusAsTip,
  initialPaymentDraft,
  paymentDraftReducer,
  selectView,
} from "@/lib/payments/draft"
import type {
  PaymentDraftAction,
  PaymentDraftState,
} from "@/lib/payments/draft"
import { orderService } from "@/lib/supabase/service"
import { log } from "@/lib/log"
import { MethodPicker } from "./payment/MethodPicker"
import { TenderLinesList } from "./payment/TenderLinesList"
import { TipControl } from "./payment/TipControl"

interface PaymentMethodDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  tableId: string
  /** Bill total (subtotal + tax + tip) from the caller's cache. Kept for API compat. */
  amount: number
  tableTotal: number
  onSuccess: () => void
  isPartialPayment?: boolean
  selectedItems?: string[]
}

interface OrderForBill {
  order_items: Array<{ id: string; name: string; price: number; quantity: number; comments?: string | null }>
  tax_percentage: number
  tip_percentage: number
  subtotal: number
  tax: number
  tip: number
  table_id: string | null
  waiter_id: string | null
}

const ERROR_TOAST: Record<PaymentServiceErrorKind, string> = {
  "not-authorized": "No tienes permiso para cobrar",
  "not-found": "La orden no existe o ya no está disponible",
  rejected: "", // server message is shown directly
  "invalid-input": "", // server message is shown directly
  unknown: "Ocurrió un error al procesar el pago. Intenta de nuevo.",
}

function paymentErrorMessage(err: unknown): string {
  if (err instanceof PaymentServiceError) {
    const base = ERROR_TOAST[err.kind]
    if (base) return base
    return err.message || "La operación fue rechazada por el servidor"
  }
  return "Ocurrió un error inesperado. Intenta de nuevo."
}

function uuid(): string {
  return newIdempotencyKey(typeof crypto !== "undefined" ? crypto : undefined)
}

export function PaymentMethodDialog({
  open,
  onOpenChange,
  orderId,
  // tableId / amount / tableTotal / isPartialPayment / selectedItems are
  // part of the legacy props contract; the new dialog fetches the order
  // directly and computes the bill client-side, so they are unused but
  // accepted for backward compatibility with the call site in CashierView.
  tableId: _tableId,
  amount: _amount,
  tableTotal: _tableTotal,
  onSuccess,
  isPartialPayment: _isPartialPayment = false,
  selectedItems: _selectedItems = [],
}: PaymentMethodDialogProps) {
  const [draft, setDraft] = useState<PaymentDraftState>(() =>
    initialPaymentDraft({ amountDue: 0, suggestedTip: 0, idempotencyKey: uuid() }),
  )
  const [showInvoice, setShowInvoice] = useState(false)
  const [invoiceData, setInvoiceData] = useState<PrintableInvoice | null>(null)
  const [orderData, setOrderData] = useState<OrderForBill | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { isRegisterOpen, hasEnoughCashForChange, currentRegister, getCurrentRegisterSummary } =
    useCashRegisterStore()
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()

  // Active catalog (filtered + ordered). The full list still comes from
  // the service so `selectView` can flag inactive / unknown ids.
  const { data: allMethods = [], isLoading: loadingMethods } = useQuery<PaymentMethodOption[]>({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
    enabled: open,
    staleTime: 60_000,
  })
  const activeMethods = useMemo(
    () => allMethods.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [allMethods],
  )
  const methodById = useMemo(
    () => new Map(allMethods.map((m) => [m.id, m] as const)),
    [allMethods],
  )
  const methodName = (id: string) => methodById.get(id)?.name ?? "Método"

  // Load the order when the dialog opens so we can compute the bill
  // client-side and display accurate numbers even if the caller's
  // `amount` prop is stale.
  useEffect(() => {
    if (!open || !orderId) return
    let cancelled = false
    setLoadingOrder(true)
    ;(async () => {
      try {
        const order = await orderService.getById(orderId)
        if (cancelled) return
        setOrderData(order as OrderForBill)
      } catch (err) {
        log.error("Error al cargar la orden para pago:", { error: String(err) })
        if (!cancelled) toast.error("No se pudo cargar la información de la orden")
      } finally {
        if (!cancelled) setLoadingOrder(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, orderId])

  // Re-seed the draft when the dialog opens with a fresh order. A new
  // idempotency key is generated for each "open" of the dialog (one
  // attempt); it is preserved across `submitFailed` so a retry uses
  // the same key per the server's idempotency contract.
  useEffect(() => {
    if (!open || !orderData) return
    const bill = computeBill(
      orderData.order_items.map((it) => ({ price: it.price, quantity: it.quantity })),
      orderData.tax_percentage,
      orderData.tip_percentage,
    )
    setDraft(
      initialPaymentDraft({
        amountDue: bill.amountDue,
        suggestedTip: bill.suggestedTip,
        idempotencyKey: uuid(),
      }),
    )
    setShowInvoice(false)
    setInvoiceData(null)
    setSubmitError(null)
  }, [open, orderData, orderId])

  // dispatch wrapper. `useReducer` would be more conventional here but
  // the draft is reset wholesale on each open, so `useState` + a
  // functional setter is the simpler fit.
  const dispatch = (action: PaymentDraftAction) =>
    setDraft((current) => paymentDraftReducer(current, action))

  // ----- the rendered view (must come after all hooks) -----
  const view = useMemo(
    () => (orderData ? selectView(draft, allMethods) : null),
    [draft, allMethods, orderData],
  )

  // While loading the order, render a placeholder inside the dialog.
  if (loadingOrder || !orderData || !view) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cargando información de la orden...</DialogTitle>
          </DialogHeader>
          <div className="py-8 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const bill = computeBill(
    orderData.order_items.map((it) => ({ price: it.price, quantity: it.quantity })),
    orderData.tax_percentage,
    orderData.tip_percentage,
  )

  // Cash-drawer warning (advisory, not blocking). Only relevant when
  // there is cash change to give and the drawer can't cover it.
  const drawerWarning =
    view.totalChange > 0 && !hasEnoughCashForChange(view.totalChange)
  const drawerCurrent = getCurrentRegisterSummary()?.finalCash ?? 0

  // Confirm handler
  const handleConfirm = async () => {
    if (!view.canConfirm) return
    if (!isRegisterOpen()) {
      toast.error("Debes abrir la caja antes de procesar pagos")
      return
    }
    const registerId = currentRegister?.id ?? ""
    if (!registerId) {
      toast.error("La caja no está abierta")
      return
    }
    const tenders = buildPayOrderTenders(view)
    setSubmitError(null)
    dispatch({ type: "startSubmit" })

    try {
      const result: PayOrderResult = await payOrder({
        orderId,
        cashRegisterId: registerId,
        tip: draft.tip,
        tenders,
        idempotencyKey: draft.idempotencyKey,
      })
      dispatch({ type: "submitSucceeded", result })

      if (result.alreadyPaid) {
        toast.success("Esta orden ya estaba pagada. Mostrando factura.")
      } else {
        toast.success("Pago registrado correctamente")
      }

      if (result.drawerWarning) {
        toast.warning(
          "La caja no tenía efectivo suficiente para el cambio; registra el ingreso de efectivo",
        )
      }

      // Build the invoice for the print view. Detailed tender printing
      // is task 10; the label collapses to a single method name when
      // there is exactly one tender line, or "multiple" when there are
      // several.
      const invoiceNumber = `INV-${orderId.substring(0, 8)}`
      const items: CartItem[] = orderData.order_items.map((it) => ({
        id: it.id,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        comments: it.comments ?? undefined,
        categoryId: "",
        image: "",
      }))
      const cashLines = view.lines.filter((l) => l.kind === "cash")
      const cashReceived =
        cashLines.length > 0
          ? cashLines.reduce((sum, l) => sum + l.tendered, 0)
          : undefined
      const cashChange = view.totalChange > 0 ? view.totalChange : undefined
      // PrintableInvoice still uses the legacy "cash" | "multiple" enum;
      // for a single line we mark it cash, for several "multiple".
      const paymentMethod = view.lines.length > 1 ? "multiple" : "cash"

      const invoice: PrintableInvoice = {
        invoiceNumber,
        date: new Date(),
        businessInfo: {
          name: businessName,
          address: businessAddress,
          phone: businessPhone,
          nit: businessNIT,
        },
        items,
        bill: {
          subtotal: bill.subtotal,
          tax: bill.tax,
          taxPercentage: orderData.tax_percentage,
          tip: draft.tip,
          tipPercentage: orderData.tip_percentage,
          total: bill.amountDue + draft.tip,
          totalDiscounts: 0,
        },
        waiter: orderData.waiter_id ?? "—",
        table: orderData.table_id ?? "—",
        paymentMethod,
        multiplePayments: undefined, // detailed tenders come in task 10
        cashReceived,
        cashChange,
      }
      if (view.lines.length === 1) {
        log.info("Pago con método único:", { method: methodName(view.lines[0].methodId) })
      }
      setInvoiceData(invoice)
      setShowInvoice(true)
    } catch (err) {
      const msg = paymentErrorMessage(err)
      dispatch({ type: "submitFailed", error: msg })
      setSubmitError(msg)
      toast.error(msg)
    }
  }

  // After a successful submit, render the existing invoice print view
  // in place of the builder. Its own dialog handles close + print.
  if (showInvoice && invoiceData) {
    return (
      <InvoicePrintView
        invoice={invoiceData}
        open={showInvoice}
        onOpenChange={(isOpen) => {
          setShowInvoice(isOpen)
          if (!isOpen) {
            onSuccess()
            onOpenChange(false)
          }
        }}
        isPending={false}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Don't allow closing mid-submit; force the user to wait for
        // either success or failure.
        if (draft.submitting && !isOpen) return
        onOpenChange(isOpen)
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar orden</DialogTitle>
          <DialogDescription>
            Selecciona uno o varios métodos de pago. La propina y el cambio se calculan en vivo.
          </DialogDescription>
        </DialogHeader>

        {/* Bill summary */}
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(bill.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Impuestos</span>
            <span>{formatCurrency(bill.tax)}</span>
          </div>
          <div className="flex justify-between">
            <span>Propina</span>
            <span>{formatCurrency(draft.tip)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>Total a cobrar</span>
            <span>{formatCurrency(view.totalToCharge)}</span>
          </div>
        </div>

        {/* Method picker + amount input */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Método de pago</Label>
            {loadingMethods ? (
              <p className="text-sm text-muted-foreground">Cargando métodos…</p>
            ) : activeMethods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay métodos de pago activos. Crea uno en el panel de administración.
              </p>
            ) : (
              <MethodPicker
                methods={activeMethods}
                selectedMethodId={draft.selectedMethodId}
                quickFillAmount={view.quickFillSuggestion}
                onSelectMethod={(methodId) => dispatch({ type: "selectMethod", methodId })}
                onQuickFill={(amount) =>
                  dispatch({ type: "setAmountInput", value: amount.toString() })
                }
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tender-amount">Monto</Label>
            <div className="h-10 flex items-center justify-end rounded-md border bg-muted/20 px-3 font-mono text-lg">
              {draft.amountInput ? formatCurrency(Number(draft.amountInput)) : "$ 0"}
            </div>
            <NumericKeypad
              value={draft.amountInput}
              onValueChange={(value) => dispatch({ type: "setAmountInput", value })}
              allowDecimal={false}
            />
            <Button
              type="button"
              className="w-full"
              onClick={() => dispatch({ type: "addLine" })}
              disabled={
                draft.submitting ||
                draft.selectedMethodId === null ||
                draft.amountInput === "" ||
                Number(draft.amountInput) <= 0
              }
            >
              Agregar línea
            </Button>
          </div>
        </div>

        {/* Tender lines so far */}
        <div className="space-y-2">
          <Label>Líneas de pago</Label>
          <TenderLinesList
            lines={view.lines}
            methodName={methodName}
            onRemove={(lineIndex) => dispatch({ type: "removeLine", lineIndex })}
            disabled={draft.submitting}
          />
        </div>

        {/* Tip control */}
        <TipControl
          tip={draft.tip}
          suggestedTip={draft.suggestedTip}
          showSurplusAsTip={view.showSurplusAsTip}
          surplusTipPreview={computeSurplusAsTip(draft, allMethods)}
          submitting={draft.submitting}
          onSetNone={() => dispatch({ type: "setTipNone" })}
          onSetSuggested={() => dispatch({ type: "setTipSuggested" })}
          onSetCustom={(amount) => dispatch({ type: "setTipCustom", amount })}
          onApplySurplus={() => {
            const newTip = computeSurplusAsTip(draft, allMethods)
            dispatch({ type: "setTipCustom", amount: newTip })
          }}
        />

        {/* Live totals */}
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span>Aplicado</span>
            <span>{formatCurrency(view.applied)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Restante</span>
            <span className={view.remaining > 0 ? "text-amber-600" : "text-green-600"}>
              {formatCurrency(view.remaining)}
            </span>
          </div>
          {view.totalChange > 0 && (
            <div className="flex justify-between">
              <span>Cambio (efectivo)</span>
              <span>{formatCurrency(view.totalChange)}</span>
            </div>
          )}
        </div>

        {/* State-level issues (inactive / unknown / overpay) */}
        {view.issues.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <ul className="list-disc pl-4 space-y-1">
              {view.issues.map((iss, i) => (
                <li key={i}>{iss.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Cash-drawer advisory warning (does NOT block submit anymore) */}
        {drawerWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <p>
              La caja no tiene suficiente efectivo para dar el cambio ({formatCurrency(view.totalChange)}).
              Tienes {formatCurrency(drawerCurrent)}. El pago se registrará de todas formas;
              registra luego un ingreso de efectivo a la caja.
            </p>
          </div>
        )}

        {/* No open register -> block */}
        {!isRegisterOpen() && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
            La caja debe estar abierta para procesar pagos. Abre la caja desde la pantalla
            de caja e inténtalo de nuevo.
          </div>
        )}

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={draft.submitting}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!view.canConfirm || !isRegisterOpen()}
          >
            <Check className="mr-2 h-4 w-4" />
            {draft.submitting ? "Procesando..." : "Cobrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
