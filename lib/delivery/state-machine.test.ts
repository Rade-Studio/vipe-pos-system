import { describe, expect, it } from 'vitest'
import {
  DELIVERY_STATUSES,
  allowedActions,
  isTerminal,
  nextStatus,
  statusLabel,
} from './state-machine'

// -----------------------------------------------------------
// Server table (mirrors the SQL in 20261007110000_delivery_rpcs.sql,
// section 2 / section 4 / section 5). Every (status, action) pair
// the RPC accepts must appear here; every pair it rejects must
// appear as `null` from nextStatus.
// -----------------------------------------------------------

const TABLE: ReadonlyArray<{
  from:
    | 'received'
    | 'preparing'
    | 'ready'
    | 'out_for_delivery'
    | 'failed'
  action: 'start_preparing' | 'mark_ready' | 'dispatch' | 'deliver' | 'fail' | 'cancel'
  to:
    | 'preparing'
    | 'ready'
    | 'out_for_delivery'
    | 'delivered'
    | 'failed'
    | 'cancelled'
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

describe('state-machine: nextStatus mirrors the server transition table', () => {
  for (const row of TABLE) {
    it(`${row.from} + ${row.action} -> ${row.to}`, () => {
      expect(nextStatus(row.from, row.action)).toBe(row.to)
    })
  }

  it('rejects every (status, action) NOT in the server table', () => {
    // Build the (status, action) grid and expect every off-table pair to
    // map to null. Same-state replays are also rejected by the server
    // (P0001 'is already in state X'), so target == current -> null.
    const allActions = [
      'start_preparing',
      'mark_ready',
      'dispatch',
      'deliver',
      'fail',
      'cancel',
    ] as const
    const allowedPairs = new Set(TABLE.map((row) => `${row.from}|${row.action}`))
    for (const status of DELIVERY_STATUSES) {
      for (const action of allActions) {
        if (allowedPairs.has(`${status}|${action}`)) continue
        expect(nextStatus(status, action)).toBeNull()
      }
    }
  })

  it('returns null for unknown status (defensive)', () => {
    expect(
      nextStatus('not_a_real_status' as never, 'start_preparing'),
    ).toBeNull()
  })
})

// -----------------------------------------------------------
// Role matrix
// -----------------------------------------------------------

describe('state-machine: allowedActions role matrix', () => {
  it('kitchen can only start_preparing and mark_ready', () => {
    expect(allowedActions('received', 'kitchen').sort()).toEqual(
      ['mark_ready', 'start_preparing'].sort(),
    )
    expect(allowedActions('preparing', 'kitchen').sort()).toEqual(
      ['mark_ready'].sort(),
    )
    // No kitchen action past ready.
    expect(allowedActions('ready', 'kitchen')).toEqual([])
    expect(allowedActions('out_for_delivery', 'kitchen')).toEqual([])
    expect(allowedActions('failed', 'kitchen')).toEqual([])
  })

  it('delivery_operator can perform every transition (server allows)', () => {
    expect(allowedActions('received', 'delivery_operator').sort()).toEqual(
      ['cancel', 'mark_ready', 'start_preparing'].sort(),
    )
    expect(allowedActions('preparing', 'delivery_operator').sort()).toEqual(
      ['cancel', 'mark_ready'].sort(),
    )
    expect(allowedActions('ready', 'delivery_operator').sort()).toEqual(
      ['cancel', 'dispatch'].sort(),
    )
    expect(allowedActions('out_for_delivery', 'delivery_operator').sort()).toEqual(
      ['deliver', 'fail'].sort(),
    )
    expect(allowedActions('failed', 'delivery_operator').sort()).toEqual(
      ['cancel', 'dispatch'].sort(),
    )
  })

  it('admin can perform every transition (server allows)', () => {
    expect(allowedActions('received', 'admin').sort()).toEqual(
      ['cancel', 'mark_ready', 'start_preparing'].sort(),
    )
    expect(allowedActions('ready', 'admin').sort()).toEqual(
      ['cancel', 'dispatch'].sort(),
    )
    expect(allowedActions('out_for_delivery', 'admin').sort()).toEqual(
      ['deliver', 'fail'].sort(),
    )
  })

  it('cashier has no delivery privileges (treated like any other role)', () => {
    expect(allowedActions('received', 'cashier')).toEqual([])
    expect(allowedActions('out_for_delivery', 'cashier')).toEqual([])
  })

  it('returns [] for an unknown role (defensive)', () => {
    expect(allowedActions('received', 'waiter' as never)).toEqual([])
  })
})

// -----------------------------------------------------------
// isTerminal
// -----------------------------------------------------------

describe('state-machine: isTerminal', () => {
  it('delivered and cancelled are terminal', () => {
    expect(isTerminal('delivered')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
  })

  it('every other status is non-terminal', () => {
    for (const status of DELIVERY_STATUSES) {
      if (status === 'delivered' || status === 'cancelled') continue
      expect(isTerminal(status)).toBe(false)
    }
  })
})

// -----------------------------------------------------------
// statusLabel (Spanish, one label per status)
// -----------------------------------------------------------

describe('state-machine: statusLabel', () => {
  it('maps every status to a stable Spanish label', () => {
    expect(statusLabel('received')).toBe('Recibido')
    expect(statusLabel('preparing')).toBe('En preparación')
    expect(statusLabel('ready')).toBe('Listo')
    expect(statusLabel('out_for_delivery')).toBe('En camino')
    expect(statusLabel('delivered')).toBe('Entregado')
    expect(statusLabel('failed')).toBe('Fallido')
    expect(statusLabel('cancelled')).toBe('Cancelado')
  })

  it('covers every status without gaps', () => {
    for (const status of DELIVERY_STATUSES) {
      expect(statusLabel(status)).toMatch(/\S/)
    }
  })
})