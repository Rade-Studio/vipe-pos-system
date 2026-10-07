/**
 * `register_summary` / `close_register` client helpers.
 *
 * Pure parsing + derivation only: no Supabase, no React, no DOM. The wire
 * format is the migration's, NOT this file's. The server's
 * `register_summary(p_cash_register_ids uuid[])` returns a jsonb object
 * with snake_case keys and bigint money fields (whole Colombian pesos);
 * we normalize it to camelCase and guard the shape so a malformed payload
 * is a hard failure, not a silent zero.
 *
 * `parseRegisterSummary` is strict: every required top-level field and
 * every method entry must be present and integer-valued. The methods
 * array keeps the server-given order (sort_order, name on the server),
 * so the parser does not re-sort.
 *
 * UI helpers:
 *   - `summaryRows(summary)`  -> methods to render (total > 0 OR active)
 *   - `hasLegacy(summary)`   -> true when the legacy block has rows
 *   - `tipsShortfall(summary)` -> max(0, -expected_cash_after_tips)
 *   - `canGiveChange(summary, change)` -> expected_cash >= change
 *     (drawer holds tips during the shift; tips_payout only fires at close)
 *   - `registerSummaryQueryKey(ids)` -> TanStack-Query key builder
 */

import { PaymentMethodKind } from './types'

// -----------------------------------------------------------
// Wire format (snake_case, what the server returns)
// -----------------------------------------------------------

interface WireRegisterMethod {
  payment_method_id: string
  code: string
  name: string
  kind: PaymentMethodKind
  sort_order: number
  is_active: boolean
  total: number
  tenders_count: number
}

interface WireLegacySection {
  payments_count: number
  total: number
  tips: number
  change: number
  by_method: Record<string, number>
}

interface WireRegisterSummary {
  registers_count: number
  initial_cash: number
  payments_count: number
  total_billed: number
  total_tips: number
  total_sales: number
  total_change: number
  methods: WireRegisterMethod[]
  cash_deposits: number
  cash_withdrawals: number
  expected_cash: number
  tips_payout: number
  expected_cash_after_tips: number
  legacy: WireLegacySection
}

// -----------------------------------------------------------
// Client shape (camelCase, what the UI consumes)
// -----------------------------------------------------------

export interface RegisterMethodSummary {
  paymentMethodId: string
  code: string
  name: string
  kind: PaymentMethodKind
  sortOrder: number
  isActive: boolean
  total: number
  tendersCount: number
}

export interface RegisterLegacySummary {
  paymentsCount: number
  total: number
  tips: number
  change: number
  byMethod: Record<string, number>
}

export interface RegisterSummary {
  registersCount: number
  initialCash: number
  paymentsCount: number
  totalBilled: number
  totalTips: number
  totalSales: number
  totalChange: number
  methods: RegisterMethodSummary[]
  cashDeposits: number
  cashWithdrawals: number
  expectedCash: number
  tipsPayout: number
  expectedCashAfterTips: number
  legacy: RegisterLegacySummary
}

// -----------------------------------------------------------
// Strict validators (throw on bad shape)
// -----------------------------------------------------------

function fail(message: string): never {
  throw new Error(`register_summary: ${message}`)
}

function isIntegerMoney(n: unknown, field: string): n is number {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    fail(`${field} must be a finite integer (whole COP pesos); got ${JSON.stringify(n)}`)
  }
  return true
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireIntegerMoneyField(
  obj: Record<string, unknown>,
  field: string,
): number {
  if (!(field in obj)) fail(`missing field: ${field}`)
  const v = obj[field]
  if (!isIntegerMoney(v, field)) return 0 as never
  return v
}

function parseWireMethod(raw: unknown, index: number): RegisterMethodSummary {
  const obj = requireObject(raw, `methods[${index}]`)
  if (typeof obj.payment_method_id !== 'string' || obj.payment_method_id === '') {
    fail(`methods[${index}].payment_method_id must be a non-empty string`)
  }
  if (typeof obj.code !== 'string' || obj.code === '') {
    fail(`methods[${index}].code must be a non-empty string`)
  }
  if (typeof obj.name !== 'string' || obj.name === '') {
    fail(`methods[${index}].name must be a non-empty string`)
  }
  if (obj.kind !== 'cash' && obj.kind !== 'electronic') {
    fail(`methods[${index}].kind must be "cash" | "electronic"; got ${JSON.stringify(obj.kind)}`)
  }
  const sortOrder = requireIntegerMoneyField(obj, 'sort_order')
  if (typeof obj.is_active !== 'boolean') {
    fail(`methods[${index}].is_active must be a boolean`)
  }
  const total = requireIntegerMoneyField(obj, 'total')
  const tendersCount = requireIntegerMoneyField(obj, 'tenders_count')
  return {
    paymentMethodId: obj.payment_method_id,
    code: obj.code,
    name: obj.name,
    kind: obj.kind,
    sortOrder,
    isActive: obj.is_active,
    total,
    tendersCount,
  }
}

function parseLegacySection(raw: unknown): RegisterLegacySummary {
  const obj = requireObject(raw, 'legacy')
  const requireMoneyField = (name: string): number => {
    if (!(name in obj)) fail(`legacy.${name} is required`)
    const v = obj[name]
    if (!isIntegerMoney(v, `legacy.${name}`)) return 0 as never
    return v
  }
  const paymentsCount = requireMoneyField('payments_count')
  const total = requireMoneyField('total')
  const tips = requireMoneyField('tips')
  const change = requireMoneyField('change')
  const byMethodRaw = obj.by_method
  if (byMethodRaw === null || typeof byMethodRaw !== 'object' || Array.isArray(byMethodRaw)) {
    fail('legacy.by_method must be an object')
  }
  const byMethod: Record<string, number> = {}
  for (const [k, v] of Object.entries(byMethodRaw as Record<string, unknown>)) {
    if (!isIntegerMoney(v, `legacy.by_method.${k}`)) continue // unreachable: fail throws
    byMethod[k] = v
  }
  return { paymentsCount, total, tips, change, byMethod }
}

/**
 * Parse the server's snake_case jsonb payload into the camelCase client
 * shape. Throws on missing fields, wrong types, or non-integer money
 * values. The methods array keeps the order the server gave us.
 */
export function parseRegisterSummary(raw: unknown): RegisterSummary {
  const obj = requireObject(raw, 'register_summary')
  const methodsRaw = obj.methods
  if (!Array.isArray(methodsRaw)) {
    fail('methods must be an array')
  }
  const methods = methodsRaw.map((m, i) => parseWireMethod(m, i))

  return {
    registersCount: requireIntegerMoneyField(obj, 'registers_count'),
    initialCash: requireIntegerMoneyField(obj, 'initial_cash'),
    paymentsCount: requireIntegerMoneyField(obj, 'payments_count'),
    totalBilled: requireIntegerMoneyField(obj, 'total_billed'),
    totalTips: requireIntegerMoneyField(obj, 'total_tips'),
    totalSales: requireIntegerMoneyField(obj, 'total_sales'),
    totalChange: requireIntegerMoneyField(obj, 'total_change'),
    methods,
    cashDeposits: requireIntegerMoneyField(obj, 'cash_deposits'),
    cashWithdrawals: requireIntegerMoneyField(obj, 'cash_withdrawals'),
    expectedCash: requireIntegerMoneyField(obj, 'expected_cash'),
    tipsPayout: requireIntegerMoneyField(obj, 'tips_payout'),
    expectedCashAfterTips: requireIntegerMoneyField(obj, 'expected_cash_after_tips'),
    legacy: parseLegacySection(obj.legacy),
  }
}

/**
 * Boolean form of parseRegisterSummary: true when the payload is valid,
 * false otherwise. Use in places where a malformed payload should not
 * throw (e.g. gating a query behind "is the response shape sane?").
 */
export function validateRegisterSummaryShape(raw: unknown): raw is WireRegisterSummary {
  try {
    parseRegisterSummary(raw)
    return true
  } catch {
    return false
  }
}

// -----------------------------------------------------------
// UI helpers (small, pure)
// -----------------------------------------------------------

/**
 * The methods to render in the close-register dialog and the admin
 * reports. A method with sales (total > 0) is always shown; a method
 * with zero sales is shown only when it is still active in the
 * catalog (so the close dialog can show "Efectivo: $0" when no cash
 * sales happened). The server already returns the methods in catalog
 * order (sort_order, name), so we preserve that order here.
 */
export function summaryRows(summary: RegisterSummary): RegisterMethodSummary[] {
  return summary.methods.filter((m) => m.total > 0 || m.isActive)
}

/**
 * Legacy rows live in `payment_transactions`, the old money path. They
 * do NOT contribute to `expected_cash` (see the migration's COMMENT),
 * and the UI only renders them as a separate read-only block when
 * there is at least one legacy payment.
 */
export function hasLegacy(summary: RegisterSummary): boolean {
  return summary.legacy.paymentsCount > 0
}

/**
 * The amount by which the drawer is short of paying out the tips at
 * close. Tips are paid to waiters when the register closes
 * (`tips_payout = total_tips`); if `expected_cash_after_tips` goes
 * negative, the UI surfaces the magnitude here as a non-blocking
 * warning. Zero when the drawer's expected cash covers the tips.
 */
export function tipsShortfall(summary: RegisterSummary): number {
  if (summary.expectedCashAfterTips >= 0) return 0
  return -summary.expectedCashAfterTips
}

/**
 * Drawer-can-give-change check. Uses `expected_cash` (NOT
 * `expected_cash_after_tips`) on purpose: the tips are still in the
 * drawer during the shift, they only leave at close. A non-blocking
 * UI check; the server is still the authority on what actually
 * happens when a pay_order lands.
 */
export function canGiveChange(summary: RegisterSummary, change: number): boolean {
  if (change <= 0) return true
  return summary.expectedCash >= change
}

// -----------------------------------------------------------
// Query key (exported so others can invalidate)
// -----------------------------------------------------------

/**
 * TanStack-Query key builder for the register-summary query. Ids are
 * sorted so the key is stable regardless of the order callers use,
 * which matters for cache hits across re-renders that swap the id
 * order. An empty array returns the prefix only, so an
 * `invalidateQueries({ queryKey: ['register-summary'] })` clears
 * every cached summary at once.
 */
export function registerSummaryQueryKey(ids: string[]): readonly (string | number)[] {
  if (ids.length === 0) return ['register-summary']
  return ['register-summary', ...[...ids].sort()]
}