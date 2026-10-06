import { describe, expect, it } from 'vitest'
import {
  invoiceTendersFromPayOrder,
  invoiceTendersFromPayment,
  legacyInvoiceFields,
} from './invoice-tenders'
import type { PayOrderResult } from './types'
import type { PaymentRow } from './payment-list'

// Minimal catalog used by both helpers. The PayOrder path looks rows up
// by `code`; the PaymentRow path looks them up by `id`.
const CASH = { id: 'cash-id', code: 'cash', name: 'Efectivo', kind: 'cash' as const }
const NEQUI = { id: 'nequi-id', code: 'nequi', name: 'Nequi', kind: 'electronic' as const }
const TRANSFER = {
  id: 'transfer-id',
  code: 'transfer',
  name: 'Transferencia',
  kind: 'electronic' as const,
}
const CATALOG = [CASH, NEQUI, TRANSFER]

// -----------------------------------------------------------
// invoiceTendersFromPayOrder: build tenders from a server echo
// -----------------------------------------------------------
describe('invoiceTendersFromPayOrder', () => {
  it('single nequi line resolves name from the catalog (regression for the 7a bug)', () => {
    const result: PayOrderResult = {
      paymentId: 'p-1',
      status: 'paid',
      amountDue: 47000,
      tipAmount: 0,
      totalCharged: 47000,
      changeGiven: 0,
      drawerWarning: false,
      drawerCashBefore: 0,
      alreadyPaid: false,
      tenders: [
        { lineNo: 1, methodCode: 'nequi', amount: 47000, cashReceived: null },
      ],
    }
    const tenders = invoiceTendersFromPayOrder(result, CATALOG)
    expect(tenders).toEqual([
      {
        methodCode: 'nequi',
        methodName: 'Nequi',
        methodKind: 'electronic',
        amount: 47000,
        cashReceived: null,
      },
    ])
  })

  it('mixed cash + nequi with change preserves the cash line cashReceived', () => {
    const result: PayOrderResult = {
      paymentId: 'p-2',
      status: 'paid',
      amountDue: 47000,
      tipAmount: 0,
      totalCharged: 50000,
      changeGiven: 3000,
      drawerWarning: false,
      drawerCashBefore: 0,
      alreadyPaid: false,
      tenders: [
        { lineNo: 1, methodCode: 'nequi', amount: 30000, cashReceived: null },
        { lineNo: 2, methodCode: 'cash', amount: 17000, cashReceived: 20000 },
      ],
    }
    const tenders = invoiceTendersFromPayOrder(result, CATALOG)
    expect(tenders).toEqual([
      {
        methodCode: 'nequi',
        methodName: 'Nequi',
        methodKind: 'electronic',
        amount: 30000,
        cashReceived: null,
      },
      {
        methodCode: 'cash',
        methodName: 'Efectivo',
        methodKind: 'cash',
        amount: 17000,
        cashReceived: 20000,
      },
    ])
  })

  it('unknown code falls back to the code as the name and treats it as electronic', () => {
    const result: PayOrderResult = {
      paymentId: 'p-3',
      status: 'paid',
      amountDue: 1000,
      tipAmount: 0,
      totalCharged: 1000,
      changeGiven: 0,
      drawerWarning: false,
      drawerCashBefore: 0,
      alreadyPaid: false,
      tenders: [
        { lineNo: 1, methodCode: 'bitcoin', amount: 1000, cashReceived: null },
      ],
    }
    const tenders = invoiceTendersFromPayOrder(result, CATALOG)
    expect(tenders).toEqual([
      {
        methodCode: 'bitcoin',
        methodName: 'bitcoin',
        methodKind: 'electronic',
        amount: 1000,
        cashReceived: null,
      },
    ])
  })
})

// -----------------------------------------------------------
// invoiceTendersFromPayment: build tenders from a ledger row
// -----------------------------------------------------------
describe('invoiceTendersFromPayment', () => {
  it('resolves name by id from the catalog', () => {
    const payment: PaymentRow = {
      id: 'p-1',
      orderId: 'o-1',
      cashRegisterId: 'r-1',
      cashierProfileId: null,
      amountDue: 47000,
      tipAmount: 0,
      totalCharged: 47000,
      changeGiven: 0,
      idempotencyKey: 'k',
      createdAt: '2025-01-01T00:00:00Z',
      tenders: [
        {
          id: 't-1',
          paymentId: 'p-1',
          lineNo: 1,
          paymentMethodId: NEQUI.id,
          methodCode: 'nequi',
          methodKind: 'electronic',
          amount: 47000,
          cashReceived: null,
        },
      ],
    }
    const tenders = invoiceTendersFromPayment(payment, CATALOG)
    expect(tenders).toEqual([
      {
        methodCode: 'nequi',
        methodName: 'Nequi',
        methodKind: 'electronic',
        amount: 47000,
        cashReceived: null,
      },
    ])
  })

  it('falls back to the snapshot code when the catalog id is unknown', () => {
    const payment: PaymentRow = {
      id: 'p-2',
      orderId: 'o-2',
      cashRegisterId: 'r-1',
      cashierProfileId: null,
      amountDue: 1000,
      tipAmount: 0,
      totalCharged: 1000,
      changeGiven: 0,
      idempotencyKey: 'k',
      createdAt: '2025-01-01T00:00:00Z',
      tenders: [
        {
          id: 't-1',
          paymentId: 'p-2',
          lineNo: 1,
          paymentMethodId: 'orphan-id',
          methodCode: 'custom',
          methodKind: 'electronic',
          amount: 1000,
          cashReceived: null,
        },
      ],
    }
    const tenders = invoiceTendersFromPayment(payment, CATALOG)
    expect(tenders[0]).toMatchObject({
      methodCode: 'custom',
      methodName: 'custom',
      methodKind: 'electronic',
    })
  })

  it('falls back to the snapshot kind when the catalog id is unknown', () => {
    // The tender snapshot is the source of truth for the kind when the
    // catalog is missing the row; the helper must not lie about cash
    // just because the catalog is empty.
    const payment: PaymentRow = {
      id: 'p-3',
      orderId: 'o-3',
      cashRegisterId: 'r-1',
      cashierProfileId: null,
      amountDue: 1000,
      tipAmount: 0,
      totalCharged: 1000,
      changeGiven: 0,
      idempotencyKey: 'k',
      createdAt: '2025-01-01T00:00:00Z',
      tenders: [
        {
          id: 't-1',
          paymentId: 'p-3',
          lineNo: 1,
          paymentMethodId: 'orphan-id',
          methodCode: 'cash',
          methodKind: 'cash',
          amount: 1000,
          cashReceived: 1000,
        },
      ],
    }
    const tenders = invoiceTendersFromPayment(payment, CATALOG)
    expect(tenders[0]?.methodKind).toBe('cash')
  })

  it('works without a catalog (uses the snapshot for both name and kind)', () => {
    const payment: PaymentRow = {
      id: 'p-4',
      orderId: 'o-4',
      cashRegisterId: 'r-1',
      cashierProfileId: null,
      amountDue: 2000,
      tipAmount: 0,
      totalCharged: 2000,
      changeGiven: 0,
      idempotencyKey: 'k',
      createdAt: '2025-01-01T00:00:00Z',
      tenders: [
        {
          id: 't-1',
          paymentId: 'p-4',
          lineNo: 1,
          paymentMethodId: 'any-id',
          methodCode: 'nequi',
          methodKind: 'electronic',
          amount: 2000,
          cashReceived: null,
        },
      ],
    }
    const tenders = invoiceTendersFromPayment(payment)
    expect(tenders[0]).toEqual({
      methodCode: 'nequi',
      methodName: 'nequi',
      methodKind: 'electronic',
      amount: 2000,
      cashReceived: null,
    })
  })
})

// -----------------------------------------------------------
// legacyInvoiceFields: keep the old listener working
// -----------------------------------------------------------
describe('legacyInvoiceFields', () => {
  it('single nequi line -> paymentMethod "nequi" (regression for the 7a bug)', () => {
    const fields = legacyInvoiceFields([
      {
        methodCode: 'nequi',
        methodName: 'Nequi',
        methodKind: 'electronic',
        amount: 47000,
        cashReceived: null,
      },
    ])
    expect(fields.paymentMethod).toBe('nequi')
    expect(fields.cashReceived).toBeNull()
    expect(fields.cashChange).toBe(0)
  })

  it('mixed cash + nequi with change -> "multiple", sum cashReceived, total change', () => {
    const fields = legacyInvoiceFields([
      {
        methodCode: 'nequi',
        methodName: 'Nequi',
        methodKind: 'electronic',
        amount: 30000,
        cashReceived: null,
      },
      {
        methodCode: 'cash',
        methodName: 'Efectivo',
        methodKind: 'cash',
        amount: 17000,
        cashReceived: 20000,
      },
    ])
    expect(fields.paymentMethod).toBe('multiple')
    expect(fields.cashReceived).toBe(20000)
    expect(fields.cashChange).toBe(3000)
  })

  it('two cash lines sum their cashReceived and changes', () => {
    const fields = legacyInvoiceFields([
      {
        methodCode: 'cash',
        methodName: 'Efectivo',
        methodKind: 'cash',
        amount: 10000,
        cashReceived: 15000,
      },
      {
        methodCode: 'cash',
        methodName: 'Efectivo',
        methodKind: 'cash',
        amount: 5000,
        cashReceived: 5000,
      },
    ])
    expect(fields.paymentMethod).toBe('cash')
    expect(fields.cashReceived).toBe(20000)
    expect(fields.cashChange).toBe(5000)
  })

  it('cash line without cashReceived defaults to the amount (no change)', () => {
    const fields = legacyInvoiceFields([
      {
        methodCode: 'cash',
        methodName: 'Efectivo',
        methodKind: 'cash',
        amount: 8000,
        cashReceived: null,
      },
    ])
    expect(fields.paymentMethod).toBe('cash')
    expect(fields.cashReceived).toBe(8000)
    expect(fields.cashChange).toBe(0)
  })

  it('empty tenders -> safe defaults so old listeners do not crash', () => {
    const fields = legacyInvoiceFields([])
    expect(fields.paymentMethod).toBe('cash')
    expect(fields.cashReceived).toBeNull()
    expect(fields.cashChange).toBe(0)
  })
})
