'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertTriangle } from 'lucide-react'
import { listCouriers } from '@/lib/supabase/delivery-service'

interface DispatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Re-dispatch of a failed delivery: only the copy changes. */
  isRedispatch: boolean
  /** Unpaid prepaid order: warn, never block. */
  showPrepaidWarning: boolean
  isPending: boolean
  onConfirm: (courierId: string) => void
}

/**
 * Courier picker for `dispatch`. Lists ACTIVE couriers only (the
 * server refuses an inactive one); with no active courier the dialog
 * points the operator to the admin couriers screen.
 */
export function DispatchDialog({
  open,
  onOpenChange,
  isRedispatch,
  showPrepaidWarning,
  isPending,
  onConfirm,
}: DispatchDialogProps) {
  const [courierId, setCourierId] = useState('')

  useEffect(() => {
    if (open) setCourierId('')
  }, [open])

  const { data: couriers = [], isLoading, error } = useQuery({
    queryKey: ['couriers', 'active'],
    queryFn: () => listCouriers({ activeOnly: true }),
    enabled: open,
    staleTime: 30_000,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isRedispatch ? 'Reenviar domicilio' : 'Despachar domicilio'}</DialogTitle>
          <DialogDescription>Elige el domiciliario que lleva el pedido.</DialogDescription>
        </DialogHeader>

        {showPrepaidWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Este pedido es de pago anticipado y aún no tiene el pago registrado. Puedes
              despacharlo de todas formas; recuerda registrar el pago.
            </p>
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive">No se pudieron cargar los domiciliarios.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando domiciliarios…</p>
        ) : couriers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay domiciliarios activos. Un administrador debe crearlos o activarlos en el
            panel de administración.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="dispatch-courier">Domiciliario</Label>
            <Select value={courierId} onValueChange={setCourierId} disabled={isPending}>
              <SelectTrigger id="dispatch-courier">
                <SelectValue placeholder="Selecciona un domiciliario" />
              </SelectTrigger>
              <SelectContent>
                {couriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cerrar
          </Button>
          <Button onClick={() => onConfirm(courierId)} disabled={isPending || courierId === ''}>
            {isPending ? 'Despachando…' : isRedispatch ? 'Reenviar' : 'Despachar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
