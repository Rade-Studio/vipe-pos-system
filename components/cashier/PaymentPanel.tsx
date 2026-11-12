"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Check, Undo2, WifiOff, Wallet } from "lucide-react"
import { BillChangedBanner } from "./BillChangedBanner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useConfigStore } from "@/store/use-config-store"
import { formatCurrency } from "@/utils/helpers"
import { toast } from "@/utils/toast"
import { cn } from "@/lib/utils"
import type { PrintableInvoice } from "@/types"
import type { DeliveryOrder } from "@/lib/delivery/types"
import { buildDeliveryPrintInfo } from "@/lib/delivery/print"
import { listPaymentMethods, payOrder } from "@/lib/api/payments"
import { PaymentServiceError } from "@/lib/payments/types"
import type { PayOrderResult, PaymentMethodOption, PaymentServiceErrorKind } from "@/lib/payments/types"
import { serverBill } from "@/lib/payments/bill"
import { buildPayOrderTenders, zeroTotalTenders } from "@/lib/payments/tenders"
import { invoiceTendersFromPayOrder, legacyInvoiceFields } from "@/lib/payments/invoice-tenders"
import { newIdempotencyKey } from "@/lib/payments/idempotency"
import { computeSurplusAsTip, initialPaymentDraft, paymentDraftReducer, selectView } from "@/lib/payments/draft"
import type { PaymentDraftAction, PaymentDraftState } from "@/lib/payments/draft"
import { getById, toOrder } from "@/lib/api/orders"
import { invoiceDiscounts, type PaymentOrderSource } from "@/lib/payments/invoice-discounts"
import { log } from "@/lib/log"
import { useRegisterSummary } from "@/hooks/use-register-summary"
import { canGiveChange, registerSummaryQueryKey } from "@/lib/payments/register-summary"
import { registerPaymentsQueryKey } from "@/hooks/use-register-payments"
import { queryClient } from "@/lib/queryClient"
import { billSignature, billSourceFromOrder, hasBillableItems, type CashierBillSource } from "@/lib/cashier/orders"
import { quickCashAmounts } from "@/lib/cashier/quick-cash"
import { useOnlineStatus } from "@/lib/cashier/use-online-status"
import { PAY_UNDO_MS, countdownLabel, keepPendingDraft, takePendingDraft } from "@/lib/cashier/pay-undo"
import { REFERENCE_MAX_LENGTH } from "@/lib/payments/draft"
import { MethodPicker } from "./payment/MethodPicker"
import { TenderLinesList } from "./payment/TenderLinesList"
import { TipControl, optionClass } from "./payment/TipControl"
import { Eyebrow, Money } from "./cashier-ui"

export interface PaymentPanelTotals {
  remaining: number
  totalToCharge: number
  change: number
}

export interface PaymentPanelProps {
  orderId: string
  /**
   * The order the caller already holds, in the `orders` row shape. When it
   * carries its items the panel bills straight from it and NEVER reads the
   * order again; when it is missing or itemless (the delivery panel, or a
   * realtime stub) it falls back to `getById`.
   */
  order?: PaymentOrderSource | null
  /**
   * Delivery fee (whole pesos) of a delivery order, default 0. pay_order
   * charges subtotal + tax + delivery_fee, so the panel adds it to the amount
   * due; the tip stays on the food subtotal.
   */
  deliveryFee?: number
  /** The order's delivery snapshot; when set, the invoice prints the delivery block. */
  delivery?: DeliveryOrder | null
  /** False while the dialog that hosts the panel is closed (no catalog read, no seed). */
  active?: boolean
  /** `inline`: the cashier's always-visible column. `dialog`: inside `PaymentMethodDialog`. */
  layout: "inline" | "dialog"
  /** Line above the title, e.g. "Cobrar · Mesa 12". */
  eyebrow?: string
  /** Element for the panel title (the dialog passes its `DialogTitle`). */
  Title?: React.ElementType
  /** Description under the title (the dialog passes its `DialogDescription`). */
  Description?: React.ElementType
  onCancel: () => void
  /** The payment was registered: the caller shows the invoice and closes. */
  onPaid: (invoice: PrintableInvoice) => void
  onSubmittingChange?: (submitting: boolean) => void
  onTotalsChange?: (totals: PaymentPanelTotals) => void
  /** The order's waiter: the tip is named for them ("Propina para Ana"). */
  waiterName?: string
  /**
   * T24: "Registrar" opens a 10 s window with "Deshacer" / "Cerrar ahora"; the
   * pay request goes out only when it ends. The cashier's inline panel uses
   * it; the delivery dialog keeps sending at once.
   */
  undoWindow?: boolean
  /** pay_order answered with another total: the caller re-reads the order. */
  onBillStale?: () => void
  /**
   * The "Precio cambió" notice (null = none). When set, the caller shows the
   * banner (the cashier puts it over the detail pane) and the panel does not.
   */
  onBillNotice?: (notice: string | null) => void
}

/** pay_order's total mismatch (the bill changed on the server since it was read). */
const TOTAL_MISMATCH = /tenders sum to (\d+) but amount_due \+ tip = (\d+)/

export type { PaymentOrderSource }

interface OrderForBill extends PaymentOrderSource {
  order_items: CashierBillSource["order_items"]
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

export const OFFLINE_PAYMENT_REASON = "Sin conexión: el pago se habilita al reconectar."

/**
 * The payment builder: tender lines, tip, change and the pay_order call. It
 * renders inline in the cashier's right column and inside
 * `PaymentMethodDialog` for the delivery board; both share every rule here.
 */
export function PaymentPanel({
  orderId,
  order = null,
  deliveryFee = 0,
  delivery = null,
  active = true,
  layout,
  eyebrow,
  Title = "h2",
  Description = "p",
  onCancel,
  onPaid,
  onSubmittingChange,
  onTotalsChange,
  waiterName,
  undoWindow = false,
  onBillStale,
  onBillNotice,
}: PaymentPanelProps) {
  const [draft, setDraft] = useState<PaymentDraftState>(() =>
    initialPaymentDraft({ amountDue: 0, suggestedTip: 0, idempotencyKey: uuid() }),
  )
  // Seeded from the order the caller passed, so opening the panel with one
  // already loaded never shows the "Cargando información de la orden" flash.
  // The loaded order is keyed by the id it belongs to, so a copy left over
  // from a previous order is never billed for the order now open.
  const [loadedOrder, setLoadedOrder] = useState<{ orderId: string; data: OrderForBill } | null>(() =>
    hasBillableItems(order) ? { orderId, data: order! } : null,
  )
  const orderData = loadedOrder?.orderId === orderId ? loadedOrder.data : null
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [billChangedNotice, setBillChangedNotice] = useState<string | null>(null)
  // T24 undo window: when it ends the payment is sent; null = no window open.
  const [pendingUntil, setPendingUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const pendingRef = useRef(false)
  const online = useOnlineStatus()

  const { isRegisterOpen, currentRegister } = useCashRegisterStore()
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()

  // El chequeo de cambio y el aviso de "caja no alcanza" se hacen contra el
  // resumen del servidor (`expected_cash`), no contra la suma local de
  // transacciones. Misma fuente que la pantalla de estado de caja.
  const summaryIds = useMemo(() => (currentRegister ? [currentRegister.id] : []), [currentRegister])
  const { data: drawerSummary } = useRegisterSummary(summaryIds)

  // Active catalog (filtered + ordered). The full list still comes from the
  // service so `selectView` can flag inactive / unknown ids.
  const { data: allMethods = [], isLoading: loadingMethods } = useQuery<PaymentMethodOption[]>({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
    enabled: active,
    staleTime: 60_000,
  })
  const activeMethods = useMemo(
    () => allMethods.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [allMethods],
  )
  const methodById = useMemo(() => new Map(allMethods.map((m) => [m.id, m] as const)), [allMethods])
  const methodName = (id: string) => methodById.get(id)?.name ?? "Método"

  // Load the order for the open cycle (active + orderId). When the caller
  // already holds it, that copy is used as-is and NO request is issued (S1).
  // The prop is read through a ref: adopting the fresh object the parent
  // re-creates on every render would re-seed the draft and loop. Only a
  // change of its bill (split, refresh, realtime) adopts it again.
  const orderRef = useRef(order)
  useEffect(() => {
    orderRef.current = order
  }, [order])
  const orderSignature = billSignature(order)

  useEffect(() => {
    if (!active || !orderId) return
    let cancelled = false

    const known = orderRef.current
    if (hasBillableItems(known)) {
      setLoadedOrder({ orderId, data: known! })
      setLoadingOrder(false)
      return
    }

    setLoadingOrder(true)
    ;(async () => {
      try {
        const dto = await getById(orderId)
        const fetched: PaymentOrderSource = {
          ...billSourceFromOrder(toOrder(dto)),
          discounts: dto.discounts,
          gross_subtotal: dto.grossSubtotal,
        }
        if (cancelled) return
        setLoadedOrder({ orderId, data: fetched as OrderForBill })
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
  }, [active, orderId, orderSignature])

  // Re-seed the draft once per open cycle + order + bill. A cache patch that
  // leaves the bill as it was (status change, same refetch) keeps the amounts
  // entered; a changed bill re-seeds, so tenders computed for an old total are
  // never sent. Lines already added are dropped and the notice says so. Each
  // seed generates a fresh idempotency key (one attempt); it is kept across
  // `submitFailed` so a retry of the same bill uses the same key.
  const seededForRef = useRef<{ orderId: string; signature: string; amountDue: number } | null>(null)
  useEffect(() => {
    if (!active) {
      seededForRef.current = null
      return
    }
    if (!orderData || draft.submitting) return
    const signature = `${billSignature(orderData)}|${deliveryFee}`
    const previous = seededForRef.current
    if (previous?.orderId === orderId && previous.signature === signature) return
    // S13: the server's net subtotal and tax; the line prices are list prices.
    const bill = serverBill(orderData, orderData.tip_percentage)
    const amountDue = bill.amountDue + deliveryFee
    seededForRef.current = { orderId, signature, amountDue }
    // A bill change closes an open undo window: the old amount is never sent.
    pendingRef.current = false
    setPendingUntil(null)
    const rebill = previous?.orderId === orderId
    // The cashier left this order during an undo window: same bill, same tenders.
    const kept = rebill ? null : takePendingDraft<PaymentDraftState>(orderId, signature)
    if (kept) {
      setBillChangedNotice(null)
      setDraft(kept)
      setSubmitError(null)
      return
    }
    setBillChangedNotice(
      rebill && draft.tenders.length > 0
        ? `La cuenta sin propina cambió de ${formatCurrency(previous.amountDue)} a ${formatCurrency(amountDue)}; vuelve a registrar los pagos`
        : null,
    )
    setDraft(
      initialPaymentDraft({
        amountDue: bill.amountDue,
        suggestedTip: bill.suggestedTip,
        deliveryFee,
        idempotencyKey: uuid(),
      }),
    )
    setSubmitError(null)
  }, [active, orderData, orderId, deliveryFee, draft.submitting, draft.tenders.length])

  useEffect(() => {
    onBillNotice?.(billChangedNotice)
  }, [billChangedNotice, onBillNotice])

  const dispatch = (action: PaymentDraftAction) => setDraft((current) => paymentDraftReducer(current, action))

  // Leaving the screen or switching order during the window sends nothing and
  // keeps the draft (with a fresh key: the next attempt is a new one).
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(
    () => () => {
      const seeded = seededForRef.current
      if (!pendingRef.current || !seeded) return
      pendingRef.current = false
      keepPendingDraft(seeded.orderId, seeded.signature, {
        ...paymentDraftReducer(draftRef.current, { type: "newAttempt", idempotencyKey: uuid() }),
      })
    },
    [],
  )

  const view = useMemo(() => (orderData ? selectView(draft, allMethods) : null), [draft, allMethods, orderData])

  useEffect(() => {
    onSubmittingChange?.(draft.submitting)
  }, [draft.submitting, onSubmittingChange])

  const remaining = view?.remaining
  const totalToCharge = view?.totalToCharge
  const change = view?.totalChange
  useEffect(() => {
    if (remaining === undefined || totalToCharge === undefined || change === undefined) return
    onTotalsChange?.({ remaining, totalToCharge, change })
  }, [remaining, totalToCharge, change, onTotalsChange])

  // The window's countdown and its end. The confirm handler is read through a
  // ref: it is redefined on every render.
  const confirmRef = useRef<() => Promise<void>>(async () => {})
  const sendPending = useCallback(() => {
    if (!pendingRef.current) return
    pendingRef.current = false
    setPendingUntil(null)
    void confirmRef.current()
  }, [])
  useEffect(() => {
    if (pendingUntil === null) return
    const tick = setInterval(() => setNow(Date.now()), 250)
    const end = setTimeout(sendPending, Math.max(0, pendingUntil - Date.now()))
    return () => {
      clearInterval(tick)
      clearTimeout(end)
    }
  }, [pendingUntil, sendPending])

  const header = (title: string, description?: string) => (
    <div className="min-w-0">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Title className="text-lg font-bold text-fg">{title}</Title>
      {description && <Description className="text-sm text-muted-fg">{description}</Description>}
    </div>
  )

  if (loadingOrder || !orderData || !view) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {header("Cargando información de la orden...")}
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 rounded-full border-b-2 border-brand motion-safe:animate-spin" />
        </div>
      </div>
    )
  }

  const bill = serverBill(orderData, orderData.tip_percentage)
  const totalDiscounts = orderData.total_discounts ?? 0
  // S13: a fully discounted order (nothing due, no tip) closes with one cash tender of 0.
  // Decided from the server bill, never from a draft that may not be seeded for it yet.
  const zeroTotal = bill.amountDue + deliveryFee === 0 && draft.amountDue === 0 && draft.tip === 0
  const zeroTenders = zeroTotal ? zeroTotalTenders(activeMethods) : []
  const canRegister = zeroTotal ? zeroTenders.length > 0 && !draft.submitting && !draft.lastError : view.canConfirm
  const issues = zeroTotal ? view.issues.filter((issue) => issue.code !== "nothing-to-charge") : view.issues

  const drawerCurrent = drawerSummary?.expectedCash ?? 0
  const drawerWarning =
    drawerSummary != null ? view.totalChange > 0 && !canGiveChange(drawerSummary, view.totalChange) : false

  const registerOpen = isRegisterOpen()
  const selectedMethod = draft.selectedMethodId ? methodById.get(draft.selectedMethodId) : undefined
  const quickAmounts = selectedMethod?.kind === "cash" ? quickCashAmounts(view.remaining) : []
  const progress = view.totalToCharge > 0 ? Math.min(100, Math.round((view.applied / view.totalToCharge) * 100)) : 0

  const handleConfirm = async () => {
    if (!canRegister) return
    if (!online) return
    if (!isRegisterOpen()) {
      toast.error("Debes abrir la caja antes de procesar pagos")
      return
    }
    const registerId = currentRegister?.id ?? ""
    if (!registerId) {
      toast.error("La caja no está abierta")
      return
    }
    const tenders = zeroTotal ? zeroTenders : buildPayOrderTenders(view)
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

      // El nuevo pago cambió las ventas, las propinas, el cambio y el
      // efectivo esperado de la caja: el resumen se vuelve a leer.
      queryClient.invalidateQueries({ queryKey: registerSummaryQueryKey(summaryIds) })
      queryClient.invalidateQueries({ queryKey: registerPaymentsQueryKey(summaryIds) })
      queryClient.invalidateQueries({ queryKey: ["register-paid-orders"] })

      if (result.alreadyPaid) {
        toast.success("Esta orden ya estaba pagada. Mostrando factura.")
      } else {
        toast.success("Pago registrado correctamente")
      }

      if (result.drawerWarning) {
        toast.warning("La caja no tenía efectivo suficiente para el cambio; registra el ingreso de efectivo")
      }

      // The invoice tenders come from the server's `payOrder` echo (resolved
      // through the catalog by `code`), not from the client view, so they match
      // the ledger. The legacy single-label fields keep the old Python listener
      // printing a correct single-line ticket.
      const discounts = invoiceDiscounts(orderData)
      const items: PrintableInvoice["items"] = orderData.order_items.map((it) => {
        const lineDiscounts = discounts?.byItem(it.id) ?? []
        return {
          id: it.id,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          comments: it.comments ?? undefined,
          ...(it.modifiers?.length ? { modifiers: it.modifiers } : {}),
          categoryId: "",
          image: "",
          ...(lineDiscounts.length ? { discounts: lineDiscounts } : {}),
        }
      })
      const invoiceTenders = invoiceTendersFromPayOrder(result, allMethods)
      const legacy = legacyInvoiceFields(invoiceTenders)

      const invoice: PrintableInvoice = {
        invoiceNumber: `INV-${orderId.substring(0, 8)}`,
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
          // draft.amountDue already includes the delivery fee (0 for table orders).
          total: draft.amountDue + draft.tip,
          totalDiscounts,
          ...(discounts ? { grossSubtotal: discounts.grossSubtotal } : {}),
        },
        ...(discounts?.bill.length ? { discounts: discounts.bill } : {}),
        waiter: orderData.waiter_id ?? "—",
        table: orderData.table_id ?? "—",
        paymentMethod: legacy.paymentMethod as PrintableInvoice["paymentMethod"],
        multiplePayments: undefined,
        cashReceived: legacy.cashReceived ?? undefined,
        cashChange: legacy.cashChange > 0 ? legacy.cashChange : undefined,
        tenders: invoiceTenders,
        change: legacy.cashChange,
        ...(delivery ? { delivery: buildDeliveryPrintInfo(delivery) } : {}),
      }
      if (invoiceTenders.length === 1) {
        log.info("Pago con método único:", { method: invoiceTenders[0]!.methodName })
      }
      onPaid(invoice)
    } catch (err) {
      const msg = paymentErrorMessage(err)
      dispatch({ type: "submitFailed", error: msg })
      setSubmitError(msg)
      toast.error(msg)
      const mismatch = err instanceof PaymentServiceError ? TOTAL_MISMATCH.exec(err.message) : null
      if (mismatch) {
        setBillChangedNotice(
          `El total a cobrar (con propina) cambió de ${formatCurrency(Number(mismatch[1]))} a ${formatCurrency(Number(mismatch[2]))}; la orden se vuelve a leer, revisa los pagos`,
        )
        onBillStale?.()
      }
    }
  }
  confirmRef.current = handleConfirm

  const pending = pendingUntil !== null
  const busy = draft.submitting || pending

  const handleRegister = () => {
    if (!undoWindow) {
      void handleConfirm()
      return
    }
    if (pendingRef.current || !canRegister || !online) return
    if (!isRegisterOpen()) {
      toast.error("Debes abrir la caja antes de procesar pagos")
      return
    }
    pendingRef.current = true
    const until = Date.now() + PAY_UNDO_MS
    setNow(Date.now())
    setPendingUntil(until)
  }

  const handleUndo = () => {
    if (!pendingRef.current) return
    pendingRef.current = false
    setPendingUntil(null)
    dispatch({ type: "newAttempt", idempotencyKey: uuid() })
  }

  const amountLabel = selectedMethod?.kind === "cash" ? "Recibido en efectivo" : "Monto"
  const blockedReason = !registerOpen
    ? "La caja debe estar abierta para procesar pagos. Abre la caja desde la pantalla de caja e inténtalo de nuevo."
    : !online
      ? OFFLINE_PAYMENT_REASON
      : null

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-5 p-4">
        <div className="space-y-2">
          {header(
            "Cobrar orden",
            layout === "dialog" ? "Selecciona uno o varios métodos de pago. La propina y el cambio se calculan en vivo." : undefined,
          )}
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-fg">Restante</div>
            <Money
              className={cn(
                "block text-3xl font-bold leading-tight",
                view.remaining > 0 ? "text-fg" : "text-status-ok-fg",
              )}
            >
              <span data-testid="payment-remaining" aria-live="polite">
                {formatCurrency(view.remaining)}
              </span>
            </Money>
            <div className="text-sm text-muted-fg">
              Aplicado <Money>{formatCurrency(view.applied)}</Money> de{" "}
              <Money>{formatCurrency(view.totalToCharge)}</Money>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-pill bg-line" aria-hidden="true">
              <div
                className="h-full rounded-pill bg-brand transition-[width] motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {layout === "dialog" && (
          <div className="space-y-1 rounded-card border border-line p-3 text-sm">
            {totalDiscounts > 0 && (
              <>
                <div className="flex justify-between gap-2">
                  <span>Subtotal (precio de lista)</span>
                  <Money>{formatCurrency(bill.subtotal + totalDiscounts)}</Money>
                </div>
                <div className="flex justify-between gap-2 text-status-ok-fg">
                  <span>Descuentos</span>
                  <Money>−{formatCurrency(totalDiscounts)}</Money>
                </div>
              </>
            )}
            <div className="flex justify-between gap-2">
              <span>{totalDiscounts > 0 ? "Base" : "Subtotal"}</span>
              <Money>{formatCurrency(bill.subtotal)}</Money>
            </div>
            <div className="flex justify-between gap-2">
              <span>Impuestos</span>
              <Money>{formatCurrency(bill.tax)}</Money>
            </div>
            {deliveryFee > 0 && (
              <div className="flex justify-between gap-2">
                <span>Domicilio</span>
                <Money>{formatCurrency(deliveryFee)}</Money>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span>Propina</span>
              <Money>{formatCurrency(draft.tip)}</Money>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-1 font-semibold">
              <span>Total a cobrar</span>
              <Money>{formatCurrency(view.totalToCharge)}</Money>
            </div>
          </div>
        )}

        {billChangedNotice && !onBillNotice && (
          <BillChangedBanner notice={billChangedNotice} onDismiss={() => setBillChangedNotice(null)} />
        )}

        <section className="space-y-2" aria-labelledby="applied-heading">
          <h3 id="applied-heading" className="text-sm font-semibold text-fg">
            Pagos aplicados
          </h3>
          <TenderLinesList
            lines={view.lines}
            methodName={methodName}
            onRemove={(lineIndex) => dispatch({ type: "removeLine", lineIndex })}
            disabled={busy}
          />
        </section>

        <section className="space-y-3" aria-labelledby="add-heading">
          <h3 id="add-heading" className="text-sm font-semibold text-fg">
            Agregar pago
          </h3>
          {loadingMethods ? (
            <p className="text-sm text-muted-fg">Cargando métodos…</p>
          ) : activeMethods.length === 0 ? (
            <p className="text-sm text-muted-fg">
              No hay métodos de pago activos. Crea uno en el panel de administración.
            </p>
          ) : (
            <MethodPicker
              methods={activeMethods}
              selectedMethodId={draft.selectedMethodId}
              onSelectMethod={(methodId) => dispatch({ type: "selectMethod", methodId })}
              disabled={busy}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor={`tender-amount-${layout}`}>{amountLabel}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`tender-amount-${layout}`}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={draft.amountInput}
                onChange={(e) => dispatch({ type: "setAmountInput", value: e.target.value.replace(/[^\d]/g, "") })}
                disabled={busy}
                className="h-11 min-w-[8rem] flex-1 text-right text-lg tabular-nums"
              />
              {draft.selectedMethodId !== null && view.quickFillSuggestion > 0 && (
                <button
                  type="button"
                  className={optionClass(false)}
                  onClick={() => dispatch({ type: "setAmountInput", value: view.quickFillSuggestion.toString() })}
                  title="Usar el restante"
                >
                  <Wallet aria-hidden="true" className="h-4 w-4" />
                  Usar restante (<Money>{formatCurrency(view.quickFillSuggestion)}</Money>)
                </button>
              )}
            </div>
            {quickAmounts.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Billetes rápidos">
                {quickAmounts.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={optionClass(draft.amountInput === value.toString())}
                    aria-pressed={draft.amountInput === value.toString()}
                    onClick={() => dispatch({ type: "setAmountInput", value: value.toString() })}
                  >
                    <Money>{formatCurrency(value)}</Money>
                  </button>
                ))}
              </div>
            )}
            {selectedMethod && selectedMethod.kind !== "cash" && (
              <div className="space-y-1">
                <Label htmlFor={`tender-reference-${layout}`}>Referencia / últimos 4</Label>
                <Input
                  id={`tender-reference-${layout}`}
                  autoComplete="off"
                  placeholder="Opcional · aprobación, últimos 4 o ref. de la transferencia"
                  maxLength={REFERENCE_MAX_LENGTH}
                  value={draft.referenceInput}
                  onChange={(e) => dispatch({ type: "setReferenceInput", value: e.target.value })}
                  disabled={busy}
                  className="h-11"
                />
              </div>
            )}
            {layout === "dialog" && (
              <NumericKeypad
                value={draft.amountInput}
                onValueChange={(value) => dispatch({ type: "setAmountInput", value })}
                allowDecimal={false}
              />
            )}
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => dispatch({ type: "addLine", methodKind: selectedMethod?.kind })}
              disabled={
                busy ||
                draft.selectedMethodId === null ||
                draft.amountInput === "" ||
                Number(draft.amountInput) <= 0
              }
            >
              Agregar línea
            </Button>
          </div>
        </section>

        <TipControl
          tip={draft.tip}
          suggestedTip={draft.suggestedTip}
          showSurplusAsTip={view.showSurplusAsTip}
          surplusTipPreview={computeSurplusAsTip(draft, allMethods)}
          submitting={busy}
          waiterName={waiterName}
          onSetNone={() => dispatch({ type: "setTipNone" })}
          onSetSuggested={() => dispatch({ type: "setTipSuggested" })}
          onSetCustom={(amount) => dispatch({ type: "setTipCustom", amount })}
          onApplySurplus={() => {
            const newTip = computeSurplusAsTip(draft, allMethods)
            dispatch({ type: "setTipCustom", amount: newTip })
          }}
        />

        {zeroTotal && (
          <p role="status" className="rounded-card border border-status-ok-line bg-status-ok-bg p-3 text-sm text-status-ok-fg">
            {zeroTenders.length > 0
              ? "La cuenta quedó en $0: se cierra sin cobro."
              : "La cuenta quedó en $0. Activa un método de efectivo para cerrarla."}
          </p>
        )}

        {issues.length > 0 && (
          <div className="rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <ul className="list-disc space-y-1 pl-4">
              {issues.map((iss, i) => (
                <li key={i}>{iss.message}</li>
              ))}
            </ul>
          </div>
        )}

        {drawerWarning && (
          <div className="flex items-start gap-2 rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <p>
              La caja no tiene suficiente efectivo para dar el cambio ({formatCurrency(view.totalChange)}). Tienes{" "}
              {formatCurrency(drawerCurrent)}. El pago se registrará de todas formas; registra luego un ingreso de
              efectivo a la caja.
            </p>
          </div>
        )}

        {submitError && (
          <p
            role="alert"
            className="rounded-card border border-status-danger-line bg-status-danger-bg p-3 text-sm text-status-danger-fg"
          >
            {submitError}
          </p>
        )}
      </div>

      <div
        className={cn(
          "space-y-2 border-t border-line p-4 [background:linear-gradient(var(--surface),var(--surface)),var(--canvas)]",
          layout === "inline" && "sticky bottom-0 z-[1] mt-auto",
        )}
      >
        {view.totalChange > 0 && (
          <div className="flex items-center justify-between gap-2 text-sm font-semibold text-status-ok-fg">
            <span>Cambio a entregar</span>
            <Money className="text-base">{formatCurrency(view.totalChange)}</Money>
          </div>
        )}
        {blockedReason && (
          <p className="flex items-start gap-2 text-sm text-status-danger-fg">
            {!online && registerOpen && <WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{blockedReason}</span>
          </p>
        )}
        {pending ? (
          <div
            role="status"
            aria-label="Cobro pendiente"
            className="space-y-2 rounded-card border border-brand bg-brand-tint p-3 text-sm text-fg"
          >
            <p>
              <b>
                Registrando <Money>{formatCurrency(view.totalToCharge)}</Money>
              </b>{" "}
              <span className="text-muted-fg">
                · se envía en <Money>{countdownLabel((pendingUntil ?? now) - now)}</Money>
              </span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-12 flex-1 bg-surface" onClick={handleUndo}>
                <Undo2 aria-hidden="true" className="h-4 w-4" />
                Deshacer
              </Button>
              <Button
                type="button"
                className="h-12 flex-1 bg-brand text-brand-contrast hover:bg-brand-strong"
                onClick={sendPending}
              >
                Cerrar ahora
              </Button>
            </div>
          </div>
        ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            type="button"
            className="h-12"
            onClick={onCancel}
            disabled={draft.submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-12 min-w-0 flex-1 bg-brand text-brand-contrast hover:bg-brand-strong"
            onClick={handleRegister}
            disabled={!canRegister || !registerOpen || !online}
          >
            <Check aria-hidden="true" className="h-4 w-4" />
            {draft.submitting ? (
              "Procesando..."
            ) : (
              <span className="truncate">
                Registrar <Money>{formatCurrency(view.totalToCharge)}</Money>
                {" "}<span className="max-[1179px]:sr-only">y cerrar</span>
              </span>
            )}
          </Button>
        </div>
        )}
        {undoWindow && !pending && !draft.submitting && (
          <p className="text-center text-xs text-muted-fg">Podrás deshacerlo durante 10 s</p>
        )}
      </div>
    </div>
  )
}
