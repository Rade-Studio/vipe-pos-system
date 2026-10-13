import { describe, expect, it, vi } from 'vitest'

import {
  DELIVERY_REALTIME_DEBOUNCE_MS,
  applyDeliveryRowPatch,
  applyDeliveryStatusPatch,
  createDebouncedRefresher,
  isDeliveryOrderChange,
  type DeliveryBoardRow,
} from './realtime'
import { parseOrderDeliveryRow } from './parse'

/**
 * T10 (S1/S2): the delivery board used to subscribe to `orders` with a bare
 * `event: '*'` filter and invalidate the whole `active-deliveries` query on
 * EVERY push. In a live restaurant `orders` receives a write for every table
 * order (items added, item served, order status moved), so each table
 * interaction refetched the whole delivery board — the "the screen loads
 * again" symptom (S2, "cada que elijo una mesa hay una carga de pantalla"),
 * plus an undebounced refetch per push inside a burst.
 *
 * These are the pure rules the hook composes: which `orders` pushes belong
 * to the delivery board, what to do with an `order_deliveries` push, and how
 * to coalesce the refetches that are still needed.
 */

function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 'd-1',
    customer_id: 'c-1',
    customer_name: 'Ana Ruiz',
    customer_phone: '3101234567',
    address_line: 'Calle 5 # 10-20',
    neighborhood: 'Lacentro',
    address_reference: 'Timbre 2',
    delivery_fee: 3000,
    payment_mode: 'cash_on_delivery',
    cash_change_for: null,
    courier_id: null,
    delivery_status: 'received',
    failure_reason: null,
    notes: null,
    dispatched_at: null,
    delivered_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: '2026-10-07T10:00:00.000Z',
    updated_at: '2026-10-07T10:00:00.000Z',
    ...overrides,
  }
}

function boardRow(overrides: Record<string, unknown> = {}): DeliveryBoardRow {
  const delivery = parseOrderDeliveryRow(wireRow(overrides))
  return {
    delivery,
    amountDue: delivery.deliveryFee + 19_000,
    subtotal: 19_000,
    tax: 0,
    isPaid: false,
  }
}

describe('isDeliveryOrderChange', () => {
  it('accepts only order rows whose order_type is delivery', () => {
    expect(isDeliveryOrderChange({ eventType: 'INSERT', new: { order_type: 'delivery' } })).toBe(true)
    expect(isDeliveryOrderChange({ eventType: 'UPDATE', new: { order_type: 'delivery' } })).toBe(true)
    expect(isDeliveryOrderChange({ eventType: 'UPDATE', new: { order_type: 'dine_in' } })).toBe(false)
    expect(isDeliveryOrderChange({ eventType: 'INSERT', new: {} })).toBe(false)
    expect(isDeliveryOrderChange({ eventType: 'INSERT', new: null, old: null })).toBe(false)
  })

  it('reads the deleted row from `old` (REPLICA IDENTITY FULL)', () => {
    expect(
      isDeliveryOrderChange({ eventType: 'DELETE', new: null, old: { order_type: 'delivery' } }),
    ).toBe(true)
    expect(
      isDeliveryOrderChange({ eventType: 'DELETE', new: null, old: { order_type: 'dine_in' } }),
    ).toBe(false)
  })
})

describe('applyDeliveryRowPatch (order_deliveries realtime push)', () => {
  it('merges a full row onto the cached card, keeping the bill fields', () => {
    const prev = [boardRow()]
    const outcome = applyDeliveryRowPatch(prev, wireRow({ delivery_status: 'preparing' }))

    expect(outcome.kind).toBe('patched')
    if (outcome.kind !== 'patched') return
    expect(outcome.rows[0]!.delivery.status).toBe('preparing')
    // The push carries no `orders` join, so the bill must survive untouched.
    expect(outcome.rows[0]!.amountDue).toBe(22_000)
    expect(outcome.rows[0]!.isPaid).toBe(false)
  })

  it('reports `unchanged` for the echo of a write already in the cache', () => {
    const prev = [boardRow()]
    expect(applyDeliveryRowPatch(prev, wireRow())).toEqual({ kind: 'unchanged' })
  })

  it('asks for a refetch when the row is not on the board (a brand new delivery)', () => {
    const prev = [boardRow()]
    expect(applyDeliveryRowPatch(prev, wireRow({ order_id: 'd-2' }))).toEqual({
      kind: 'needs-refresh',
    })
  })

  it('asks for a refetch when the payload is not a complete row', () => {
    const prev = [boardRow()]
    expect(applyDeliveryRowPatch(prev, { order_id: 'd-1', delivery_status: 'ready' })).toEqual({
      kind: 'needs-refresh',
    })
    expect(applyDeliveryRowPatch(prev, null)).toEqual({ kind: 'needs-refresh' })
  })

  it('never mutates the array it was given (PRESERVE)', () => {
    const prev = [boardRow()]
    const snapshot = JSON.stringify(prev)
    applyDeliveryRowPatch(prev, wireRow({ delivery_status: 'ready' }))
    expect(JSON.stringify(prev)).toBe(snapshot)
  })

  // T10 review A1: a push is not necessarily newer than the cache. Realtime
  // delivery can reorder two pushes, and a card the operator already moved
  // must never walk backwards because a stale row arrived late.
  it('ignores a push older than the cached row', () => {
    const cur = [
      boardRow({
        delivery_status: 'out_for_delivery',
        updated_at: '2026-10-07T10:05:00.000Z',
        dispatched_at: '2026-10-07T10:05:00.000Z',
      }),
    ]
    const outcome = applyDeliveryRowPatch(
      cur,
      wireRow({ delivery_status: 'preparing', updated_at: '2026-10-07T10:01:00.000Z' }),
    )
    expect(outcome.kind).toBe('unchanged')
  })

  it('still applies an equally-timed or undated push (the row itself decides)', () => {
    const cur = [boardRow({ updated_at: '2026-10-07T10:05:00.000Z' })]
    expect(
      applyDeliveryRowPatch(cur, wireRow({ delivery_status: 'ready', updated_at: '2026-10-07T10:05:00.000Z' }))
        .kind,
    ).toBe('patched')
    // No usable timestamp on either side: compare the rest of the row.
    expect(applyDeliveryRowPatch([boardRow()], wireRow({ delivery_status: 'ready' })).kind).toBe(
      'patched',
    )
  })

  it('falls back to a refresh for an empty or partial payload (DELETE, partial UPDATE)', () => {
    const prev = [boardRow()]
    expect(applyDeliveryRowPatch(prev, {}).kind).toBe('needs-refresh')
    expect(applyDeliveryRowPatch(prev, { order_id: 'd-1', delivery_status: 'ready' }).kind).toBe(
      'needs-refresh',
    )
    expect(applyDeliveryRowPatch(prev, null).kind).toBe('needs-refresh')
  })
})

describe('applyDeliveryStatusPatch (setDeliveryStatus RPC echo)', () => {
  it('merges the parsed row the RPC returned without refetching', () => {
    const prev = [boardRow()]
    const outcome = applyDeliveryStatusPatch(prev, {
      ...parseOrderDeliveryRow(wireRow()),
      status: 'preparing',
      updatedAt: '2026-10-07T10:05:00.000Z',
    })

    expect(outcome.kind).toBe('patched')
    if (outcome.kind !== 'patched') return
    expect(outcome.rows[0]!.delivery.status).toBe('preparing')
    expect(outcome.rows[0]!.amountDue).toBe(22_000)
  })

  it('is `unchanged` when the RPC confirmed what the cache already shows', () => {
    const prev = [boardRow()]
    expect(applyDeliveryStatusPatch(prev, parseOrderDeliveryRow(wireRow()))).toEqual({
      kind: 'unchanged',
    })
  })

  it('asks for a refetch when the order is not on the board', () => {
    const prev = [boardRow()]
    const other = { ...parseOrderDeliveryRow(wireRow()), orderId: 'd-9' }
    expect(applyDeliveryStatusPatch(prev, other)).toEqual({ kind: 'needs-refresh' })
  })

  // Same rule as the realtime path: the RPC echo must not be able to move a
  // card backwards when the cached row is already newer.
  it('ignores an RPC row older than the cached row', () => {
    const cur = [
      boardRow({ delivery_status: 'out_for_delivery', updated_at: '2026-10-07T10:05:00.000Z' }),
    ]
    const stale = {
      ...parseOrderDeliveryRow(wireRow({ delivery_status: 'preparing' })),
      status: 'preparing' as const,
    }
    expect(applyDeliveryStatusPatch(cur, stale).kind).toBe('unchanged')
  })
})

describe('createDebouncedRefresher', () => {
  it('collapses a burst of pushes into a single refetch', () => {
    vi.useFakeTimers()
    try {
      const refresh = vi.fn()
      const push = createDebouncedRefresher(refresh, DELIVERY_REALTIME_DEBOUNCE_MS)

      push()
      vi.advanceTimersByTime(20)
      push()
      vi.advanceTimersByTime(20)
      push()
      expect(refresh).not.toHaveBeenCalled()

      vi.advanceTimersByTime(DELIVERY_REALTIME_DEBOUNCE_MS)
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new window after a refetch (a later change is not swallowed)', () => {
    vi.useFakeTimers()
    try {
      const refresh = vi.fn()
      const push = createDebouncedRefresher(refresh, DELIVERY_REALTIME_DEBOUNCE_MS)

      push()
      vi.advanceTimersByTime(DELIVERY_REALTIME_DEBOUNCE_MS + 1)
      expect(refresh).toHaveBeenCalledTimes(1)

      push()
      vi.advanceTimersByTime(DELIVERY_REALTIME_DEBOUNCE_MS)
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs a pending refetch on cancel (nothing is lost when the consumer unmounts)', () => {
    vi.useFakeTimers()
    try {
      const refresh = vi.fn()
      const push = createDebouncedRefresher(refresh, DELIVERY_REALTIME_DEBOUNCE_MS)
      push()
      push.cancel()
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})