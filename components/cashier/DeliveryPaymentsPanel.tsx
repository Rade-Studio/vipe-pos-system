"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Bike, CreditCard } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
    <p className="mb-3 text-sm text-destructive">No se pudieron cargar los domicilios por cobrar.</p>
  ) : null
  if (pending.length === 0) return errorNote ? <div className="mb-6">{errorNote}</div> : null

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Bike className="h-5 w-5" />
        Domicilios por cobrar
      </h3>
      {errorNote}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {pending.map(({ delivery, subtotal, tax }) => (
          <Card key={delivery.orderId} className="overflow-hidden">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Badge className="mb-1 bg-orange-600 text-white hover:bg-orange-600">DOMICILIO</Badge>
                  <p className="truncate font-bold">{delivery.customerName}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary">{statusLabel(delivery.status)}</Badge>
                  <Badge variant="outline">
                    {delivery.paymentMode === "prepaid" ? "Anticipado" : "Contra entrega"}
                  </Badge>
                </div>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Domicilio</span>
                <span>{formatCurrency(delivery.deliveryFee)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Total:</span>
                <span>{formatCurrency(deliveryTotal(subtotal, tax, delivery.deliveryFee))}</span>
              </div>
              <Button className="w-full" onClick={() => void openPayment(delivery.orderId)}>
                <CreditCard className="mr-2 h-4 w-4" />
                Cobrar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

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
