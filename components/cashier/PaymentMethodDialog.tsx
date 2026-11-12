"use client"

import { useCallback, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { PrintableInvoice } from "@/types"
import type { DeliveryOrder } from "@/lib/delivery/types"
import type { PaymentOrderSource } from "@/lib/payments/invoice-discounts"
import { PaymentPanel } from "./PaymentPanel"

interface PaymentMethodDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  /**
   * The order the caller already holds, in the `orders` row shape. When it
   * carries its items the dialog bills straight from it and NEVER reads the
   * order again; when it is missing or itemless (the delivery panel, or a
   * realtime stub) it falls back to `getById`. S2: its discount records and
   * list-price subtotal go on the invoice, as in the cashier's column.
   */
  order?: PaymentOrderSource | null
  /** Null / omitted for delivery orders (no table). Unused by the dialog. */
  tableId?: string | null
  /** Bill total (subtotal + tax + tip) from the caller's cache. Kept for API compat. */
  amount?: number
  tableTotal?: number
  /**
   * Delivery fee (whole pesos) of a delivery order, default 0. pay_order
   * charges subtotal + tax + delivery_fee, so the dialog adds it to the
   * amount due; the tip stays on the food subtotal.
   */
  deliveryFee?: number
  /** The order's delivery snapshot; when set, the invoice prints the delivery block. */
  delivery?: DeliveryOrder | null
  onSuccess: () => void
  isPartialPayment?: boolean
  selectedItems?: string[]
}

/**
 * `PaymentPanel` in a dialog, for the screens that charge from a list (the
 * delivery board and the cashier's delivery queue). After a successful
 * payment the existing invoice print view replaces the dialog; closing it
 * calls `onSuccess`.
 *
 * tableId / amount / tableTotal / isPartialPayment / selectedItems are part
 * of the legacy props contract; the panel computes the bill itself.
 */
export function PaymentMethodDialog({
  open,
  onOpenChange,
  orderId,
  order = null,
  deliveryFee = 0,
  delivery = null,
  onSuccess,
}: PaymentMethodDialogProps) {
  const [invoice, setInvoice] = useState<PrintableInvoice | null>(null)
  const submitting = useRef(false)
  const onSubmittingChange = useCallback((value: boolean) => {
    submitting.current = value
  }, [])

  if (invoice) {
    return (
      <InvoicePrintView
        invoice={invoice}
        open
        onOpenChange={(isOpen) => {
          if (isOpen) return
          setInvoice(null)
          onSuccess()
          onOpenChange(false)
        }}
        isPending={false}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Don't allow closing mid-submit; wait for success or failure.
        if (submitting.current && !isOpen) return
        onOpenChange(isOpen)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-2xl">
        <PaymentPanel
          layout="dialog"
          active={open}
          orderId={orderId}
          order={order}
          deliveryFee={deliveryFee}
          delivery={delivery}
          Title={DialogTitle}
          Description={DialogDescription}
          onCancel={() => onOpenChange(false)}
          onPaid={setInvoice}
          onSubmittingChange={onSubmittingChange}
        />
      </DialogContent>
    </Dialog>
  )
}
