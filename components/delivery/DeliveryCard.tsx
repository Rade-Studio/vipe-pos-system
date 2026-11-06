'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Phone, MapPin, AlertTriangle, Wallet, Clock } from 'lucide-react'
import type { DeliveryOrderWithBill } from '@/lib/api/delivery'
import { statusLabel, allowedActions, type DeliveryAction } from '@/lib/delivery/state-machine'
import type { DeliveryRole } from '@/lib/delivery/types'
import { formatAddress } from '@/lib/delivery/address'
import { canRegisterPayment } from '@/lib/delivery/card-actions'
import { deliveryOrderRef, lateTone, stateClockStart } from '@/lib/delivery/console'
import { formatPhone } from '@/lib/delivery/phone'
import { formatElapsedMinutes } from './elapsed'
import { CARD_SURFACE, CHIP, MONEY, PILL_BUTTON, STATUS_CHIP, formatMoney } from './console-ui'

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
  /** Shows the status chip (the tab list and the closed list; a column already names it). */
  showStatus?: boolean
  /** T25: `deliveryLateMinutes` of the restaurant; without it no late tone. */
  lateMinutes?: number
  /** Clock for the late tone (the board refreshes it). */
  nowMs?: number
}

const ACTION_LABELS: Record<DeliveryAction, string> = {
  start_preparing: 'Preparar',
  mark_ready: 'Marcar listo',
  dispatch: 'Despachar',
  deliver: 'Entregado',
  fail: 'Fallido',
  cancel: 'Cancelar',
}

const ACTION_VARIANTS: Record<DeliveryAction, 'default' | 'outline' | 'destructive' | 'ghost'> = {
  start_preparing: 'default',
  mark_ready: 'default',
  dispatch: 'default',
  deliver: 'default',
  fail: 'outline',
  cancel: 'outline',
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
  showStatus = false,
  lateMinutes,
  nowMs = Date.now(),
}: DeliveryCardProps) {
  const { delivery, amountDue, subtotal, tax, isPaid } = row
  const actions = allowedActions(delivery.status, role)
  const showPayment = canRegisterPayment({ status: delivery.status, isPaid, role })
  const tone = lateMinutes ? lateTone(delivery, nowMs, lateMinutes) : null
  // One clock per card (design): kitchen phase from the order, road from the dispatch.
  const clock = formatElapsedMinutes(stateClockStart(delivery), nowMs)
  const paymentLine =
    delivery.paymentMode === 'prepaid'
      ? `Anticipado${delivery.prepaidMethod?.name ? ` · ${delivery.prepaidMethod.name}` : ''}`
      : `Contra entrega${
          delivery.cashChangeFor !== null && delivery.cashChangeFor > 0
            ? ` · lleva cambio de ${formatMoney(delivery.cashChangeFor)}`
            : ''
        }`

  return (
    <article
      aria-label={`${delivery.customerName}, ${statusLabel(delivery.status)}`}
      className={cn(
        'grid min-w-0 gap-2 rounded-card border border-line p-3 text-sm shadow-sm focus-within:border-brand-line',
        tone === 'late' && 'border-status-danger-line ring-1 ring-status-danger-line',
        tone === 'risk' && 'border-status-warning-line',
        CARD_SURFACE,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-fg">
        <span className="font-mono font-medium tabular-nums text-fg-2">{deliveryOrderRef(delivery)}</span>
        {showStatus && <span className={cn(CHIP, STATUS_CHIP[delivery.status])}>{statusLabel(delivery.status)}</span>}
        {tone ? (
          <span
            className={cn(
              CHIP,
              'ml-auto tabular-nums',
              tone === 'late'
                ? 'border-status-danger-line bg-status-danger-bg text-status-danger-fg'
                : 'border-status-warning-line bg-status-warning-bg text-status-warning-fg',
            )}
            title={`Demorado desde ${lateMinutes} min`}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {clock} · {tone === 'late' ? 'Demorado' : 'En riesgo'}
          </span>
        ) : (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums">
            <Clock className="h-3 w-3" aria-hidden />
            {clock}
          </span>
        )}
      </div>

      <h4 className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-fg [overflow-wrap:anywhere]">
        {delivery.customerName}
      </h4>

      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-fg">
        <Phone className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate tabular-nums">{formatPhone(delivery.customerPhone, { withCountryCode: true })}</span>
      </p>

      <p className="flex min-w-0 items-start gap-1.5 text-fg-2">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-fg" aria-hidden />
        <span className="line-clamp-2 [overflow-wrap:anywhere]">{safeAddress(delivery)}</span>
      </p>

      <div className="grid gap-1.5 border-t border-line pt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-fg-2">
            <span className="[overflow-wrap:anywhere]">{paymentLine}</span>
            {delivery.status !== 'cancelled' &&
              (isPaid ? (
                <span className={cn(CHIP, 'border-status-ok-line bg-status-ok-bg text-status-ok-fg')}>Pagado</span>
              ) : (
                <span className={cn(CHIP, 'border-status-warning-line bg-status-warning-bg text-status-warning-fg')}>
                  Pendiente de pago
                </span>
              ))}
          </span>
          {/* pay_order charges subtotal + tax + delivery fee. */}
          <span className={cn(MONEY, 'text-right text-base font-semibold text-fg')}>
            {formatMoney(amountDue + delivery.deliveryFee)}
          </span>
        </div>
        <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-fg">
          <span className={MONEY}>Subtotal {formatMoney(subtotal)}</span>
          <span className={MONEY}>Impuestos {formatMoney(tax)}</span>
          <span className={MONEY}>Domicilio {formatMoney(delivery.deliveryFee)}</span>
        </p>
      </div>

      {delivery.failureReason && (
        <p className="flex items-start gap-1.5 rounded-lg border border-status-danger-line bg-status-danger-bg p-2 text-xs text-status-danger-fg">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span className="line-clamp-2 [overflow-wrap:anywhere]">{delivery.failureReason}</span>
        </p>
      )}

      {delivery.notes && delivery.notes.trim().length > 0 && (
        <p className="rounded-lg bg-surface-2 p-2 text-xs italic text-muted-fg [overflow-wrap:anywhere] dark:bg-surface">
          {delivery.notes}
        </p>
      )}

      {(actions.length > 0 || showPayment) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={ACTION_VARIANTS[action]}
              className={cn(PILL_BUTTON, 'flex-auto')}
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
              className={cn(PILL_BUTTON, 'flex-auto')}
              onClick={onRegisterPayment}
              disabled={isPending}
            >
              <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden />
              Registrar pago
            </Button>
          )}
        </div>
      )}
    </article>
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
