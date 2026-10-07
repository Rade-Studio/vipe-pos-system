import { beforeEach, describe, expect, it, vi } from 'vitest'

const getByStatus = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {},
  tableService: {},
  orderService: { getByStatus: (statuses: string[]) => getByStatus(statuses) },
}))

import { useOrderStore } from './useOrderStore'

function row(id: string, orderType: string | undefined, tableId: string | null) {
  return {
    id,
    order_type: orderType,
    table_id: tableId,
    status: 'kitchen',
    order_items: [],
    subtotal: 0,
    tax: 0,
    tax_percentage: 0,
    tip: 0,
    tip_percentage: 0,
    total: 0,
    total_discounts: 0,
    waiter_id: null,
    created_at: '2026-10-07T12:00:00Z',
    is_partial_order: false,
    parent_order_id: null,
  }
}

describe('useOrderStore.loadOrders', () => {
  beforeEach(() => {
    useOrderStore.setState({ orders: [] })
    getByStatus.mockReset()
  })

  it('keeps the order type so delivery orders are not labelled as a table', async () => {
    getByStatus.mockImplementation(async (statuses: string[]) =>
      statuses[0] === 'kitchen'
        ? [row('delivery-1', 'delivery', null), row('dine-1', 'dine_in', 'table-1')]
        : [],
    )

    await useOrderStore.getState().loadOrders()

    const byId = Object.fromEntries(useOrderStore.getState().orders.map((o) => [o.id, o]))
    expect(byId['delivery-1'].orderType).toBe('delivery')
    expect(byId['dine-1'].orderType).toBe('dine_in')
    expect(byId['dine-1'].tableId).toBe('table-1')
  })
})
