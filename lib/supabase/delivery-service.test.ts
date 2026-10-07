import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeliveryServiceError,
  createCourier,
  createDeliveryOrder,
  findCustomerByPhone,
  listActiveDeliveries,
  listCouriers,
  setDeliveryStatus,
  updateCourier,
} from './delivery-service'

// -----------------------------------------------------------
// Mock the Supabase browser client.
// -----------------------------------------------------------
// We only assert the contract: the right RPC name, the exact snake_case
// arg names the server migration defines, and a clean error-code ->
// kind mapping. The whole network surface is replaced so this test
// runs in the node env and is deterministic.
//
// The chain is hoisted + mutable so each test can install a fresh
// `from`/`rpc` implementation without re-importing the module.

const state = vi.hoisted(() => {
  type Chain = {
    select: (cols: string) => Chain
    eq: (col: string, val: unknown) => Chain
    in: (col: string, vals: readonly unknown[]) => Chain
    gte: (col: string, val: unknown) => Chain
    or: (filter: string) => Chain
    order: (col: string, opts: { ascending: boolean }) => Chain
    insert: (rows: unknown) => Chain
    update: (patch: unknown) => Chain
    single: () => Chain
    maybeSingle: () => Chain
    then: <TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => PromiseLike<TResult1 | TResult2>
  }
  const makeChain = (result: { data: unknown; error: unknown } = { data: [], error: null }): Chain => {
    const promise: any = Promise.resolve(result)
    const chain: any = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.in = () => chain
    chain.gte = () => chain
    chain.or = () => chain
    chain.order = () => chain
    chain.insert = () => chain
    chain.update = () => chain
    chain.single = () => chain
    chain.maybeSingle = () => chain
    chain.then = promise.then.bind(promise)
    return chain as Chain
  }
  return {
    rpc: vi.fn(),
    from: vi.fn(),
    fromImpl: ((_table: string) => makeChain()) as (table: string) => Chain,
  }
})

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: [string, Record<string, unknown>]) => state.rpc(...args),
    from: (table: string) => {
      state.from(table)
      return state.fromImpl(table)
    },
  },
}))

beforeEach(() => {
  state.rpc.mockReset()
  state.from.mockReset()
  state.fromImpl = (_table: string) => {
    const promise: any = Promise.resolve({ data: [], error: null })
    const chain: any = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.in = () => chain
    chain.gte = () => chain
    chain.or = () => chain
    chain.order = () => chain
    chain.insert = () => chain
    chain.update = () => chain
    chain.single = () => chain
    chain.maybeSingle = () => chain
    chain.then = promise.then.bind(promise)
    return chain
  }
})

// -----------------------------------------------------------
// findCustomerByPhone
// -----------------------------------------------------------
//
// Empty / blank phone short-circuits (no network call). When the
// input parses, the service normalises it (strips +57 when the
// remainder is a 10-digit Colombian mobile), looks the customer up
// and (when found) loads the customer's addresses.

describe('findCustomerByPhone', () => {
  it('rejects empty / whitespace phone without hitting the network', async () => {
    state.rpc.mockClear()
    const err = await findCustomerByPhone('').catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('rejects a phone that normalises to fewer than 7 digits', async () => {
    const err = await findCustomerByPhone('12345').catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
    expect(state.from).not.toHaveBeenCalled()
  })

  it('returns null when no row matches (no customer)', async () => {
    state.fromImpl = (table: string) => {
      expect(table).toBe('customers')
      const promise: any = Promise.resolve({ data: null, error: null })
      const chain: any = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        expect(col).toBe('phone')
        expect(val).toBe('3101234567') // normalised
        return chain
      }
      chain.maybeSingle = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const result = await findCustomerByPhone('+57 310 123 4567')
    expect(result).toBeNull()
  })

  it('returns customer + addresses when the lookup hits, normalising the phone', async () => {
    // First call: customers lookup; second call: customer_addresses list.
    const customerRow = {
      id: 'cust-1',
      phone: '3101234567',
      name: 'Juan Pérez',
      notes: null,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    }
    const addressRows = [
      {
        id: 'addr-1',
        customer_id: 'cust-1',
        label: 'Casa',
        address_line: 'Calle 5',
        neighborhood: 'Centro',
        reference: null,
        is_default: true,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'addr-2',
        customer_id: 'cust-1',
        label: 'Oficina',
        address_line: 'Cra 7',
        neighborhood: null,
        reference: 'piso 3',
        is_default: false,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
      },
    ]

    const queues: any[] = []
    queues.push(
      // customers chain (uses maybeSingle)
      (() => {
        const seen: { eq?: [string, unknown]; select?: string } = {}
        const promise: any = Promise.resolve({ data: customerRow, error: null })
        const chain: any = {}
        chain.select = (cols: string) => {
          seen.select = cols
          return chain
        }
        chain.eq = (col: string, val: unknown) => {
          seen.eq = [col, val]
          return chain
        }
        chain.maybeSingle = () => chain
        chain.then = promise.then.bind(promise)
        return chain
      })(),
      // customer_addresses chain (uses in)
      (() => {
        const seen: { in?: [string, unknown[]]; select?: string; order?: [string, { ascending: boolean }] } = {}
        const promise: any = Promise.resolve({ data: addressRows, error: null })
        const chain: any = {}
        chain.select = (cols: string) => {
          seen.select = cols
          return chain
        }
        chain.eq = () => chain
        chain.in = (col: string, vals: unknown[]) => {
          seen.in = [col, vals]
          return chain
        }
        chain.order = (col: string, opts: { ascending: boolean }) => {
          seen.order = [col, opts]
          return chain
        }
        chain.then = promise.then.bind(promise)
        return chain
      })(),
    )
    state.fromImpl = (table: string) => {
      expect(['customers', 'customer_addresses']).toContain(table)
      return queues.shift()
    }

    const result = await findCustomerByPhone('+57 310 123 4567')
    expect(result).not.toBeNull()
    expect(result!.customer.id).toBe('cust-1')
    expect(result!.customer.phone).toBe('3101234567')
    expect(result!.addresses).toHaveLength(2)
    expect(result!.addresses[0].id).toBe('addr-1')
    expect(result!.addresses[0].isDefault).toBe(true)
    expect(result!.addresses[1].label).toBe('Oficina')
  })

  it('returns customer + [] when the customer exists but has no addresses', async () => {
    const customerRow = {
      id: 'cust-1',
      phone: '3101234567',
      name: 'Juan',
      notes: null,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    }
    const queues: any[] = []
    queues.push(
      (() => {
        const promise: any = Promise.resolve({ data: customerRow, error: null })
        const chain: any = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = () => chain
        chain.then = promise.then.bind(promise)
        return chain
      })(),
      // empty addresses
      (() => {
        const promise: any = Promise.resolve({ data: [], error: null })
        const chain: any = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.in = () => chain
        chain.order = () => chain
        chain.then = promise.then.bind(promise)
        return chain
      })(),
    )
    state.fromImpl = () => queues.shift()

    const result = await findCustomerByPhone('3101234567')
    expect(result?.addresses).toEqual([])
  })

  it('maps P0002 -> not-found', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: 'P0002', message: 'not found' } })
      const chain: any = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await findCustomerByPhone('3101234567').catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-found')
  })

  it('maps 42501 -> not-authorized', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } })
      const chain: any = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await findCustomerByPhone('3101234567').catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-authorized')
  })
})

// -----------------------------------------------------------
// listCouriers
// -----------------------------------------------------------

describe('listCouriers', () => {
  it('lists every courier (active and inactive) when activeOnly=false', async () => {
    state.fromImpl = (table: string) => {
      expect(table).toBe('couriers')
      const promise: any = Promise.resolve({
        data: [
          {
            id: 'c-1',
            name: 'Pedro',
            phone: '3101111111',
            is_active: true,
            created_at: '2026-10-01T00:00:00.000Z',
            updated_at: '2026-10-01T00:00:00.000Z',
          },
          {
            id: 'c-2',
            name: 'Ana',
            phone: null,
            is_active: false,
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:00:00.000Z',
          },
        ],
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.order = (col: string, opts: { ascending: boolean }) => {
        expect(col).toBe('name')
        expect(opts).toEqual({ ascending: true })
        return chain
      }
      chain.then = promise.then.bind(promise)
      return chain
    }
    const couriers = await listCouriers({ activeOnly: false })
    expect(couriers).toHaveLength(2)
    expect(couriers[1].isActive).toBe(false)
  })

  it('filters is_active=true when activeOnly=true', async () => {
    const seen: { eq?: [string, unknown] } = {}
    state.fromImpl = (table: string) => {
      expect(table).toBe('couriers')
      const promise: any = Promise.resolve({
        data: [
          {
            id: 'c-1',
            name: 'Pedro',
            phone: null,
            is_active: true,
            created_at: '2026-10-01T00:00:00.000Z',
            updated_at: '2026-10-01T00:00:00.000Z',
          },
        ],
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        seen.eq = [col, val]
        expect(col).toBe('is_active')
        expect(val).toBe(true)
        return chain
      }
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const couriers = await listCouriers({ activeOnly: true })
    expect(seen.eq).toEqual(['is_active', true])
    expect(couriers).toHaveLength(1)
  })

  it('maps 42501 -> not-authorized', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } })
      const chain: any = {}
      chain.select = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listCouriers({ activeOnly: false }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-authorized')
  })

  it('throws when a courier row is malformed', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({
        data: [{ id: 'broken' }], // missing name / is_active / timestamps
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listCouriers({ activeOnly: false }).catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })
})

// -----------------------------------------------------------
// createCourier / updateCourier
// -----------------------------------------------------------
//
// Admin-only writes on public.couriers (RLS raises 42501 for every
// other role). The service trims the name and normalizes the phone
// before the INSERT/UPDATE, and parses the returned row.

const COURIER_ROW = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Pedro',
  phone: '3101234567',
  is_active: true,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
}

function writeChain(
  result: { data: unknown; error: unknown },
  seen: { insert?: unknown; update?: unknown; eq?: [string, unknown]; select?: string },
) {
  const promise: any = Promise.resolve(result)
  const chain: any = {}
  chain.insert = (rows: unknown) => { seen.insert = rows; return chain }
  chain.update = (patch: unknown) => { seen.update = patch; return chain }
  chain.eq = (col: string, val: unknown) => { seen.eq = [col, val]; return chain }
  chain.select = (cols: string) => { seen.select = cols; return chain }
  chain.single = () => chain
  chain.then = promise.then.bind(promise)
  return chain
}

describe('createCourier', () => {
  it('inserts the trimmed name and normalized phone into couriers', async () => {
    const seen: Parameters<typeof writeChain>[1] = {}
    state.fromImpl = (table: string) => {
      expect(table).toBe('couriers')
      return writeChain({ data: COURIER_ROW, error: null }, seen)
    }
    const created = await createCourier({ name: '  Pedro ', phone: '+57 310 123 4567' })
    expect(seen.insert).toEqual({ name: 'Pedro', phone: '3101234567' })
    expect(seen.select).toBe('id, name, phone, is_active, created_at, updated_at')
    expect(created.id).toBe(COURIER_ROW.id)
    expect(created.isActive).toBe(true)
  })

  it('sends phone: null when the phone is blank', async () => {
    const seen: Parameters<typeof writeChain>[1] = {}
    state.fromImpl = () => writeChain({ data: { ...COURIER_ROW, phone: null }, error: null }, seen)
    await createCourier({ name: 'Pedro', phone: '' })
    expect(seen.insert).toEqual({ name: 'Pedro', phone: null })
  })

  it('rejects an invalid name or phone without hitting the network', async () => {
    const empty = await createCourier({ name: ' ', phone: '' }).catch((e) => e)
    expect((empty as DeliveryServiceError).kind).toBe('invalid-input')
    const badPhone = await createCourier({ name: 'Pedro', phone: '123' }).catch((e) => e)
    expect((badPhone as DeliveryServiceError).kind).toBe('invalid-input')
    expect(state.from).not.toHaveBeenCalled()
  })

  it('maps 42501 -> not-authorized (non-admin caller)', async () => {
    state.fromImpl = () => writeChain({ data: null, error: { code: '42501', message: 'denied' } }, {})
    const err = await createCourier({ name: 'Pedro', phone: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('not-authorized')
  })

  it('maps 23514 -> invalid-input (server CHECK)', async () => {
    state.fromImpl = () => writeChain({ data: null, error: { code: '23514', message: 'check' } }, {})
    const err = await createCourier({ name: 'Pedro', phone: '' }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('throws when the inserted row is malformed', async () => {
    state.fromImpl = () => writeChain({ data: { id: 'broken' }, error: null }, {})
    const err = await createCourier({ name: 'Pedro', phone: '' }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })
})

describe('updateCourier', () => {
  it('patches only the supplied fields, by id', async () => {
    const seen: Parameters<typeof writeChain>[1] = {}
    state.fromImpl = (table: string) => {
      expect(table).toBe('couriers')
      return writeChain({ data: { ...COURIER_ROW, is_active: false }, error: null }, seen)
    }
    const updated = await updateCourier(COURIER_ROW.id, { isActive: false })
    expect(seen.update).toEqual({ is_active: false })
    expect(seen.eq).toEqual(['id', COURIER_ROW.id])
    expect(updated.isActive).toBe(false)
  })

  it('trims the name, normalizes the phone and clears a blank phone', async () => {
    const seen: Parameters<typeof writeChain>[1] = {}
    state.fromImpl = () => writeChain({ data: COURIER_ROW, error: null }, seen)
    await updateCourier(COURIER_ROW.id, { name: ' Pedro ', phone: '310 123 4567' })
    expect(seen.update).toEqual({ name: 'Pedro', phone: '3101234567' })
    await updateCourier(COURIER_ROW.id, { phone: '  ' })
    expect(seen.update).toEqual({ phone: null })
  })

  it('rejects an empty patch, a blank name or a bad phone without hitting the network', async () => {
    for (const patch of [{}, { name: '  ' }, { phone: '12' }]) {
      const err = await updateCourier(COURIER_ROW.id, patch).catch((e) => e)
      expect((err as DeliveryServiceError).kind).toBe('invalid-input')
    }
    expect(state.from).not.toHaveBeenCalled()
  })

  it('maps P0002/no row -> not-found and 42501 -> not-authorized', async () => {
    state.fromImpl = () => writeChain({ data: null, error: { code: 'PGRST116', message: 'no rows' } }, {})
    const missing = await updateCourier(COURIER_ROW.id, { isActive: true }).catch((e) => e)
    expect((missing as DeliveryServiceError).kind).toBe('not-found')
    state.fromImpl = () => writeChain({ data: null, error: { code: '42501', message: 'denied' } }, {})
    const denied = await updateCourier(COURIER_ROW.id, { isActive: true }).catch((e) => e)
    expect((denied as DeliveryServiceError).kind).toBe('not-authorized')
  })
})

// -----------------------------------------------------------
// createDeliveryOrder
// -----------------------------------------------------------
//
// Wire format: p_customer, p_address, p_items, p_delivery_fee,
// p_payment_mode, p_cash_change_for (only for COD), p_notes. The
// service remaps camelCase -> snake_case and the response back to
// camelCase. p_cash_change_for is null for prepaid.

describe('createDeliveryOrder', () => {
  it('calls rpc("create_delivery_order") with the exact snake_case args, mapping camelCase input', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        order_id: 'order-1',
        customer_id: 'cust-1',
        address_id: 'addr-1',
        delivery: {
          order_id: 'order-1',
          customer_id: 'cust-1',
          customer_name: 'Juan',
          customer_phone: '3101234567',
          address_line: 'Calle 5',
          neighborhood: 'Centro',
          address_reference: null,
          delivery_fee: 3000,
          payment_mode: 'cash_on_delivery',
          cash_change_for: 50000,
          courier_id: null,
          delivery_status: 'received',
          failure_reason: null,
          notes: null,
          dispatched_at: null,
          delivered_at: null,
          failed_at: null,
          cancelled_at: null,
          created_at: '2026-10-07T00:00:00.000Z',
          updated_at: '2026-10-07T00:00:00.000Z',
        },
      },
      error: null,
    })

    const result = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 2, comments: 'sin cebolla' }],
      deliveryFee: 3000,
      paymentMode: 'cash_on_delivery',
      cashChangeFor: 50000,
      notes: 'ring twice',
    })

    expect(state.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('create_delivery_order')
    expect(Object.keys(args).sort()).toEqual(
      ['p_address', 'p_cash_change_for', 'p_customer', 'p_delivery_fee', 'p_items', 'p_notes', 'p_payment_mode'].sort(),
    )
    expect(args.p_customer).toEqual({ id: 'cust-1' })
    expect(args.p_address).toEqual({ id: 'addr-1' })
    expect(args.p_items).toEqual([
      { dish_id: 'd-1', quantity: 2, comments: 'sin cebolla' },
    ])
    expect(args.p_delivery_fee).toBe(3000)
    expect(args.p_payment_mode).toBe('cash_on_delivery')
    expect(args.p_cash_change_for).toBe(50000)
    expect(args.p_notes).toBe('ring twice')

    expect(result.orderId).toBe('order-1')
    expect(result.customerId).toBe('cust-1')
    expect(result.addressId).toBe('addr-1')
    expect(result.delivery.status).toBe('received')
    expect(result.delivery.deliveryFee).toBe(3000)
    expect(result.delivery.paymentMode).toBe('cash_on_delivery')
    expect(result.delivery.cashChangeFor).toBe(50000)
  })

  it('sends p_cash_change_for: null and omits a stray notes key for prepaid orders', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        order_id: 'order-1',
        customer_id: 'cust-1',
        address_id: null,
        delivery: {
          order_id: 'order-1',
          customer_id: 'cust-1',
          customer_name: 'Juan',
          customer_phone: '3101234567',
          address_line: 'Calle 5',
          neighborhood: null,
          address_reference: null,
          delivery_fee: 3000,
          payment_mode: 'prepaid',
          cash_change_for: null,
          courier_id: null,
          delivery_status: 'received',
          failure_reason: null,
          notes: null,
          dispatched_at: null,
          delivered_at: null,
          failed_at: null,
          cancelled_at: null,
          created_at: '2026-10-07T00:00:00.000Z',
          updated_at: '2026-10-07T00:00:00.000Z',
        },
      },
      error: null,
    })

    await createDeliveryOrder({
      customer: { phone: '3101234567', name: 'Juan' },
      address: { addressLine: 'Calle 5', save: false },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 3000,
      paymentMode: 'prepaid',
    })
    const args = (state.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(args.p_customer).toEqual({ phone: '3101234567', name: 'Juan' })
    expect(args.p_address).toEqual({ address_line: 'Calle 5', save: false })
    expect(args.p_cash_change_for).toBeNull()
    // `notes` is still on the wire as null so the server-side btrim ->
    // null mapping runs.
    expect('p_notes' in args).toBe(true)
    expect(args.p_notes).toBeNull()
  })

  it('rejects empty items without hitting the network', async () => {
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('rejects negative deliveryFee without hitting the network', async () => {
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: -1,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('rejects cashChangeFor on a prepaid order without hitting the network', async () => {
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'prepaid',
      cashChangeFor: 10000,
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('throws a DeliveryServiceError when the RPC returns no order_id', async () => {
    state.rpc.mockResolvedValueOnce({ data: {}, error: null })
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })

  it('maps P0002 -> not-found (customer / address / dish missing)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'customer X not found' },
    })
    const err = await createDeliveryOrder({
      customer: { id: 'X' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-found')
  })

  it('maps P0001 -> rejected (business rule: same-state replay on the delivery mirror is the same code path)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'duplicate key on order_deliveries' },
    })
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('rejected')
  })

  it('maps 22023 -> invalid-input', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'p_customer.phone must match 7..15 digits' },
    })
    const err = await createDeliveryOrder({
      customer: { phone: 'bad' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('maps 42501 -> not-authorized', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-authorized')
  })

  it('preserves the raw supabase-js error as cause', async () => {
    const raw = { code: '42501', message: 'denied' }
    state.rpc.mockResolvedValueOnce({ data: null, error: raw })
    const err = await createDeliveryOrder({
      customer: { id: 'cust-1' },
      address: { id: 'addr-1' },
      items: [{ dishId: 'd-1', quantity: 1 }],
      deliveryFee: 0,
      paymentMode: 'cash_on_delivery',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).cause).toBe(raw)
  })
})

// -----------------------------------------------------------
// setDeliveryStatus
// -----------------------------------------------------------
//
// Same snake_case arg names the SQL function uses: p_order_id,
// p_action, p_courier_id (only for dispatch), p_reason (only for
// fail). Replays raise P0001 ('is already in state X') so the UI
// distinguishes them through a single error code path.

describe('setDeliveryStatus', () => {
  it('calls rpc("set_delivery_status") with start_preparing (no courierId / reason)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        order_id: 'order-1',
        customer_id: 'cust-1',
        customer_name: 'Juan',
        customer_phone: '3101234567',
        address_line: 'Calle 5',
        neighborhood: null,
        address_reference: null,
        delivery_fee: 3000,
        payment_mode: 'cash_on_delivery',
        cash_change_for: 50000,
        courier_id: null,
        delivery_status: 'preparing',
        failure_reason: null,
        notes: null,
        dispatched_at: null,
        delivered_at: null,
        failed_at: null,
        cancelled_at: null,
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
      },
      error: null,
    })
    const result = await setDeliveryStatus({ orderId: 'order-1', action: 'start_preparing' })
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('set_delivery_status')
    expect(Object.keys(args).sort()).toEqual(['p_action', 'p_courier_id', 'p_order_id', 'p_reason'].sort())
    expect(args.p_order_id).toBe('order-1')
    expect(args.p_action).toBe('start_preparing')
    expect(args.p_courier_id).toBeNull()
    expect(args.p_reason).toBeNull()
    expect(result.status).toBe('preparing')
  })

  it('sends p_courier_id on dispatch', async () => {
    state.rpc.mockResolvedValueOnce({
      data: makeWireDelivery('out_for_delivery'),
      error: null,
    })
    await setDeliveryStatus({
      orderId: 'order-1',
      action: 'dispatch',
      courierId: 'c-1',
    })
    const args = (state.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(args.p_courier_id).toBe('c-1')
    expect(args.p_reason).toBeNull()
  })

  it('sends p_reason on fail', async () => {
    state.rpc.mockResolvedValueOnce({
      data: makeWireDelivery('failed', { failure_reason: 'no estaba' }),
      error: null,
    })
    await setDeliveryStatus({
      orderId: 'order-1',
      action: 'fail',
      reason: 'no estaba',
    })
    const args = (state.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(args.p_reason).toBe('no estaba')
    expect(args.p_courier_id).toBeNull()
  })

  it('rejects an empty reason on fail without hitting the network', async () => {
    const err = await setDeliveryStatus({
      orderId: 'order-1',
      action: 'fail',
      reason: '   ',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing courierId on dispatch without hitting the network', async () => {
    const err = await setDeliveryStatus({
      orderId: 'order-1',
      action: 'dispatch',
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('rejects a reason longer than 200 chars on fail', async () => {
    const err = await setDeliveryStatus({
      orderId: 'order-1',
      action: 'fail',
      reason: 'x'.repeat(201),
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('maps P0001 -> rejected (already in state X / order already paid)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'delivery is already in state preparing' },
    })
    const err = await setDeliveryStatus({ orderId: 'order-1', action: 'start_preparing' }).catch(
      (e) => e,
    )
    expect((err as DeliveryServiceError).kind).toBe('rejected')
  })

  it('maps P0002 -> not-found (cross-tenant or missing order)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'delivery not found' },
    })
    const err = await setDeliveryStatus({ orderId: 'order-1', action: 'deliver' }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-found')
  })

  it('maps 22023 -> invalid-input (unknown action)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'unknown action foo' },
    })
    const err = await setDeliveryStatus({
      orderId: 'order-1',
      action: 'foo' as never,
    }).catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('invalid-input')
  })

  it('throws when the RPC returns a malformed row', async () => {
    state.rpc.mockResolvedValueOnce({ data: { order_id: 'broken' }, error: null })
    const err = await setDeliveryStatus({ orderId: 'order-1', action: 'start_preparing' }).catch(
      (e) => e,
    )
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })
})

function makeWireDelivery(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 'order-1',
    customer_id: 'cust-1',
    customer_name: 'Juan',
    customer_phone: '3101234567',
    address_line: 'Calle 5',
    neighborhood: null,
    address_reference: null,
    delivery_fee: 3000,
    payment_mode: 'cash_on_delivery',
    cash_change_for: 50000,
    courier_id: status === 'out_for_delivery' || status === 'delivered' || status === 'failed' ? 'c-1' : null,
    delivery_status: status,
    failure_reason: null,
    notes: null,
    dispatched_at: null,
    delivered_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
    ...overrides,
  }
}

// -----------------------------------------------------------
// listActiveDeliveries
// -----------------------------------------------------------
//
// Reads public.order_deliveries joined with a minimal orders block,
// filtering out terminal rows (delivered / cancelled) older than the
// start of "today". The service builds an OR filter:
//
//   NOT (delivery_status IN ('delivered','cancelled') AND updated_at < today_iso)
//

describe('listActiveDeliveries', () => {
  it('returns [] when the server returns an empty row set', async () => {
    // The default fromImpl resolves with { data: [], error: null }; this
    // test guards the empty-array path the operator board hits between
    // the first render and the realtime subscription landing.
    state.from.mockClear()
    const out = await listActiveDeliveries()
    expect(out).toEqual([])
  })

  it('reads order_deliveries joined with orders and applies the same-day filter', async () => {
    const seen: { select?: string[]; or?: string[] } = {}
    state.fromImpl = (table: string) => {
      expect(table).toBe('order_deliveries')
      const promise: any = Promise.resolve({
        data: [
          {
            ...makeWireDelivery('received'),
            orders: {
              id: 'order-1',
              subtotal: 10000,
              tax: 1900,
              tip: 0,
              total: 11900,
              status: 'kitchen',
            },
          },
        ],
        error: null,
      })
      const chain: any = {}
      chain.select = (cols: string) => {
        seen.select = (seen.select ?? []).concat(cols)
        return chain
      }
      chain.or = (filter: string) => {
        seen.or = (seen.or ?? []).concat(filter)
        // The OR filter must reference both terminal statuses and the
        // updated_at boundary.
        expect(filter).toMatch(/delivery_status/)
        expect(filter).toMatch(/updated_at/)
        return chain
      }
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const out = await listActiveDeliveries()
    expect(out).toHaveLength(1)
    expect(out[0].delivery.status).toBe('received')
    expect(out[0].amountDue).toBe(11900)
    expect(out[0].subtotal).toBe(10000)
    expect(out[0].tax).toBe(1900)
    expect(out[0].isPaid).toBe(false)
    // The join must read orders.status so the board can tell paid orders apart.
    expect(seen.select?.[0]).toMatch(/orders!inner\([^)]*\bstatus\b/)
  })

  it('flags isPaid only when orders.status is paid', async () => {
    const rows = [
      { ...makeWireDelivery('received'), order_id: 'o-paid', orders: { id: 'o-paid', subtotal: 1000, tax: 0, tip: 0, total: 1000, status: 'paid' } },
      { ...makeWireDelivery('received'), order_id: 'o-kitchen', orders: { id: 'o-kitchen', subtotal: 1000, tax: 0, tip: 0, total: 1000, status: 'kitchen' } },
    ]
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: rows, error: null })
      const chain: any = {}
      chain.select = () => chain
      chain.or = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const out = await listActiveDeliveries()
    expect(out.map((r) => r.isPaid)).toEqual([true, false])
  })

  it('rejects a row whose orders.status is not a string', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({
        data: [{ ...makeWireDelivery('received'), orders: { id: 'o', subtotal: 1000, tax: 0, tip: 0, total: 1000, status: null } }],
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.or = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listActiveDeliveries().catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })

  it('maps 42501 -> not-authorized', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } })
      const chain: any = {}
      chain.select = () => chain
      chain.or = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listActiveDeliveries().catch((e) => e)
    expect((err as DeliveryServiceError).kind).toBe('not-authorized')
  })

  it('throws when the row payload is malformed', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({
        data: [{ order_id: 'broken' }], // missing everything else
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.or = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listActiveDeliveries().catch((e) => e)
    expect(err).toBeInstanceOf(DeliveryServiceError)
    expect((err as DeliveryServiceError).kind).toBe('unknown')
  })
})

// -----------------------------------------------------------
// DeliveryServiceError shape sanity
// -----------------------------------------------------------

describe('DeliveryServiceError', () => {
  it('exposes the supplied kind, message and cause', () => {
    const cause = { code: '42501' }
    const err = new DeliveryServiceError({ kind: 'not-authorized', message: 'x', cause })
    expect(err).toBeInstanceOf(Error)
    expect(err.kind).toBe('not-authorized')
    expect(err.message).toBe('x')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('DeliveryServiceError')
  })
})