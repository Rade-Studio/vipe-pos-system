import type { DeliveryStatus } from '@/lib/delivery/types'

/**
 * Shared class names of the dispatch console (T12). Literal strings so the
 * Tailwind JIT sees every token class.
 */

/** Dialogs open as a full-height sheet on phones and stay centred from `sm`. */
export const PHONE_SHEET =
  'max-sm:left-0 max-sm:top-3 max-sm:bottom-0 max-sm:h-[calc(100dvh-12px)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex max-sm:flex-col max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:rounded-t-card-lg max-sm:border-x-0 max-sm:border-b-0 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none'

/** Footer of a phone sheet: pinned to the bottom. */
export const SHEET_FOOTER = 'max-sm:mt-auto max-sm:gap-2'

/** Visible keyboard focus, distinct from the selected (violet) state. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

/** Money: tabular figures that never wrap. */
export const MONEY = 'whitespace-nowrap tabular-nums'

export const PILL_BUTTON = `min-h-11 rounded-pill ${FOCUS_RING}`

export const CHIP =
  'inline-flex h-6 min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 text-xs font-medium leading-none'

export const STATUS_CHIP: Record<DeliveryStatus, string> = {
  received: 'border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg',
  preparing: 'border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg',
  ready: 'border-status-free-line bg-status-free-bg text-status-free-fg',
  out_for_delivery: 'border-status-served-line bg-status-served-bg text-status-served-fg',
  failed: 'border-status-danger-line bg-status-danger-bg text-status-danger-fg',
  delivered: 'border-status-ok-line bg-status-ok-bg text-status-ok-fg',
  cancelled: 'border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg',
}

/** Column background (light: surface-2, dark: surface) and card background (the inverse). */
export const COLUMN_SURFACE = 'bg-surface-2 dark:bg-surface'
export const CARD_SURFACE = 'bg-surface dark:bg-surface-2'

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)
}
