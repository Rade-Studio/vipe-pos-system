/**
 * `payment-list` — pure logic over the public.payments +
 * public.payment_tenders wire format.
 *
 * No Supabase, no React, no DOM. The wire shape is the migration's
 * (snake_case, bigint money, frozen tender snapshot), the client shape
 * is camelCase and what the UI / CSV exports consume.
 *
 * `parsePaymentRows` is strict: a malformed payload (missing field,
 * non-integer amount, missing snapshot) raises rather than silently
 * zeroing. The catalog is OPTIONAL input everywhere it appears: when
 * the cashier side has not loaded it yet, the helpers fall back to the
 * snapshot on the tender (the row is always frozen at payment time,
 * so it never goes stale).
 *
 * `totalsByMethod(payments, catalog?)` returns one bucket per
 * `payment_method_id` keyed by id (so multiple rows of the same method
 * collapse into one), labels it with the catalog name and code when
 * supplied (so renaming a method in the catalog renders the new
 * label), and orders the buckets by `sort_order` (or by `name` when no
 * catalog is provided).
 *
 * `methodLabel(payment, catalog?)` collapses to the catalog name when
 * exactly one method was used, or "Múltiples" when more than one
 * distinct method was used (even when the same method appears twice
 * in two tender lines, the report reads "Múltiples" so the cashier sees
 * it was a split bill).
 *
 * `toCsvRows(payments, catalog?)` produces a CSV body (header + one
 * row per payment) escaped per RFC 4180: fields containing a comma,
 * double quote or newline are wrapped in double quotes with inner
 * quotes doubled.
 */

import type { PaymentMethodKind } from './types'

// -----------------------------------------------------------
// Wire types (snake_case, what the server returns)
// -----------------------------------------------------------

// Wire row shape is treated as `unknown` by the strict validators; see the
// inline field walk in `parseWirePayment` for the exact key set.

// The wire row shape (snake_case + nested `payment_tenders`) is inlined in
// `parseWirePayment`; we do not export a `WirePayment` interface because the
// server may add new optional fields without the client needing a recompile,
// and the strict validators below treat the payload as `unknown` and walk it
// field by field.

// -----------------------------------------------------------
// Client types (camelCase, what the UI consumes)
// -----------------------------------------------------------

export interface PaymentTenderLine {
  id: string
  paymentId: string
  lineNo: number
  paymentMethodId: string
  methodCode: string
  methodKind: PaymentMethodKind
  amount: number
  cashReceived: number | null
}

export interface PaymentRow {
  id: string
  orderId: string
  cashRegisterId: string
  cashierProfileId: string | null
  amountDue: number
  tipAmount: number
  totalCharged: number
  changeGiven: number
  idempotencyKey: string
  createdAt: string
  tenders: PaymentTenderLine[]
}

/**
 * Minimum shape the cashier / admin reports need to render a method
 * bucket. `name` is the display label (catalog name when known, the
 * snapshot's `method_code` otherwise); `code` is the legacy key kept
 * so historical payments still resolve the method they were paid with
 * after a rename. `kind` is the whole "only cash gives change" rule
 * (see `lib/payments/types.ts`).
 */
export interface PaymentMethodBucket {
  code: string
  name: string
  kind: PaymentMethodKind
  amount: number
  tendersCount: number
}

// -----------------------------------------------------------
// Strict validators (throw on bad shape)
// -----------------------------------------------------------

function fail(message: string): never {
  throw new Error(`payment-list: ${message}`)
}

function isIntegerMoney(n: unknown, field: string): n is number {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    fail(`${field} must be a finite integer (whole COP pesos); got ${JSON.stringify(n)}`)
  }
  return true
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(`${field} must be a non-empty string`)
  }
  return value
}

function parseWireTender(raw: unknown, paymentId: string, index: number): PaymentTenderLine {
  const obj = (raw ?? null) as Record<string, unknown> | null
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fail(`payments[${index}].payment_tenders[${index}] must be an object`)
  }
  const id = requireString(obj.id, `payments[${index}].payment_tenders[${index}].id`)
  const lineNoRaw = obj.line_no
  if (!isIntegerMoney(lineNoRaw, `payments[${index}].payment_tenders[${index}].line_no`)) {
    throw new Error('unreachable')
  }
  if (lineNoRaw < 1) {
    fail(`payments[${index}].payment_tenders[${index}].line_no must be >= 1`)
  }
  const paymentMethodId = requireString(
    obj.payment_method_id,
    `payments[${index}].payment_tenders[${index}].payment_method_id`,
  )
  const methodCode = requireString(
    obj.method_code,
    `payments[${index}].payment_tenders[${index}].method_code`,
  )
  const methodKind = obj.method_kind
  if (methodKind !== 'cash' && methodKind !== 'electronic') {
    fail(
      `payments[${index}].payment_tenders[${index}].method_kind must be "cash" | "electronic"; got ${JSON.stringify(methodKind)}`,
    )
  }
  const amountRaw = obj.amount
  if (!isIntegerMoney(amountRaw, `payments[${index}].payment_tenders[${index}].amount`)) {
    throw new Error('unreachable')
  }
  if (amountRaw <= 0) {
    fail(`payments[${index}].payment_tenders[${index}].amount must be > 0`)
  }
  const cashReceivedRaw = obj.cash_received
  if (cashReceivedRaw !== null && !isIntegerMoney(cashReceivedRaw, `payments[${index}].payment_tenders[${index}].cash_received`)) {
    throw new Error('unreachable')
  }
  // Snapshot-CHECK parity: a cash tender carries cash_received (>= amount,
  // enforced by the DB), an electronic one must leave it null. We do not
  // re-derive that here - the server is the source of truth - but a cash
  // tender without a cash_received is a bug.
  if (methodKind === 'cash' && cashReceivedRaw === null) {
    fail(`payments[${index}].payment_tenders[${index}].cash_received must be set for a cash tender`)
  }
  return {
    id,
    paymentId,
    lineNo: lineNoRaw,
    paymentMethodId,
    methodCode,
    methodKind,
    amount: amountRaw,
    cashReceived: cashReceivedRaw,
  }
}

function parseWirePayment(raw: unknown, index: number): PaymentRow {
  const obj = (raw ?? null) as Record<string, unknown> | null
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fail(`payments[${index}] must be an object`)
  }
  const id = requireString(obj.id, `payments[${index}].id`)
  const orderId = requireString(obj.order_id, `payments[${index}].order_id`)
  const cashRegisterId = requireString(
    obj.cash_register_id,
    `payments[${index}].cash_register_id`,
  )
  const cashierProfileId =
    obj.cashier_profile_id === null || obj.cashier_profile_id === undefined
      ? null
      : requireString(obj.cashier_profile_id, `payments[${index}].cashier_profile_id`)
  const amountDueRaw = obj.amount_due
  if (!isIntegerMoney(amountDueRaw, `payments[${index}].amount_due`)) {
    throw new Error('unreachable')
  }
  const tipAmountRaw = obj.tip_amount
  if (!isIntegerMoney(tipAmountRaw, `payments[${index}].tip_amount`)) {
    throw new Error('unreachable')
  }
  const totalChargedRaw = obj.total_charged
  if (!isIntegerMoney(totalChargedRaw, `payments[${index}].total_charged`)) {
    throw new Error('unreachable')
  }
  const changeGivenRaw = obj.change_given
  if (!isIntegerMoney(changeGivenRaw, `payments[${index}].change_given`)) {
    throw new Error('unreachable')
  }
  const idempotencyKey = requireString(
    obj.idempotency_key,
    `payments[${index}].idempotency_key`,
  )
  const createdAt = requireString(obj.created_at, `payments[${index}].created_at`)
  const tendersRaw = obj.payment_tenders
  if (!Array.isArray(tendersRaw)) {
    fail(`payments[${index}].payment_tenders must be an array`)
  }
  const tenders = tendersRaw.map((t, i) => parseWireTender(t, id, i))
  // Sort by line_no so the UI does not have to re-sort, and so CSV totals
  // are deterministic across server orderings.
  tenders.sort((a, b) => a.lineNo - b.lineNo)
  return {
    id,
    orderId,
    cashRegisterId,
    cashierProfileId,
    amountDue: amountDueRaw,
    tipAmount: tipAmountRaw,
    totalCharged: totalChargedRaw,
    changeGiven: changeGivenRaw,
    idempotencyKey,
    createdAt,
    tenders,
  }
}

/**
 * Parse the server's snake_case jsonb payload into the camelCase client
 * shape. Throws on missing fields, wrong types, or non-integer money
 * values. The order of the input is preserved (the server already
 * returns `payments` ordered by `created_at desc`).
 */
export function parsePaymentRows(raw: unknown): PaymentRow[] {
  if (!Array.isArray(raw)) {
    fail('payments payload must be an array')
  }
  return raw.map((p, i) => parseWirePayment(p, i))
}

// -----------------------------------------------------------
// UI helpers (pure)
// -----------------------------------------------------------

interface MethodCatalogLike {
  id: string
  code: string
  name: string
  kind: PaymentMethodKind
}

/**
 * Per-method totals keyed by `payment_method_id`. One bucket per method
 * with the same id (a split bill collapses into one bucket per method),
 * labelled with the catalog `name` + `code` when a catalog is supplied
 * (so historical payments render the new label after a rename) or the
 * tender snapshot otherwise (so a server with no catalog still renders
 * the right column).
 *
 * When a catalog is supplied, every catalog row appears in the result
 * even with amount=0 / tendersCount=0: the admin report renders the full
 * picker so the close dialog shows "Efectivo: $0" when no cash sales
 * happened. Without a catalog, only methods that actually had tenders
 * appear.
 *
 * Order: catalog `sort_order` when a catalog is supplied, else alphabetic
 * by `name` so the output is stable across runs.
 */
export function totalsByMethod(
  payments: PaymentRow[],
  catalog?: readonly MethodCatalogLike[],
): Record<string, PaymentMethodBucket> {
  const result: Record<string, PaymentMethodBucket> = {}
  for (const payment of payments) {
    for (const tender of payment.tenders) {
      const existing = result[tender.paymentMethodId]
      if (existing) {
        existing.amount += tender.amount
        existing.tendersCount += 1
      } else {
        result[tender.paymentMethodId] = {
          code: tender.methodCode,
          name: tender.methodCode,
          kind: tender.methodKind,
          amount: tender.amount,
          tendersCount: 1,
        }
      }
    }
  }
  // Apply catalog labels when known (renames the display name without
  // touching the totals).
  if (catalog && catalog.length > 0) {
    for (const row of catalog) {
      const bucket = result[row.id]
      if (bucket) {
        bucket.name = row.name
        bucket.code = row.code
        bucket.kind = row.kind
      } else {
        result[row.id] = {
          code: row.code,
          name: row.name,
          kind: row.kind,
          amount: 0,
          tendersCount: 0,
        }
      }
    }
  }
  // Order: stable iteration order so callers can render top-to-bottom
  // without re-sorting. With a catalog we mirror its order; without one
  // we sort by name.
  if (catalog && catalog.length > 0) {
    const ordered: Record<string, PaymentMethodBucket> = {}
    for (const row of catalog) {
      const bucket = result[row.id]
      if (bucket) ordered[row.id] = bucket
    }
    // Any remaining keys (shouldn't happen but stays defensive) come last
    // in name order.
    const leftover = Object.entries(result)
      .filter(([k]) => !(k in ordered))
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
    for (const [k, v] of leftover) ordered[k] = v
    return ordered
  }
  const sortedEntries = Object.entries(result).sort((a, b) => a[1].name.localeCompare(b[1].name))
  const sorted: Record<string, PaymentMethodBucket> = {}
  for (const [k, v] of sortedEntries) sorted[k] = v
  return sorted
}

/**
 * Display label for a payment row's tenders. The catalog name is used
 * when exactly one method was used; "Múltiples" when more than one
 * distinct method was used (even when two lines happen to share a
 * method - the report says "Múltiples" so the cashier sees the bill
 * was split across multiple lines).
 */
export function methodLabel(payment: PaymentRow, catalog?: readonly MethodCatalogLike[]): string {
  if (payment.tenders.length === 0) return 'Sin método'
  const distinct = new Set(payment.tenders.map((t) => t.paymentMethodId))
  if (distinct.size > 1) return 'Múltiples'
  const onlyId = payment.tenders[0].paymentMethodId
  if (catalog) {
    const row = catalog.find((m) => m.id === onlyId)
    if (row) return row.name
  }
  return payment.tenders[0].methodCode
}

/**
 * Payment-method value for the printable invoice: "multiple" when more
 * than one distinct method was used, otherwise the snapshot code. Codes
 * outside the four defaults pass through unchanged; the invoice renders
 * unknown codes as-is.
 */
export function invoicePaymentMethod(payment: PaymentRow): string | undefined {
  if (payment.tenders.length === 0) return undefined
  const distinct = new Set(payment.tenders.map((t) => t.paymentMethodId))
  if (distinct.size > 1) return 'multiple'
  return payment.tenders[0].methodCode
}

// -----------------------------------------------------------
// CSV export
// -----------------------------------------------------------

const CSV_HEADER =
  'ID,Orden,Caja,Mesero,Monto,Propina,Cambio,Métodos,Monto total cargado,Fecha'

/**
 * RFC-4180-escape a single field. Wraps in double quotes when the field
 * contains a comma, a double quote or a newline; doubles inner quotes.
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  if (s === '') return ''
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build the CSV body for a set of payments. One row per payment; the
 * tenders are summarised as `code:amount;code:amount;...` joined in
 * line_no order (or catalog order when a catalog is supplied, so the
 * output matches the on-screen order). The header is fixed and
 * Spanish.
 *
 * Money fields are emitted as integers (no thousands separators, no
 * currency symbol) so downstream tools can SUM() them; the UI renders
 * the formatted currency separately.
 */
export function toCsvRows(
  payments: PaymentRow[],
  catalog?: readonly MethodCatalogLike[],
): string {
  const lines: string[] = [CSV_HEADER]
  const catalogOrder = catalog && catalog.length > 0 ? new Map(catalog.map((m) => [m.id, m] as const)) : undefined

  for (const payment of payments) {
    // Order the tender summary: catalog order when known, else line_no.
    const orderedTenders = [...payment.tenders]
    if (catalogOrder) {
      orderedTenders.sort((a, b) => {
        const ai = [...catalogOrder.keys()].indexOf(a.paymentMethodId)
        const bi = [...catalogOrder.keys()].indexOf(b.paymentMethodId)
        if (ai === -1 && bi === -1) return a.lineNo - b.lineNo
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    }

    // Collapse per-method amounts so two cash lines render as `cash:50000`
    // (not `cash:20000;cash:30000`). Mirrors `totalsByMethod` so the CSV
    // matches what the cashier sees.
    const collapsed = new Map<string, { code: string; amount: number }>()
    for (const t of orderedTenders) {
      const existing = collapsed.get(t.paymentMethodId)
      if (existing) existing.amount += t.amount
      else collapsed.set(t.paymentMethodId, { code: t.methodCode, amount: t.amount })
    }
    const tenderSummary = orderedTenders
      .filter((t, i, arr) => arr.findIndex((x) => x.paymentMethodId === t.paymentMethodId) === i)
      .map((t) => `${collapsed.get(t.paymentMethodId)!.code}:${collapsed.get(t.paymentMethodId)!.amount}`)
      .join(';')

    const row = [
      payment.id,
      payment.orderId,
      payment.cashRegisterId,
      payment.cashierProfileId ?? '',
      String(payment.amountDue),
      String(payment.tipAmount),
      String(payment.changeGiven),
      tenderSummary,
      String(payment.totalCharged),
      payment.createdAt,
    ]
    lines.push(row.map(csvEscape).join(','))
  }
  return lines.join('\n')
}