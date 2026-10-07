import { describe, expect, it } from 'vitest'
import {
  canGiveChange,
  hasLegacy,
  parseRegisterSummary,
  registerSummaryQueryKey,
  summaryRows,
  tipsShortfall,
  validateRegisterSummaryShape,
} from './register-summary'

// -----------------------------------------------------------
// Sample payloads (server shape, snake_case)
// -----------------------------------------------------------

const SAMPLE_RAW = {
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
    {
      payment_method_id: 'm-old',
      code: 'old',
      name: 'Deprecated',
      kind: 'electronic',
      sort_order: 30,
      is_active: false,
      total: 0,
      tenders_count: 0,
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

describe('parseRegisterSummary', () => {
  it('maps a complete payload from the wire format to the camelCase client shape', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)

    expect(summary).toEqual({
      registersCount: 1,
      initialCash: 200000,
      paymentsCount: 3,
      totalBilled: 141000,
      totalTips: 10000,
      totalSales: 137000,
      totalChange: 4000,
      methods: [
        {
          paymentMethodId: 'm-cash',
          code: 'cash',
          name: 'Efectivo',
          kind: 'cash',
          sortOrder: 10,
          isActive: true,
          total: 100000,
          tendersCount: 2,
        },
        {
          paymentMethodId: 'm-nequi',
          code: 'nequi',
          name: 'Nequi',
          kind: 'electronic',
          sortOrder: 20,
          isActive: true,
          total: 37000,
          tendersCount: 1,
        },
        {
          paymentMethodId: 'm-old',
          code: 'old',
          name: 'Deprecated',
          kind: 'electronic',
          sortOrder: 30,
          isActive: false,
          total: 0,
          tendersCount: 0,
        },
      ],
      cashDeposits: 50000,
      cashWithdrawals: 20000,
      expectedCash: 330000,
      tipsPayout: 10000,
      expectedCashAfterTips: 320000,
      legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
    })
  })

  it('preserves the server-given methods order (no re-sort)', () => {
    // The server returns sort_order,name; the parser does NOT re-sort.
    const summary = parseRegisterSummary(SAMPLE_RAW)
    expect(summary.methods.map((m) => m.code)).toEqual(['cash', 'nequi', 'old'])
  })

  it('throws on null / non-object input', () => {
    expect(() => parseRegisterSummary(null)).toThrow(/register_summary/i)
    expect(() => parseRegisterSummary(undefined)).toThrow(/register_summary/i)
    expect(() => parseRegisterSummary('oops')).toThrow(/register_summary/i)
  })

  it('throws on missing required top-level fields', () => {
    const broken = { ...SAMPLE_RAW } as Record<string, unknown>
    delete broken.initial_cash
    expect(() => parseRegisterSummary(broken)).toThrow(/initial_cash/)
  })

  it('throws on a non-integer money field', () => {
    const broken = { ...SAMPLE_RAW, total_sales: 137000.5 }
    expect(() => parseRegisterSummary(broken)).toThrow(/total_sales/)
  })

  it('throws on a string where a money field is expected', () => {
    const broken = { ...SAMPLE_RAW, tips_payout: 'lots' }
    expect(() => parseRegisterSummary(broken)).toThrow(/tips_payout/)
  })

  it('throws on NaN money field', () => {
    const broken = { ...SAMPLE_RAW, expected_cash_after_tips: NaN }
    expect(() => parseRegisterSummary(broken)).toThrow(/expected_cash_after_tips/)
  })

  it('throws on a missing nested method field (payment_method_id)', () => {
    const broken = JSON.parse(JSON.stringify(SAMPLE_RAW))
    delete broken.methods[0].payment_method_id
    expect(() => parseRegisterSummary(broken)).toThrow(/payment_method_id/)
  })

  it('throws on a wrong-shaped legacy block', () => {
    const broken = { ...SAMPLE_RAW, legacy: { payments_count: 0 } } as unknown as typeof SAMPLE_RAW
    // "legacy" prefix lands on nested-field failures inside the block.
    expect(() => parseRegisterSummary(broken)).toThrow(/legacy/)
  })

  it('throws when legacy is not an object at all', () => {
    const broken = { ...SAMPLE_RAW, legacy: 'nope' } as unknown as typeof SAMPLE_RAW
    expect(() => parseRegisterSummary(broken)).toThrow(/legacy/)
  })

  it('accepts a zero-sale register with no methods entries', () => {
    const empty = {
      ...SAMPLE_RAW,
      registers_count: 0,
      payments_count: 0,
      total_billed: 0,
      total_tips: 0,
      total_sales: 0,
      total_change: 0,
      initial_cash: 0,
      cash_deposits: 0,
      cash_withdrawals: 0,
      expected_cash: 0,
      tips_payout: 0,
      expected_cash_after_tips: 0,
      methods: [],
    }
    const summary = parseRegisterSummary(empty)
    expect(summary.methods).toEqual([])
    expect(summary.expectedCash).toBe(0)
  })
})

describe('validateRegisterSummaryShape', () => {
  it('returns true for a valid payload', () => {
    expect(validateRegisterSummaryShape(SAMPLE_RAW)).toBe(true)
  })

  it('returns false for invalid input without throwing', () => {
    expect(validateRegisterSummaryShape(null)).toBe(false)
    expect(validateRegisterSummaryShape({ ...SAMPLE_RAW, total_sales: 1.5 })).toBe(false)
  })
})

describe('summaryRows', () => {
  it('returns every method whose total is > 0', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)
    expect(summaryRows(summary).map((m) => m.code)).toEqual(['cash', 'nequi'])
  })

  it('keeps active methods with total=0 so the catalog is fully visible', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)
    // 'old' is inactive+0: filtered out.
    expect(summaryRows(summary).some((m) => m.code === 'old')).toBe(false)
    // Synthesize: flip 'old' to active and re-run the rows helper.
    const withActive: any = JSON.parse(JSON.stringify(SAMPLE_RAW))
    withActive.methods[2].is_active = true
    const s2 = parseRegisterSummary(withActive)
    expect(summaryRows(s2).some((m) => m.code === 'old')).toBe(true)
  })
})

describe('hasLegacy', () => {
  it('returns true when the legacy section has payments_count > 0', () => {
    const withLegacy = JSON.parse(JSON.stringify(SAMPLE_RAW))
    withLegacy.legacy = {
      payments_count: 1,
      total: 1000,
      tips: 0,
      change: 0,
      by_method: { cash: 1000 },
    }
    const summary = parseRegisterSummary(withLegacy)
    expect(hasLegacy(summary)).toBe(true)
  })

  it('returns false for an empty legacy section', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)
    expect(hasLegacy(summary)).toBe(false)
  })
})

describe('tipsShortfall', () => {
  it('returns 0 when expected_cash_after_tips is positive', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)
    expect(tipsShortfall(summary)).toBe(0)
  })

  it('returns the magnitude of a negative expected_cash_after_tips', () => {
    const short = JSON.parse(JSON.stringify(SAMPLE_RAW))
    short.expected_cash_after_tips = -5000
    const summary = parseRegisterSummary(short)
    expect(tipsShortfall(summary)).toBe(5000)
  })
})

describe('canGiveChange', () => {
  it('returns true when expected_cash covers the change', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW) // expected_cash = 330000
    expect(canGiveChange(summary, 50000)).toBe(true)
  })

  it('returns false when expected_cash is below the change', () => {
    const summary = parseRegisterSummary(SAMPLE_RAW)
    expect(canGiveChange(summary, 400000)).toBe(false)
  })

  it('uses expected_cash (NOT expected_cash_after_tips): tips stay in the drawer during the shift', () => {
    // Same as the sample, but tips ate the entire cash on hand. expected_cash=330000
    // and tips_payout=expected_cash, so expected_cash_after_tips=0. The drawer still
    // holds the tips until the close pays them out, so canGiveChange should still
    // pass for a small amount.
    const withAllTipsPaidOut = JSON.parse(JSON.stringify(SAMPLE_RAW))
    withAllTipsPaidOut.tips_payout = withAllTipsPaidOut.expected_cash
    withAllTipsPaidOut.expected_cash_after_tips = 0
    const summary = parseRegisterSummary(withAllTipsPaidOut)
    expect(canGiveChange(summary, 100000)).toBe(true)
  })

  it('returns true for a zero change amount even when expected_cash is 0', () => {
    const zero = JSON.parse(JSON.stringify(SAMPLE_RAW))
    zero.initial_cash = 0
    zero.expected_cash = 0
    zero.expected_cash_after_tips = 0
    const summary = parseRegisterSummary(zero)
    expect(canGiveChange(summary, 0)).toBe(true)
  })
})

describe('registerSummaryQueryKey', () => {
  it('builds a stable key with the ids in canonical order', () => {
    expect(registerSummaryQueryKey(['a', 'b'])).toEqual(['register-summary', 'a', 'b'])
    expect(registerSummaryQueryKey(['b', 'a'])).toEqual(['register-summary', 'a', 'b'])
  })

  it('returns the prefix only when given an empty array', () => {
    expect(registerSummaryQueryKey([])).toEqual(['register-summary'])
  })
})