"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Bike, CreditCard } from "lucide-react"
import { Chip, Money } from "@/components/cashier/cashier-ui"
import { Button } from "@/components/ui/button"
import { PaymentMethodDialog } from "@/components/cashier/PaymentMethodDialog"
import { useActiveDeliveries, refreshActiveDeliveries } from "@/hooks/use-active-deliveries"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { pendingDeliveryPayments } from "@/lib/delivery/kitchen"
import { statusLabel } from "@/lib/delivery/state-machine"
import { deliveryTotal } from "@/lib/delivery/fee"
import { formatCurrency } from "@/utils/helpers"
import { toast } from "@/utils/toast"

interface DeliveryPaymentsPanelProps {
  /** Called after a successful payment so the cashier reloads its orders. */
  onPaid?: () => void
}

/**
 * Delivery orders still owing money (not paid, not cancelled). "Cobrar"
 * opens the same payment dialog the delivery board uses, with the
 * delivery fee in the amount due; cash on delivery is settled here when
 * the courier returns.
 */
export function DeliveryPaymentsPanel({ onPaid }: DeliveryPaymentsPanelProps) {
  const queryClient = useQueryClient()
  const { data: deliveries = [], error } = useActiveDeliveries()
  const { isRegisterOpen, loadOpenRegister } = useCashRegisterStore()
  const [payingId, setPayingId] = useState<string | null>(null)
  const checking = useRef(false)

  // The register may have been opened after the app loaded. This panel only
  // asks whether one is open, so it runs the ONE-request check (T10/S1)
  // instead of the full register load the board used to run here as well.
  useEffect(() => {
    void loadOpenRegister()
  }, [loadOpenRegister])

  const pending = useMemo(() => pendingDeliveryPayments(deliveries), [deliveries])
  // The dialog reads the latest row so a realtime payment closes it.
  const payingRow = payingId ? pending.find((r) => r.delivery.orderId === payingId) ?? null : null

  const openPayment = async (orderId: string) => {
    if (checking.current) return
    checking.current = true
    try {
      await loadOpenRegister()
      if (!isRegisterOpen()) {
        toast.error("Debe abrir la caja antes de procesar pagos")
        return
      }
      setPayingId(orderId)
    } finally {
      checking.current = false
    }
  }

  // A failed refetch keeps the last data, so the list and an open payment
  // dialog stay mounted; the error is only a note.
  const errorNote = error ? (
    <p className="mb-3 text-sm text-status-danger-fg">No se pudieron cargar los domicilios por cobrar.</p>
  ) : null
  if (pending.length === 0) return errorNote ? <div>{errorNote}</div> : null

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <Bike aria-hidden="true" className="h-4 w-4" />
        Domicilios por cobrar
      </h3>
      {errorNote}
      <ul className="space-y-2">
        {pending.map(({ delivery, subtotal, tax }) => (
          <li key={delivery.orderId} className="rounded-card border border-line bg-surface p-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-status-reserved-line bg-status-reserved-bg text-base font-bold text-status-reserved-fg"
              >
                D
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-bold tracking-wide text-muted-fg">DOMICILIO</span>
                <p className="truncate font-semibold text-fg" title={delivery.customerName}>
                  {delivery.customerName}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Chip tone="served">{statusLabel(delivery.status)}</Chip>
                  <Chip tone="reserved">{delivery.paymentMode === "prepaid" ? "Anticipado" : "Contra entrega"}</Chip>
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-between gap-2 text-sm text-muted-fg">
              <span>Domicilio</span>
              <Money>{formatCurrency(delivery.deliveryFee)}</Money>
            </div>
            <div className="flex justify-between gap-2 font-bold text-fg">
              <span>Total:</span>
              <Money>{formatCurrency(deliveryTotal(subtotal, tax, delivery.deliveryFee))}</Money>
            </div>
            <Button
              className="mt-2 h-11 w-full bg-brand text-brand-contrast hover:bg-brand-strong"
              onClick={() => void openPayment(delivery.orderId)}
            >
              <CreditCard aria-hidden="true" className="h-4 w-4" />
              Cobrar
            </Button>
          </li>
        ))}
      </ul>

      {payingRow && (
        <PaymentMethodDialog
          open
          onOpenChange={(open) => {
            if (!open) setPayingId(null)
          }}
          orderId={payingRow.delivery.orderId}
          tableId={null}
          deliveryFee={payingRow.delivery.deliveryFee}
          delivery={payingRow.delivery}
          onSuccess={() => {
            setPayingId(null)
            refreshActiveDeliveries(queryClient)
            onPaid?.()
          }}
        />
      )}
    </div>
  )
}
