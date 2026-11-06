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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { listCouriers } from '@/lib/api/delivery'
import { CHIP, FOCUS_RING, PHONE_SHEET, PILL_BUTTON, SHEET_FOOTER } from './console-ui'

interface DispatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Re-dispatch of a failed delivery: only the copy changes. */
  isRedispatch: boolean
  /** Unpaid prepaid order: warn, never block. */
  showPrepaidWarning: boolean
  isPending: boolean
  onConfirm: (courierId: string) => void
  /** One-line "customer · address" of the order being dispatched. */
  orderSummary?: string
  /** Deliveries on the road per courier id (from the board). */
  courierLoad?: ReadonlyMap<string, number>
}

/**
 * Courier picker for `dispatch`. Lists ACTIVE couriers only (the
 * server refuses an inactive one); with no active courier the dialog
 * points the operator to the admin couriers screen. T12: the picker is a
 * radio list that shows whether each courier is free or already on the road.
 */
export function DispatchDialog({
  open,
  onOpenChange,
  isRedispatch,
  showPrepaidWarning,
  isPending,
  onConfirm,
  orderSummary,
  courierLoad,
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
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{isRedispatch ? 'Reenviar domicilio' : 'Despachar domicilio'}</DialogTitle>
          <DialogDescription>Elige el domiciliario que lleva el pedido.</DialogDescription>
          {orderSummary && (
            <p className="text-sm text-fg-2 [overflow-wrap:anywhere]">{orderSummary}</p>
          )}
        </DialogHeader>

        {showPrepaidWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-status-warning-line bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
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
            <p id="dispatch-courier-label" className="text-sm font-medium">
              Domiciliario <span className="font-normal text-muted-fg">· solo activos</span>
            </p>
            <RadioGroup
              aria-labelledby="dispatch-courier-label"
              value={courierId}
              onValueChange={setCourierId}
              disabled={isPending}
              className="gap-2"
            >
              {couriers.map((c) => {
                const load = courierLoad?.get(c.id) ?? 0
                const selected = c.id === courierId
                return (
                  <label
                    key={c.id}
                    htmlFor={`courier-${c.id}`}
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center gap-3 rounded-card border p-3',
                      selected ? 'border-brand-line bg-brand-tint' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <RadioGroupItem id={`courier-${c.id}`} value={c.id} className={FOCUS_RING} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{c.name}</span>
                      <span className="block truncate text-xs tabular-nums text-muted-fg">
                        {load > 0 ? `${load} ${load === 1 ? 'pedido' : 'pedidos'} en ruta` : 'Sin pedidos en ruta'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </span>
                    </span>
                    <span
                      className={cn(
                        CHIP,
                        load > 0
                          ? 'border-status-served-line bg-status-served-bg text-status-served-fg'
                          : 'border-status-free-line bg-status-free-bg text-status-free-fg',
                      )}
                    >
                      {load > 0 ? 'En ruta' : 'Libre'}
                    </span>
                  </label>
                )
              })}
            </RadioGroup>
          </div>
        )}

        <DialogFooter className={SHEET_FOOTER}>
          <Button variant="outline" className={PILL_BUTTON} onClick={() => onOpenChange(false)} disabled={isPending}>
            Cerrar
          </Button>
          <Button
            className={PILL_BUTTON}
            onClick={() => onConfirm(courierId)}
            disabled={isPending || courierId === ''}
          >
            {isPending ? 'Despachando…' : isRedispatch ? 'Reenviar' : 'Despachar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
