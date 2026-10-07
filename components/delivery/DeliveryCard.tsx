'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Phone, MapPin, AlertTriangle } from 'lucide-react'
import type { DeliveryOrderWithBill } from '@/lib/supabase/delivery-service'
import { statusLabel, allowedActions, type DeliveryAction } from '@/lib/delivery/state-machine'
import type { DeliveryRole } from '@/lib/delivery/types'
import { formatAddress } from '@/lib/delivery/address'
import { formatPhone } from '@/lib/delivery/phone'
import { formatElapsedMinutes } from './elapsed'

interface DeliveryCardProps {
  row: DeliveryOrderWithBill
  /** Auth role driving which action buttons render. */
  role: DeliveryRole
  /**
   * Wired for task 6 too: this task only renders `mark_ready` and
   * `start_preparing` (other actions stay hidden to keep the button
   * set aligned with what the server accepts). Task 6 fills in the rest.
   */
  onAction: (action: DeliveryAction) => void
  /** While a state transition is in flight (post-task-6 wiring). */
  isPending?: boolean
}

/**
 * One delivery on the operator board. Renders the customer, phone,
 * one-line address (server-side a house draft), the items/total
 * preview from the join with `orders`, and a payment-mode badge.
 *
 * Status transitions this task supports: `start_preparing` and
 * `mark_ready` only (the operator pulls the order into the kitchen
 * queue from the board). Other transitions land in task 6 — the
 * component intentionally does NOT show a "disabled" dispatch/deliver/
 * fail/cancel button so a future reader sees no dead affordances.
 */
export function DeliveryCard({ row, role, onAction, isPending = false }: DeliveryCardProps) {
  const { delivery, amountDue, subtotal, tax } = row
  const actions = allowedActions(delivery.status, role)
  const canPrepare = actions.includes('start_preparing')
  const canReady = actions.includes('mark_ready')

  const paymentBadge =
    delivery.paymentMode === 'prepaid' ? (
      <Badge variant="default" className="text-[10px]">Anticipado</Badge>
    ) : (
      <Badge variant="outline" className="text-[10px]">
        Contra entrega
        {delivery.cashChangeFor !== null && delivery.cashChangeFor > 0
          ? ` · lleva cambio de ${formatMoney(delivery.cashChangeFor)}`
          : ''}
      </Badge>
    )

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{delivery.customerName}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              {formatPhone(delivery.customerPhone, { withCountryCode: true })}
            </p>
          </div>
          {paymentBadge}
        </div>

        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">
            {safeAddress(delivery)}
          </span>
        </p>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Subtotal {formatMoney(subtotal)} · Impuestos {formatMoney(tax)}
          </span>
          <span className="font-semibold">{formatMoney(amountDue)}</span>
        </div>

        {delivery.failureReason && (
          <p className="flex items-start gap-1 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{delivery.failureReason}</span>
          </p>
        )}

        {delivery.notes && delivery.notes.trim().length > 0 && (
          <p className="rounded-md bg-muted/50 p-2 text-xs italic text-muted-foreground">
            {delivery.notes}
          </p>
        )}

        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {statusLabel(delivery.status)} · {formatElapsedMinutes(delivery.updatedAt)}
        </p>

        {(canPrepare || canReady) && (
          <div className="flex gap-2">
            {canPrepare && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onAction('start_preparing')}
                disabled={isPending}
              >
                En preparación
              </Button>
            )}
            {canReady && (
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onAction('mark_ready')}
                disabled={isPending}
              >
                Marcar listo
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function safeAddress(d: { addressLine: string; neighborhood: string | null; addressReference: string | null }): string {
  try {
    return formatAddress({
      addressLine: d.addressLine,
      neighborhood: d.neighborhood,
      reference: d.addressReference,
    })
  } catch {
    return d.addressLine
  }
}

function formatMoney(n: number): string {
  // Whole COP, no decimals. formatCurrency() from utils/helpers renders
  // the locale currency string the cashier sees on the bill.
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)
}