/**
 * Delivery lifecycle state machine (client mirror).
 *
 * The SQL function `public.set_delivery_status` is the source of
 * truth: the role / action matrix, the transition table and the
 * same-state replay error (`P0001`) are server-side. This module
 * mirrors the rules so the operator board can disable / highlight
 * buttons without a network call, while the server still owns every
 * actual state change.
 *
 * Mirrors `lib/payments/state-machine.ts`-style intent (no such file
 * today, but the same convention as every other lib/* module): a
 * single readme-style header, pure functions, no Supabase or DOM
 * dependencies.
 */

import type { DeliveryAction, DeliveryRole, DeliveryStatus } from './types'

export type { DeliveryAction }
import { DELIVERY_ACTIONS, DELIVERY_ROLES, DELIVERY_STATUSES } from './types'

// Re-exported so tests can iterate the canonical status list without
// pulling the types module a second time.
export { DELIVERY_STATUSES }

// -----------------------------------------------------------
// Transition table
// -----------------------------------------------------------

/**
 * Adjacency list: each (status, action) pair the server accepts, and
 * the state it transitions to. Mirrors the SQL `v_allowed_states` /
 * `v_target_state` blocks of `set_delivery_status` section 4. Any
 * (status, action) NOT in this table is rejected by the server with
 * P0001 ("delivery is already in state X" for same-state replays, or
 * "action ... is not allowed from state ... (allowed: ...)" otherwise).
 */
const TRANSITIONS: ReadonlyArray<{
  from: DeliveryStatus
  action: DeliveryAction
  to: DeliveryStatus
}> = [
  { from: 'received', action: 'start_preparing', to: 'preparing' },
  { from: 'received', action: 'mark_ready', to: 'ready' },
  { from: 'received', action: 'cancel', to: 'cancelled' },
  { from: 'preparing', action: 'mark_ready', to: 'ready' },
  { from: 'preparing', action: 'cancel', to: 'cancelled' },
  { from: 'ready', action: 'dispatch', to: 'out_for_delivery' },
  { from: 'ready', action: 'cancel', to: 'cancelled' },
  { from: 'out_for_delivery', action: 'deliver', to: 'delivered' },
  { from: 'out_for_delivery', action: 'fail', to: 'failed' },
  { from: 'failed', action: 'dispatch', to: 'out_for_delivery' },
  { from: 'failed', action: 'cancel', to: 'cancelled' },
]

/**
 * Look up the target state of a (status, action) pair. Returns null
 * when the server would reject the transition (either because the
 * pair is not in the table or because the action / status is unknown).
 *
 * Same-state replays are intentionally NOT mapped here: the server
 * raises P0001 ("delivery is already in state X") for a replay, so
 * the client distinguishes "I already moved this" from "the server
 * refused" through a single error path on `setDeliveryStatus`.
 */
export function nextStatus(
  status: DeliveryStatus,
  action: DeliveryAction,
): DeliveryStatus | null {
  if (!DELIVERY_STATUSES.includes(status)) return null
  if (!DELIVERY_ACTIONS.includes(action)) return null
  for (const row of TRANSITIONS) {
    if (row.from === status && row.action === action) return row.to
  }
  return null
}

// -----------------------------------------------------------
// Role matrix
// -----------------------------------------------------------

/**
 * Role -> set of actions it may attempt on a given state. Mirrors
 * the SQL action/role check:
 *
 *   start_preparing, mark_ready: kitchen / delivery_operator / admin
 *   dispatch, deliver, fail, cancel: delivery_operator / admin
 *   cashier / any other role: none
 *
 * `allowedActions` is OPTIMISTIC: it returns every action the
 * transition table accepts AND the caller's role allows. The server
 * is still authoritative (cashier is filtered out on the server side
 * even when the client UI mistakenly enables a button); the helper
 * exists so the operator board can disable buttons without a
 * round-trip.
 */
export function allowedActions(
  status: DeliveryStatus,
  role: DeliveryRole,
): DeliveryAction[] {
  if (!DELIVERY_STATUSES.includes(status)) return []
  if (!DELIVERY_ROLES.includes(role)) return []

  const result: DeliveryAction[] = []
  for (const row of TRANSITIONS) {
    if (row.from !== status) continue
    if (!roleAllowsAction(role, row.action)) continue
    if (!result.includes(row.action)) result.push(row.action)
  }
  return result
}

function roleAllowsAction(role: DeliveryRole, action: DeliveryAction): boolean {
  switch (action) {
    case 'start_preparing':
    case 'mark_ready':
      return role === 'kitchen' || role === 'delivery_operator' || role === 'admin'
    case 'dispatch':
    case 'deliver':
    case 'fail':
    case 'cancel':
      return role === 'delivery_operator' || role === 'admin'
  }
}

// -----------------------------------------------------------
// isTerminal / statusLabel
// -----------------------------------------------------------

/**
 * Terminal states never transition out of themselves: the server does
 * not accept any action from a delivered / cancelled delivery, so
 * the operator board can hide them (and the same-day filter in
 * `listActiveDeliveries` keeps older terminal rows from clogging
 * the board).
 */
export function isTerminal(status: DeliveryStatus): boolean {
  return status === 'delivered' || status === 'cancelled'
}

/**
 * Spanish labels for every status (the operator board and the kitchen
 * ticket). Stable strings so React keys do not churn across re-renders
 * and so CSV exports keep one column per state.
 */
const STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  received: 'Recibido',
  preparing: 'En preparación',
  ready: 'Listo',
  out_for_delivery: 'En camino',
  delivered: 'Entregado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
}

export function statusLabel(status: DeliveryStatus): string {
  return STATUS_LABELS[status]
}