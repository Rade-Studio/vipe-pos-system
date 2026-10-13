'use client'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface CancelDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerName: string
  isPending: boolean
  onConfirm: () => void
}

/**
 * Confirmation before `cancel`. The server refuses once the order has
 * a payment; the board shows that message in a toast.
 */
export function CancelDeliveryDialog({
  open,
  onOpenChange,
  customerName,
  isPending,
  onConfirm,
}: CancelDeliveryDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cancelar el domicilio?</AlertDialogTitle>
          <AlertDialogDescription>
            El pedido de {customerName} se cancelará y no se podrá reabrir. Un pedido con pago
            registrado no se puede cancelar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
          {/* Plain button: AlertDialogAction would close the dialog before the result. */}
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Cancelando…' : 'Cancelar domicilio'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
