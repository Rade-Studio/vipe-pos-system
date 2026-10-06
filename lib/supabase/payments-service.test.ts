import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PaymentServiceError,
  listPaymentMethods,
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
  type FromChain = {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>
    }
  }
  const defaultFrom = (_table: string): FromChain => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
    }),
  })
  return {
    rpc: vi.fn(),
    from: vi.fn(),
    fromImpl: defaultFrom as (table: string) => FromChain,
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
  state.fromImpl = (_table: string) => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
    }),
  })
})

// -----------------------------------------------------------
// listPaymentMethods
// -----------------------------------------------------------

describe('listPaymentMethods', () => {
  it('queries the payment_methods table, ordered by sort_order, and remaps to camelCase', async () => {
    state.fromImpl = (table: string) => {
      expect(table).toBe('payment_methods')
      return {
        select: (cols: string) => {
          expect(cols).toBe('id, code, name, kind, is_active, sort_order')
          return {
            order: (col: string, opts: { ascending: boolean }) => {
              expect(col).toBe('sort_order')
              expect(opts).toEqual({ ascending: true })
              return Promise.resolve({
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
            },
          }
        },
      }
    }

    const methods = await listPaymentMethods()
    expect(methods).toEqual([
      { id: 'm1', code: 'cash', name: 'Efectivo', kind: 'cash', isActive: true, sortOrder: 10 },
      { id: 'm2', code: 'nequi', name: 'Nequi', kind: 'electronic', isActive: true, sortOrder: 30 },
    ])
  })

  it('throws a PaymentServiceError on read error', async () => {
    state.fromImpl = () => ({
      select: () => ({
        order: () =>
          Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }),
      }),
    })
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
