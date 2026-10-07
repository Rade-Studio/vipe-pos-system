import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PaymentServiceError,
  closeRegisterRpc,
  createPaymentMethod,
  getPaymentsByOrderIds,
  getRegisterSummary,
  listPaymentMethods,
  listRegisterPayments,
  payOrder,
  reorderPaymentMethods,
  splitOrder,
  undoSplit,
  updatePaymentMethod,
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
  // A thenable chain that supports select / eq / in / order / insert /
  // update / single and resolves with the configured { data, error }
  // pair. The promise is created up front and every method returns the
  // same chain so the result is inspectable from inside a callback
  // without re-importing the module.
  type Chain = {
    select: (cols: string) => Chain
    eq: (col: string, val: unknown) => Chain
    in: (col: string, vals: unknown[]) => Chain
    order: (col: string, opts: { ascending: boolean }) => Chain
    insert: (rows: unknown) => Chain
    update: (patch: unknown) => Chain
    single: () => Chain
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
    chain.insert = () => chain
    chain.update = () => chain
    chain.single = () => chain
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
    chain.insert = () => chain
    chain.update = () => chain
    chain.single = () => chain
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

// -----------------------------------------------------------
// createPaymentMethod
// -----------------------------------------------------------
//
// Inserts a new payment-method row. The service first reads the
// existing catalog (to compute the unique `code` and pick
// max(sort_order) + 1), then inserts. The test installs a stateful
// `from` mock that hands the read chain to the first call and the
// insert chain to the second.

function makeListChain(data: unknown[]): { chain: any; seen: { select: string[]; order: Array<[string, { ascending: boolean }]> } } {
  const seen = { select: [] as string[], order: [] as Array<[string, { ascending: boolean }]> }
  const promise: any = Promise.resolve({ data, error: null })
  const chain: any = {}
  chain.select = (cols: string) => {
    seen.select.push(cols)
    return chain
  }
  chain.order = (col: string, opts: { ascending: boolean }) => {
    seen.order.push([col, opts])
    return chain
  }
  chain.then = promise.then.bind(promise)
  return { chain, seen }
}

function makeInsertChain(
  returnedRow: unknown,
  error: unknown = null,
): { chain: any; seen: { inserted: unknown; select: string[] } } {
  const seen = { inserted: undefined as unknown, select: [] as string[] }
  const promise: any = Promise.resolve({ data: returnedRow, error })
  const chain: any = {}
  chain.insert = (rows: unknown) => {
    seen.inserted = rows
    return chain
  }
  chain.select = (cols: string) => {
    seen.select.push(cols)
    return chain
  }
  chain.single = () => chain
  chain.then = promise.then.bind(promise)
  return { chain, seen }
}

function makeUpdateChain(
  returnedRow: unknown,
  error: unknown = null,
): { chain: any; seen: { updated: unknown; eq: Array<[string, unknown]>; select: string[] } } {
  const seen = { updated: undefined as unknown, eq: [] as Array<[string, unknown]>, select: [] as string[] }
  const promise: any = Promise.resolve({ data: returnedRow, error })
  const chain: any = {}
  chain.update = (patch: unknown) => {
    seen.updated = patch
    return chain
  }
  chain.eq = (col: string, val: unknown) => {
    seen.eq.push([col, val])
    return chain
  }
  chain.select = (cols: string) => {
    seen.select.push(cols)
    return chain
  }
  chain.single = () => chain
  chain.then = promise.then.bind(promise)
  return { chain, seen }
}

describe('createPaymentMethod', () => {
  it('generates a unique code from the name, picks max(sort_order)+1, inserts, and remaps to camelCase', async () => {
    const existing = [
      { id: 'm1', code: 'cash', name: 'Efectivo', kind: 'cash', is_active: true, sort_order: 10 },
      { id: 'm2', code: 'nequi', name: 'Nequi', kind: 'electronic', is_active: true, sort_order: 20 },
    ]
    const insertedRow = {
      id: 'm3',
      code: 'tarjeta',
      name: 'Tarjeta',
      kind: 'electronic',
      is_active: true,
      sort_order: 21,
    }
    const list = makeListChain(existing)
    const ins = makeInsertChain(insertedRow)

    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      return queues.shift() ?? ins.chain
    }

    const result = await createPaymentMethod({ name: 'Tarjeta', kind: 'electronic' })
    expect(list.seen.select).toEqual(['id, code, name, kind, is_active, sort_order'])
    expect(list.seen.order).toEqual([['sort_order', { ascending: true }]])
    expect(ins.seen.inserted).toEqual({
      name: 'Tarjeta',
      code: 'tarjeta',
      kind: 'electronic',
      sort_order: 21,
    })
    expect(ins.seen.select).toEqual(['id, code, name, kind, is_active, sort_order'])
    expect(result).toEqual({
      id: 'm3',
      code: 'tarjeta',
      name: 'Tarjeta',
      kind: 'electronic',
      isActive: true,
      sortOrder: 21,
    })
  })

  it('suffixes _2 on the generated code when the base collides', async () => {
    const existing = [
      { id: 'm1', code: 'tarjeta', name: 'Tarjeta', kind: 'electronic', is_active: true, sort_order: 30 },
    ]
    const list = makeListChain(existing)
    const ins = makeInsertChain({
      id: 'm2',
      code: 'tarjeta_2',
      name: 'Tarjeta',
      kind: 'electronic',
      is_active: true,
      sort_order: 31,
    })
    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      return queues.shift() ?? ins.chain
    }

    await createPaymentMethod({ name: 'Tarjeta', kind: 'electronic' })
    expect((ins.seen.inserted as { code: string; sort_order: number }).code).toBe('tarjeta_2')
    expect((ins.seen.inserted as { code: string; sort_order: number }).sort_order).toBe(31)
  })

  it('rejects an empty name with invalid-input without hitting the network', async () => {
    const err = await createPaymentMethod({ name: '   ', kind: 'cash' }).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
    expect(state.from).not.toHaveBeenCalled()
  })

  it('maps 23505 (unique violation on code) -> rejected', async () => {
    const list = makeListChain([])
    const ins = makeInsertChain(null, { code: '23505', message: 'duplicate key' })
    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (_table: string) => queues.shift() ?? ins.chain
    const err = await createPaymentMethod({ name: 'Efectivo', kind: 'cash' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('rejected')
    expect((err as PaymentServiceError).message).toBe('duplicate key')
  })

  it('maps 23514 (check_violation) -> invalid-input', async () => {
    const list = makeListChain([])
    const ins = makeInsertChain(null, {
      code: '23514',
      message: 'new row for relation "payment_methods" violates check constraint',
    })
    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (_table: string) => queues.shift() ?? ins.chain
    const err = await createPaymentMethod({ name: 'X', kind: 'cash' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
  })

  it('maps 42501 -> not-authorized', async () => {
    const list = makeListChain([])
    const ins = makeInsertChain(null, { code: '42501', message: 'permission denied' })
    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (_table: string) => queues.shift() ?? ins.chain
    const err = await createPaymentMethod({ name: 'Efectivo', kind: 'cash' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
  })

  it('throws a PaymentServiceError when the insert returns no row', async () => {
    const list = makeListChain([])
    const ins = makeInsertChain(null)
    const queues: any[] = [list.chain, ins.chain]
    state.fromImpl = (_table: string) => queues.shift() ?? ins.chain
    const err = await createPaymentMethod({ name: 'Efectivo', kind: 'cash' }).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentServiceError)
    expect((err as PaymentServiceError).kind).toBe('unknown')
  })
})

// -----------------------------------------------------------
// updatePaymentMethod
// -----------------------------------------------------------

describe('updatePaymentMethod', () => {
  it('patches name (trimmed) without sending code (immutable)', async () => {
    const upd = makeUpdateChain({
      id: 'm1',
      code: 'cash',
      name: 'Efectivo Pesos',
      kind: 'cash',
      is_active: true,
      sort_order: 10,
    })
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      return upd.chain
    }

    const result = await updatePaymentMethod('m1', { name: '  Efectivo Pesos  ' })
    expect(upd.seen.updated).toEqual({ name: 'Efectivo Pesos' })
    expect(upd.seen.eq).toEqual([['id', 'm1']])
    expect(upd.seen.select).toEqual(['id, code, name, kind, is_active, sort_order'])
    expect(result).toEqual({
      id: 'm1',
      code: 'cash',
      name: 'Efectivo Pesos',
      kind: 'cash',
      isActive: true,
      sortOrder: 10,
    })
  })

  it('patches is_active (camelCase) to is_active (snake_case) on the wire', async () => {
    const upd = makeUpdateChain({
      id: 'm1',
      code: 'nequi',
      name: 'Nequi',
      kind: 'electronic',
      is_active: false,
      sort_order: 30,
    })
    state.fromImpl = () => upd.chain

    const result = await updatePaymentMethod('m1', { isActive: false })
    expect(upd.seen.updated).toEqual({ is_active: false })
    expect(result.isActive).toBe(false)
  })

  it('rejects an empty patch with invalid-input without hitting the network', async () => {
    const err = await updatePaymentMethod('m1', {}).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
    expect(state.from).not.toHaveBeenCalled()
  })

  it('rejects an empty name with invalid-input without hitting the network', async () => {
    const err = await updatePaymentMethod('m1', { name: '   ' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
    expect(state.from).not.toHaveBeenCalled()
  })

  it('maps 23505 (unique_violation on code immutability) -> rejected', async () => {
    const upd = makeUpdateChain(null, { code: '23505', message: 'duplicate key' })
    state.fromImpl = () => upd.chain
    const err = await updatePaymentMethod('m1', { name: 'X' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('rejected')
  })

  it('maps 23514 (check_violation) -> invalid-input', async () => {
    const upd = makeUpdateChain(null, { code: '23514', message: 'name too long' })
    state.fromImpl = () => upd.chain
    const err = await updatePaymentMethod('m1', { name: 'X' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('invalid-input')
  })

  it('maps 42501 -> not-authorized (the BEFORE UPDATE trigger raising insufficient_privilege on code edits)', async () => {
    const upd = makeUpdateChain(null, { code: '42501', message: 'payment_methods.code is immutable' })
    state.fromImpl = () => upd.chain
    const err = await updatePaymentMethod('m1', { name: 'X' }).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
  })
})

// -----------------------------------------------------------
// reorderPaymentMethods
// -----------------------------------------------------------

describe('reorderPaymentMethods', () => {
  it('runs a sequential UPDATE per change with snake_case sort_order', async () => {
    const upd1 = makeUpdateChain(null)
    const upd2 = makeUpdateChain(null)
    const queues: any[] = [upd1.chain, upd2.chain]
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      return queues.shift() ?? upd2.chain
    }

    await reorderPaymentMethods([
      { id: 'm1', sortOrder: 0 },
      { id: 'm2', sortOrder: 1 },
    ])

    expect(upd1.seen.updated).toEqual({ sort_order: 0 })
    expect(upd1.seen.eq).toEqual([['id', 'm1']])
    expect(upd2.seen.updated).toEqual({ sort_order: 1 })
    expect(upd2.seen.eq).toEqual([['id', 'm2']])
  })

  it('is a no-op for an empty changes list', async () => {
    state.from.mockClear()
    await reorderPaymentMethods([])
    expect(state.from).not.toHaveBeenCalled()
  })

  it('maps 42501 -> not-authorized on the first failing update', async () => {
    const upd1 = makeUpdateChain(null, { code: '42501', message: 'permission denied' })
    state.fromImpl = () => upd1.chain
    const err = await reorderPaymentMethods([{ id: 'm1', sortOrder: 5 }]).catch((e) => e)
    expect((err as PaymentServiceError).kind).toBe('not-authorized')
  })
})
