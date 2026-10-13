'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { validateFailureReason } from '@/lib/delivery/card-actions'

interface FailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isPending: boolean
  onConfirm: (reason: string) => void
}

/** Marks a delivery as failed; the reason (1..200 characters) is required. */
export function FailDialog({ open, onOpenChange, isPending, onConfirm }: FailDialogProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const check = validateFailureReason(reason)

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Domicilio fallido</DialogTitle>
          <DialogDescription>
            Indica por qué no se entregó. Después podrás reenviarlo o cancelarlo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="fail-reason">Motivo</Label>
          <Textarea
            id="fail-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => {
              setReason(e.target.value)
              setTouched(true)
            }}
            placeholder="Ej.: el cliente no contesta"
            disabled={isPending}
          />
          <p className="text-right text-xs text-muted-foreground">{reason.trim().length}/200</p>
          {touched && !check.ok && <p className="text-sm text-destructive">{check.message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cerrar
          </Button>
          <Button
            variant="destructive"
            onClick={() => check.ok && onConfirm(check.reason)}
            disabled={isPending || !check.ok}
          >
            {isPending ? 'Guardando…' : 'Marcar fallido'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
