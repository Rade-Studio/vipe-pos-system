'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Phone, MapPin, AlertTriangle, Wallet } from 'lucide-react'
import type { DeliveryOrderWithBill } from '@/lib/supabase/delivery-service'
import { statusLabel, allowedActions, type DeliveryAction } from '@/lib/delivery/state-machine'
import type { DeliveryRole } from '@/lib/delivery/types'
import { formatAddress } from '@/lib/delivery/address'
import { canRegisterPayment } from '@/lib/delivery/card-actions'
import { formatPhone } from '@/lib/delivery/phone'
import { formatElapsedMinutes } from './elapsed'

interface DeliveryCardProps {
  row: DeliveryOrderWithBill
  /** Auth role driving which action buttons render. */
  role: DeliveryRole
  /**
   * The board decides how each action runs: direct (start_preparing,
   * mark_ready, deliver) or through a dialog (dispatch, fail, cancel).
   */
  onAction: (action: DeliveryAction) => void
  /** Opens the payment dialog (the board checks for an open register). */
  onRegisterPayment: () => void
  /** While a mutation for this card is in flight: every button is disabled. */
  isPending?: boolean
}

const ACTION_LABELS: Record<DeliveryAction, string> = {
  start_preparing: 'En preparación',
  mark_ready: 'Marcar listo',
  dispatch: 'Despachar',
  deliver: 'Entregado',
  fail: 'Fallido',
  cancel: 'Cancelar',
}

const ACTION_VARIANTS: Record<DeliveryAction, 'default' | 'outline' | 'destructive' | 'ghost'> = {
  start_preparing: 'outline',
  mark_ready: 'default',
  dispatch: 'default',
  deliver: 'default',
  fail: 'outline',
  cancel: 'ghost',
}

/**
 * One delivery on the operator board. Renders the customer, phone,
 * one-line address (server-side a house draft), the bill preview from
 * the join with `orders` plus the delivery fee, payment mode and
 * payment state badges, and the actions `allowedActions` permits for
 * the role (a failed delivery shows dispatch as "Reenviar").
 */
export function DeliveryCard({
  row,
  role,
  onAction,
  onRegisterPayment,
  isPending = false,
}: DeliveryCardProps) {
  const { delivery, amountDue, subtotal, tax, isPaid } = row
  const actions = allowedActions(delivery.status, role)
  const showPayment = canRegisterPayment({ status: delivery.status, isPaid, role })

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
          <div className="flex flex-col items-end gap-1">
            {paymentBadge}
            {delivery.status !== 'cancelled' &&
              (isPaid ? (
                <Badge className="bg-green-600 text-[10px] hover:bg-green-600">Pagado</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">
                  Pendiente de pago
                </Badge>
              ))}
          </div>
        </div>

        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">
            {safeAddress(delivery)}
          </span>
        </p>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Subtotal {formatMoney(subtotal)} · Impuestos {formatMoney(tax)} · Domicilio{' '}
            {formatMoney(delivery.deliveryFee)}
          </span>
          {/* pay_order charges subtotal + tax + delivery fee. */}
          <span className="font-semibold">{formatMoney(amountDue + delivery.deliveryFee)}</span>
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

        {(actions.length > 0 || showPayment) && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={ACTION_VARIANTS[action]}
                className="flex-1"
                onClick={() => onAction(action)}
                disabled={isPending}
              >
                {action === 'dispatch' && delivery.status === 'failed'
                  ? 'Reenviar'
                  : ACTION_LABELS[action]}
              </Button>
            ))}
            {showPayment && (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={onRegisterPayment}
                disabled={isPending}
              >
                <Wallet className="mr-1 h-3 w-3" />
                Registrar pago
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