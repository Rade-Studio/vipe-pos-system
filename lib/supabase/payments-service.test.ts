import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PaymentServiceError,
  closeRegisterRpc,
  getPaymentsByOrderIds,
  getRegisterSummary,
  listPaymentMethods,
  listRegisterPayments,
  payOrder,
  splitOrder,
  undoSplit,
} from './payments-service'
import type { PaymentMethodOption, PayOrderTenderLine } from '@/lib/payments/types'

// -----------------------------------------------------------
// Mock the Supabase browser client.
// -----------------------------------------------------------
// We only assert the contract: the right RPC name, the exact snake_case
// arg names the server migration defines, and a clean error-code -> kind
// mapping. The whole network surface is replaced so this test runs in
// the node env and is deterministic.
//
// The chain is hoisted + mutable so each test can install a fresh
// `from`/`rpc` implementation without re-importing the module.

const state = vi.hoisted(() => {
  // A thenable chain that supports select / eq / in / order and resolves
  // with the configured { data, error } pair. The promise is created up
  // front and every method returns the same chain so the result is
  // inspectable from inside a callback without re-importing the module.
  type Chain = {
    select: (cols: string) => Chain
    eq: (col: string, val: unknown) => Chain
    in: (col: string, vals: unknown[]) => Chain
    order: (col: string, opts: { ascending: boolean }) => Chain
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
    chain.order = () => chain
    chain.then = promise.then.bind(promise)
    return chain as Chain
  }
  const defaultFrom = (_table: string): Chain => makeChain()
  return {
    rpc: vi.fn(),
    from: vi.fn(),
    fromImpl: defaultFrom as (table: string) => Chain,
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
    chain.order = () => chain
    chain.then = promise.then.bind(promise)
    return chain
  }
})

// -----------------------------------------------------------
// listPaymentMethods
// -----------------------------------------------------------

describe('listPaymentMethods', () => {
  it('queries the payment_methods table, ordered by sort_order, and remaps to camelCase', async () => {
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      const promise: any = Promise.resolve({
        data: [
          {
            id: 'm1',
            code: 'cash',
            name: 'Efectivo',
            kind: 'cash',
            is_active: true,
            sort_order: 10,
          },
          {
            id: 'm2',
            code: 'nequi',
            name: 'Nequi',
            kind: 'electronic',
            is_active: true,
            sort_order: 30,
          },
        ],
        error: null,
      })
      const chain: any = {}
      chain.select = (cols: string) => {
        expect(cols).toBe('id, code, name, kind, is_active, sort_order')
        return chain
      }
      chain.order = (col: string, opts: { ascending: boolean }) => {
        expect(col).toBe('sort_order')
        expect(opts).toEqual({ ascending: true })
        return chain
      }
      chain.then = promise.then.bind(promise)
      return chain
    }

    const methods = await listPaymentMethods()
    expect(methods).toEqual([
      { id: 'm1', code: 'cash', name: 'Efectivo', kind: 'cash', isActive: true, sortOrder: 10 },
      { id: 'm2', code: 'nequi', name: 'Nequi', kind: 'electronic', isActive: true, sortOrder: 30 },
    ])
  })

  it('throws a PaymentServiceError on read error', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } })
      const chain: any = {}
      chain.select = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    await expect(listPaymentMethods()).rejects.toBeInstanceOf(PaymentServiceError)
  })
})

// -----------------------------------------------------------
// payOrder
// -----------------------------------------------------------

// A wire-format pair: electronic + cash, produced by buildPayOrderTenders.
// The service is the last hop and takes this shape verbatim.
const TENDERS: PayOrderTenderLine[] = [
  { payment_method_id: 'm-nequi', amount: 30000, cash_received: null },
  { payment_method_id: 'm-cash', amount: 17000, cash_received: 20000 },
]

describe('payOrder', () => {
  it('throws a PaymentServiceError when the RPC returns no data and no error', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: null })

    const call = payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    })

    await expect(call).rejects.toBeInstanceOf(PaymentServiceError)
    await expect(call).rejects.toMatchObject({ kind: 'unknown' })
  })

  it('throws a PaymentServiceError when the RPC returns an object without payment_id', async () => {
    state.rpc.mockResolvedValueOnce({ data: {}, error: null })
    const call = payOrder({ orderId: 'o-1', cashRegisterId: 'r-1', tip: 0, tenders: TENDERS, idempotencyKey: 'k-1' })
    await expect(call).rejects.toBeInstanceOf(PaymentServiceError)
  })

  it('calls rpc("pay_order") with the exact snake_case arg names the server expects', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        payment_id: 'p1',
        status: 'paid',
        amount_due: 47000,
        tip_amount: 0,
        total_charged: 47000,
        change_given: 3000,
        drawer_warning: false,
        drawer_cash_before: 100000,
        tenders: [
          { line_no: 1, method_code: 'nequi', amount: 30000, cash_received: null },
          { line_no: 2, method_code: 'cash', amount: 17000, cash_received: 20000 },
        ],
      },
      error: null,
    })

    const result = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    })

    expect(state.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('pay_order')
    expect(Object.keys(args).sort()).toEqual(
      ['p_cash_register_id', 'p_idempotency_key', 'p_order_id', 'p_tenders', 'p_tip_amount'].sort(),
    )
    expect(args.p_order_id).toBe('o-1')
    expect(args.p_cash_register_id).toBe('r-1')
    expect(args.p_tip_amount).toBe(0)
    expect(args.p_idempotency_key).toBe('k-1')
    expect(args.p_tenders).toEqual(TENDERS)

    expect(result).toEqual({
      paymentId: 'p1',
      status: 'paid',
      amountDue: 47000,
      tipAmount: 0,
      totalCharged: 47000,
      changeGiven: 3000,
      drawerWarning: false,
      drawerCashBefore: 100000,
      alreadyPaid: false,
      tenders: [
        { lineNo: 1, methodCode: 'nequi', amount: 30000, cashReceived: null },
        { lineNo: 2, methodCode: 'cash', amount: 17000, cashReceived: 20000 },
      ],
    })
  })

  it('maps status=already_paid to alreadyPaid=true', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        payment_id: 'p1',
        status: 'already_paid',
        amount_due: 47000,
        tip_amount: 0,
        total_charged: 47000,
        change_given: 0,
        drawer_warning: false,
        drawer_cash_before: 0,
        tenders: [{ line_no: 1, method_code: 'cash', amount: 47000, cash_received: 47000 }],
      },
      error: null,
    })
    const result = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: [{ payment_method_id: 'm-cash', amount: 47000, cash_received: 47000 }],
      idempotencyKey: 'k-1',
    })
    expect(result.alreadyPaid).toBe(true)
    expect(result.status).toBe('already_paid')
  })

  it('maps 42501 -> not-authorized', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
    expect((err as PaymentServiceError).message).toBe('permission denied')
  })

  it('maps P0002 -> not-found (cross-tenant or missing order)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'order x not found' },
    })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-found')
  })

  it('maps P0001 -> rejected and keeps the server message', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'tenders sum to 100 but amount_due + tip = 47000' },
    })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('rejected')
    expect((err as PaymentServiceError).message).toMatch(/tenders sum/)
  })

  it('maps 22023 -> invalid-input', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'p_tip_amount must be a non-negative integer' },
    })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: -1,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
  })

  it('maps unknown codes to unknown', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P9999', message: 'something broke' },
    })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })

  it('preserves the raw supabase-js error as cause', async () => {
    const raw = { code: '42501', message: 'denied', details: null, hint: null }
    state.rpc.mockResolvedValueOnce({ data: null, error: raw })
    const err = await payOrder({
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      tip: 0,
      tenders: TENDERS,
      idempotencyKey: 'k-1',
    }).catch((e) => e)
    expect((err as PaymentServiceError).cause).toBe(raw)
  })
})

// -----------------------------------------------------------
// splitOrder / undoSplit
// -----------------------------------------------------------

describe('splitOrder', () => {
  it('calls rpc("split_order") with exact snake_case arg names and maps the response', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        child_order_id: 'c-1',
        parent: { order_id: 'p-1', subtotal: 15000, tax: 2850, tip: 0, total: 17850 },
        child: { order_id: 'c-1', subtotal: 5000, tax: 950, tip: 0, total: 5950 },
      },
      error: null,
    })
    const result = await splitOrder({
      parentOrderId: 'p-1',
      items: [{ orderItemId: 'oi-1', quantity: 2 }],
    })
    expect(state.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('split_order')
    expect(Object.keys(args).sort()).toEqual(['p_items', 'p_parent_order_id'].sort())
    expect(args.p_parent_order_id).toBe('p-1')
    expect(args.p_items).toEqual([{ order_item_id: 'oi-1', quantity: 2 }])
    expect(result).toEqual({
      childOrderId: 'c-1',
      parent: { orderId: 'p-1', subtotal: 15000, tax: 2850, tip: 0, total: 17850 },
      child: { orderId: 'c-1', subtotal: 5000, tax: 950, tip: 0, total: 5950 },
    })
  })

  it('maps P0002 -> not-found', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'order p-1 not found' },
    })
    const err = await splitOrder({
      parentOrderId: 'p-1',
      items: [{ orderItemId: 'oi-1', quantity: 1 }],
    }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-found')
  })
})

describe('undoSplit', () => {
  it('calls rpc("undo_split") with the exact snake_case arg name and maps the response', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        parent: { order_id: 'p-1', subtotal: 20000, tax: 3800, tip: 0, total: 23800 },
      },
      error: null,
    })
    const result = await undoSplit({ childOrderId: 'c-1' })
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('undo_split')
    expect(Object.keys(args)).toEqual(['p_child_order_id'])
    expect(args.p_child_order_id).toBe('c-1')
    expect(result).toEqual({
      parent: { orderId: 'p-1', subtotal: 20000, tax: 3800, tip: 0, total: 23800 },
    })
  })

  it('maps P0001 -> rejected', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'order c-1 is not a partial order' },
    })
    const err = await undoSplit({ childOrderId: 'c-1' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('rejected')
  })
})

// -----------------------------------------------------------
// Sanity: PaymentServiceError shape.
// -----------------------------------------------------------

describe('PaymentServiceError', () => {
  it('exposes the supplied kind, message and cause', () => {
    const cause = { code: '42501' }
    const err = new PaymentServiceError({ kind: 'not-authorized', message: 'x', cause })
    expect(err).toBeInstanceOf(Error)
    expect(err.kind).toBe('not-authorized')
    expect(err.message).toBe('x')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('PaymentServiceError')
  })
})

// Touch the local type so future refactors that drop the catalog import
// surface it as a TS error rather than a silent unused-import.
const _example: PaymentMethodOption[] = []
void _example

// -----------------------------------------------------------
// getRegisterSummary
// -----------------------------------------------------------

const SAMPLE_SUMMARY = {
  registers_count: 1,
  initial_cash: 200000,
  payments_count: 3,
  total_billed: 141000,
  total_tips: 10000,
  total_sales: 137000,
  total_change: 4000,
  methods: [
    {
      payment_method_id: 'm-cash',
      code: 'cash',
      name: 'Efectivo',
      kind: 'cash',
      sort_order: 10,
      is_active: true,
      total: 100000,
      tenders_count: 2,
    },
    {
      payment_method_id: 'm-nequi',
      code: 'nequi',
      name: 'Nequi',
      kind: 'electronic',
      sort_order: 20,
      is_active: true,
      total: 37000,
      tenders_count: 1,
    },
  ],
  cash_deposits: 50000,
  cash_withdrawals: 20000,
  expected_cash: 330000,
  tips_payout: 10000,
  expected_cash_after_tips: 320000,
  legacy: {
    payments_count: 0,
    total: 0,
    tips: 0,
    change: 0,
    by_method: {},
  },
}

describe('getRegisterSummary', () => {
  it('rejects an empty ids array without hitting the network', async () => {
    state.rpc.mockClear()
    await expect(getRegisterSummary([])).rejects.toBeInstanceOf(PaymentServiceError)
    await expect(getRegisterSummary([])).rejects.toMatchObject({ kind: 'invalid-input' })
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('calls rpc("register_summary") with snake_case args and remaps to camelCase', async () => {
    state.rpc.mockResolvedValueOnce({ data: SAMPLE_SUMMARY, error: null })

    const summary = await getRegisterSummary(['r-1'])
    expect(state.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('register_summary')
    expect(Object.keys(args)).toEqual(['p_cash_register_ids'])
    expect(args.p_cash_register_ids).toEqual(['r-1'])

    expect(summary.registersCount).toBe(1)
    expect(summary.initialCash).toBe(200000)
    expect(summary.totalSales).toBe(137000)
    expect(summary.expectedCash).toBe(330000)
    expect(summary.expectedCashAfterTips).toBe(320000)
    expect(summary.methods.map((m) => m.code)).toEqual(['cash', 'nequi'])
    expect(summary.methods[0]).toMatchObject({
      code: 'cash',
      kind: 'cash',
      isActive: true,
      total: 100000,
      tendersCount: 2,
    })
    expect(summary.legacy.paymentsCount).toBe(0)
  })

  it('throws a PaymentServiceError when the RPC returns no registers_count', async () => {
    state.rpc.mockResolvedValueOnce({ data: {}, error: null })
    const err = await getRegisterSummary(['r-1']).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })

  it('throws a PaymentServiceError when the RPC returns a malformed summary', async () => {
    const broken = { ...SAMPLE_SUMMARY, methods: [{ payment_method_id: 'x' }] } // missing required fields
    state.rpc.mockResolvedValueOnce({ data: broken, error: null })
    const err = await getRegisterSummary(['r-1']).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })

  it('maps P0002 -> not-found (foreign-tenant or missing register id)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'cash register(s) not found' },
    })
    const err = await getRegisterSummary(['r-other']).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-found')
    expect((err as PaymentServiceError).message).toMatch(/not found/i)
  })

  it('maps 42501 -> not-authorized', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const err = await getRegisterSummary(['r-1']).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
  })

  it('maps 22023 -> invalid-input (bad shape from the server)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'ids must not contain duplicates' },
    })
    const err = await getRegisterSummary(['r-1', 'r-1']).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
  })
})

// -----------------------------------------------------------
// closeRegisterRpc
// -----------------------------------------------------------

describe('closeRegisterRpc', () => {
  it('calls rpc("close_register") with snake_case args and returns the server final_cash', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        status: 'closed',
        cash_register_id: 'r-1',
        final_cash: 320000,
        summary: SAMPLE_SUMMARY,
      },
      error: null,
    })

    const result = await closeRegisterRpc('r-1')
    expect(state.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('close_register')
    expect(Object.keys(args)).toEqual(['p_cash_register_id'])
    expect(args.p_cash_register_id).toBe('r-1')

    expect(result.status).toBe('closed')
    expect(result.cashRegisterId).toBe('r-1')
    expect(result.finalCash).toBe(320000)
    expect(result.summary.expectedCashAfterTips).toBe(320000)
  })

  it('returns status="already_closed" on the idempotent replay', async () => {
    state.rpc.mockResolvedValueOnce({
      data: {
        status: 'already_closed',
        cash_register_id: 'r-1',
        final_cash: 300000,
        summary: SAMPLE_SUMMARY,
      },
      error: null,
    })
    const result = await closeRegisterRpc('r-1')
    expect(result.status).toBe('already_closed')
    expect(result.finalCash).toBe(300000)
  })

  it('throws when the RPC returns no status (requireData guard)', async () => {
    state.rpc.mockResolvedValueOnce({ data: {}, error: null })
    const err = await closeRegisterRpc('r-1').catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })

  it('maps P0002 -> not-found', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'cash register r-1 not found' },
    })
    const err = await closeRegisterRpc('r-1').catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-found')
  })

  it('maps P0001 -> rejected (e.g. trying to close a closed one mid-flight)', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'register r-1 already closed' },
    })
    const err = await closeRegisterRpc('r-1').catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('rejected')
  })
})

// -----------------------------------------------------------
// listRegisterPayments
// -----------------------------------------------------------
//
// Reads public.payments joined to public.payment_tenders for one or more
// cash registers, ordered by created_at desc. Empty ids short-circuit so
// the hook never fires a network request for the registration when the
// cashier/admin UI has nothing selected yet.

describe('listRegisterPayments', () => {
  it('short-circuits when ids is empty (no network call)', async () => {
    state.from.mockClear()
    const out = await listRegisterPayments([])
    expect(out).toEqual([])
    expect(state.from).not.toHaveBeenCalled()
  })

  it('selects the payments + nested tenders columns, filters by cash_register_id in(ids), orders created_at desc, and remaps to camelCase', async () => {
    const wireRows = [
      {
        id: 'pay-1',
        order_id: 'ord-1',
        cash_register_id: 'r-1',
        cashier_profile_id: 'prof-1',
        amount_due: 40000,
        tip_amount: 5000,
        total_charged: 45000,
        change_given: 5000,
        idempotency_key: 'idem-1',
        created_at: '2026-10-06T12:00:00.000Z',
        payment_tenders: [
          {
            id: 't1',
            payment_id: 'pay-1',
            line_no: 1,
            payment_method_id: 'm-cash',
            method_code: 'cash',
            method_kind: 'cash',
            amount: 20000,
            cash_received: 25000,
          },
          {
            id: 't2',
            payment_id: 'pay-1',
            line_no: 2,
            payment_method_id: 'm-nequi',
            method_code: 'nequi',
            method_kind: 'electronic',
            amount: 25000,
            cash_received: null,
          },
        ],
      },
    ]

    state.fromImpl = (table: string) => {
      expect(table).toBe('payments')
      const calls: Array<{ method: string; args: unknown[] }> = []
      const promise: any = Promise.resolve({ data: wireRows, error: null })
      const chain: any = {}
      chain.select = (cols: string) => {
        calls.push({ method: 'select', args: [cols] })
        expect(cols).toBe(
          'id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given, idempotency_key, created_at, payment_tenders(*)',
        )
        return chain
      }
      chain.in = (col: string, vals: unknown[]) => {
        calls.push({ method: 'in', args: [col, vals] })
        expect(col).toBe('cash_register_id')
        expect(vals).toEqual(['r-1', 'r-2'])
        return chain
      }
      chain.order = (col: string, opts: { ascending: boolean }) => {
        calls.push({ method: 'order', args: [col, opts] })
        expect(col).toBe('created_at')
        expect(opts).toEqual({ ascending: false })
        return chain
      }
      chain.then = promise.then.bind(promise)
      return chain
    }

    const out = await listRegisterPayments(['r-1', 'r-2'])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('pay-1')
    expect(out[0].tenders).toHaveLength(2)
    expect(out[0].tenders[0]).toEqual({
      id: 't1',
      paymentId: 'pay-1',
      lineNo: 1,
      paymentMethodId: 'm-cash',
      methodCode: 'cash',
      methodKind: 'cash',
      amount: 20000,
      cashReceived: 25000,
    })
    expect(out[0].tenders[1].methodKind).toBe('electronic')
    expect(out[0].tenders[1].cashReceived).toBeNull()
  })

  it('throws a PaymentServiceError on read error', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } })
      const chain: any = {}
      chain.select = () => chain
      chain.in = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listRegisterPayments(['r-1']).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
  })

  it('throws a PaymentServiceError when the rows are malformed', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({
        data: [{ id: 'broken' }], // missing required fields
        error: null,
      })
      const chain: any = {}
      chain.select = () => chain
      chain.in = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await listRegisterPayments(['r-1']).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })
})

// -----------------------------------------------------------
// getPaymentsByOrderIds
// -----------------------------------------------------------
//
// Same read as listRegisterPayments but filtered by order_id in(ids) -
// drives the per-order method label on CompletedOrdersTable.

describe('getPaymentsByOrderIds', () => {
  it('short-circuits when orderIds is empty (no network call)', async () => {
    state.from.mockClear()
    const out = await getPaymentsByOrderIds([])
    expect(out).toEqual([])
    expect(state.from).not.toHaveBeenCalled()
  })

  it('selects payments + tenders, filters by order_id in(ids), orders created_at desc', async () => {
    const wireRows = [
      {
        id: 'pay-1',
        order_id: 'ord-1',
        cash_register_id: 'r-1',
        cashier_profile_id: 'prof-1',
        amount_due: 40000,
        tip_amount: 5000,
        total_charged: 45000,
        change_given: 5000,
        idempotency_key: 'idem-1',
        created_at: '2026-10-06T12:00:00.000Z',
        payment_tenders: [
          {
            id: 't1',
            payment_id: 'pay-1',
            line_no: 1,
            payment_method_id: 'm-cash',
            method_code: 'cash',
            method_kind: 'cash',
            amount: 45000,
            cash_received: 50000,
          },
        ],
      },
    ]

    state.fromImpl = (table: string) => {
      expect(table).toBe('payments')
      const promise: any = Promise.resolve({ data: wireRows, error: null })
      const chain: any = {}
      chain.select = (cols: string) => {
        expect(cols).toBe(
          'id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given, idempotency_key, created_at, payment_tenders(*)',
        )
        return chain
      }
      chain.in = (col: string, vals: unknown[]) => {
        expect(col).toBe('order_id')
        expect(vals).toEqual(['ord-1'])
        return chain
      }
      chain.order = (col: string, opts: { ascending: boolean }) => {
        expect(col).toBe('created_at')
        expect(opts).toEqual({ ascending: false })
        return chain
      }
      chain.then = promise.then.bind(promise)
      return chain
    }

    const out = await getPaymentsByOrderIds(['ord-1'])
    expect(out).toHaveLength(1)
    expect(out[0].orderId).toBe('ord-1')
    expect(out[0].tenders[0].methodCode).toBe('cash')
  })

  it('maps P0002 -> not-found', async () => {
    state.fromImpl = () => {
      const promise: any = Promise.resolve({ data: null, error: { code: 'P0002', message: 'orders not found' } })
      const chain: any = {}
      chain.select = () => chain
      chain.in = () => chain
      chain.order = () => chain
      chain.then = promise.then.bind(promise)
      return chain
    }
    const err = await getPaymentsByOrderIds(['ord-1']).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-found')
  })
})
