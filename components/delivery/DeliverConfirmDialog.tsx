'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PaymentMode } from '@/lib/delivery/types'

interface DeliverConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderSummary: string
  paymentMode: PaymentMode
  isPaid: boolean
  isPending: boolean
  onConfirm: () => void
}

/** H-072: what "Entregado" warns about before the delivery closes. */
export function deliverWarning(paymentMode: PaymentMode, isPaid: boolean): string | null {
  if (isPaid) return null
  return paymentMode === 'prepaid'
    ? 'Este pedido anticipado no tiene pago registrado. Regístralo antes o justo después de cerrarlo.'
    : 'Este pedido no tiene pago registrado: el domiciliario trae el dinero, regístralo en caja.'
}

/** H-072: "Entregado" closes the delivery only after a confirmation that names a missing payment. */
export function DeliverConfirmDialog({
  open,
  onOpenChange,
  orderSummary,
  paymentMode,
  isPaid,
  isPending,
  onConfirm,
}: DeliverConfirmDialogProps) {
  const warning = deliverWarning(paymentMode, isPaid)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Marcar como entregado?</AlertDialogTitle>
          <AlertDialogDescription>{orderSummary}</AlertDialogDescription>
        </AlertDialogHeader>
        {warning && (
          <p
            role="alert"
            className="rounded-card border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg"
          >
            {warning}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            Sí, marcar entregado
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
