import { beforeEach, describe, expect, it, vi } from 'vitest'

// T8b: the store reads through the API client; one request for three statuses.
const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api }))

import { useOrderStore } from './useOrderStore'

function dto(id: string, orderType: 'dine_in' | 'delivery', tableId: string | null) {
  return {
    id,
    orderType,
    tableId,
    waiterId: null,
    status: 'kitchen',
    items: [],
    subtotal: 0,
    tax: 0,
    taxPercentage: 0,
    tip: 0,
    tipPercentage: 0,
    total: 0,
    totalDiscounts: 0,
    createdAt: '2026-10-07T12:00:00Z',
    updatedAt: null,
    isPartialOrder: false,
    parentOrderId: null,
  }
}

describe('useOrderStore.loadOrders', () => {
  beforeEach(() => {
    useOrderStore.setState({ orders: [] })
    api.GET.mockReset()
  })

  it('reads kitchen, delivered and active orders in ONE request', async () => {
    api.GET.mockResolvedValue({ data: [] })

    await useOrderStore.getState().loadOrders()

    expect(api.GET).toHaveBeenCalledTimes(1)
    expect(api.GET).toHaveBeenCalledWith('/api/orders', {
      params: { query: { status: 'kitchen,delivered,active' } },
    })
  })

  it('keeps the order type so delivery orders are not labelled as a table', async () => {
    api.GET.mockResolvedValue({
      data: [dto('delivery-1', 'delivery', null), dto('dine-1', 'dine_in', 'table-1')],
    })

    await useOrderStore.getState().loadOrders()

    const byId = Object.fromEntries(useOrderStore.getState().orders.map((o) => [o.id, o]))
    expect(byId['delivery-1'].orderType).toBe('delivery')
    expect(byId['dine-1'].orderType).toBe('dine_in')
    expect(byId['dine-1'].tableId).toBe('table-1')
    expect(byId['dine-1'].createdAt).toEqual(new Date('2026-10-07T12:00:00Z'))
  })

  it('adds only the orders the store does not hold yet', async () => {
    api.GET.mockResolvedValue({ data: [dto('dine-1', 'dine_in', 'table-1')] })
    await useOrderStore.getState().loadOrders()
    const first = useOrderStore.getState().orders[0]

    await useOrderStore.getState().loadOrders()

    expect(useOrderStore.getState().orders).toHaveLength(1)
    expect(useOrderStore.getState().orders[0]).toBe(first)
  })
})
