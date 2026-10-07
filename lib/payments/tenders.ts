import type {
  ComputedTenderLine,
  PayOrderTenderLine,
  PaymentIssue,
  PaymentMethodOption,
  PaymentState,
  TenderDraft,
} from './types'

/**
 * Maximum number of tender lines per checkout. Matches the server's
 * `pay_order` input check: 21 raises invalid_parameter_value (22023).
 */
const MAX_TENDER_LINES = 20

interface ComputePaymentStateInput {
  amountDue: number
  tip: number
  tenders: TenderDraft[]
  methods: PaymentMethodOption[]
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isPositiveWholePeso(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
}

/**
 * Compute the tender state for the given bill + tip + lines.
 *
 * Line-by-line, in the order the cashier entered them:
 *   remainingBefore = totalToCharge − applied so far
 *   electronic: applied = tendered (capped only by the issue flag)
 *   cash:       applied = min(tendered, remainingBefore)
 *               change   = tendered − applied
 *               applied 0 → line-not-needed
 *   unknown methodId     → unknown-method
 *   inactive methodId    → inactive-method
 *   !positive integer    → invalid-amount
 *
 * State-level guards (not per line):
 *   tip not a non-negative integer → invalid-tip
 *   > 20 lines                     → too-many-lines
 *   amountDue <= 0                 → nothing-to-charge
 *
 * `canSubmit` is true only when `issues` is empty and `remaining` is 0.
 * `remaining` is clamped to >= 0 so an electronic overpay that already
 * reported `electronic-overpay` does not also report a negative remaining.
 *
 * The function never throws. All failure modes are typed issues; the
 * caller decides whether to surface them, recompute, or block submit.
 */
export function computePaymentState(input: ComputePaymentStateInput): PaymentState {
  const issues: PaymentIssue[] = []
  const { tenders, methods } = input
  let { amountDue, tip } = input

  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    issues.push({ code: 'nothing-to-charge', message: 'amountDue must be a positive whole peso' })
    amountDue = 0
  }

  if (!isNonNegativeInteger(tip)) {
    issues.push({ code: 'invalid-tip', message: 'tip must be a non-negative integer' })
    tip = 0
  }

  if (tenders.length > MAX_TENDER_LINES) {
    issues.push({
      code: 'too-many-lines',
      message: `at most ${MAX_TENDER_LINES} tender lines per payment`,
    })
  }

  const totalToCharge = amountDue + tip
  const methodById = new Map<string, PaymentMethodOption>()
  for (const m of methods) methodById.set(m.id, m)

  const lines: ComputedTenderLine[] = []
  let applied = 0
  let totalChange = 0

  for (let i = 0; i < tenders.length; i++) {
    const tender = tenders[i]
    const remainingBefore = totalToCharge - applied
    const method = methodById.get(tender.methodId)

    if (!method) {
      issues.push({
        code: 'unknown-method',
        lineIndex: i,
        message: `tender[${i}].methodId does not match any catalog row`,
      })
      lines.push({
        methodId: tender.methodId,
        kind: 'electronic',
        tendered: tender.tendered,
        applied: 0,
        change: 0,
      })
      continue
    }

    if (!method.isActive) {
      issues.push({
        code: 'inactive-method',
        lineIndex: i,
        message: `tender[${i}].methodId is inactive`,
      })
      lines.push({
        methodId: tender.methodId,
        kind: method.kind,
        tendered: tender.tendered,
        applied: 0,
        change: 0,
      })
      continue
    }

    if (!isPositiveWholePeso(tender.tendered)) {
      issues.push({
        code: 'invalid-amount',
        lineIndex: i,
        message: `tender[${i}].tendered must be a positive whole peso`,
      })
      lines.push({
        methodId: tender.methodId,
        kind: method.kind,
        tendered: tender.tendered,
        applied: 0,
        change: 0,
      })
      continue
    }

    if (method.kind === 'electronic') {
      const lineApplied = tender.tendered
      if (lineApplied > remainingBefore) {
        issues.push({
          code: 'electronic-overpay',
          lineIndex: i,
          message: `tender[${i}] overpays the remaining ${remainingBefore}`,
        })
      }
      lines.push({
        methodId: tender.methodId,
        kind: 'electronic',
        tendered: tender.tendered,
        applied: lineApplied,
        change: 0,
      })
      applied += lineApplied
    } else {
      const lineApplied = Math.min(tender.tendered, remainingBefore)
      const change = tender.tendered - lineApplied
      if (lineApplied === 0) {
        issues.push({
          code: 'line-not-needed',
          lineIndex: i,
          message: `tender[${i}] not needed (bill already covered)`,
        })
      }
      lines.push({
        methodId: tender.methodId,
        kind: 'cash',
        tendered: tender.tendered,
        applied: lineApplied,
        change,
      })
      applied += lineApplied
      totalChange += change
    }
  }

  const remaining = Math.max(0, totalToCharge - applied)
  const canSubmit = issues.length === 0 && remaining === 0
  return { totalToCharge, lines, applied, remaining, totalChange, issues, canSubmit }
}

/**
 * Build the `p_tenders` jsonb payload for `public.pay_order`. The state must
 * already be submittable: cash_received is the customer's cash, the wire
 * format is the cashier's typed values verbatim, and `amount` is what the
 * line applies to the bill (capped for cash, full for electronic).
 *
 * Throws when the state is not submittable. The caller's flow should be:
 *   const state = computePaymentState(...)
 *   if (!state.canSubmit) show issues
 *   else supabase.rpc('pay_order', { p_tenders: buildPayOrderTenders(state), ... })
 */
export function buildPayOrderTenders(state: PaymentState): PayOrderTenderLine[] {
  if (!state.canSubmit) {
    throw new Error(
      'buildPayOrderTenders: cannot build a pay_order payload from a state that is not submittable',
    )
  }
  return state.lines.map((line) => ({
    payment_method_id: line.methodId,
    amount: line.applied,
    cash_received: line.kind === 'cash' ? line.tendered : null,
  }))
}

/**
 * Cash-register helper: what would the tip become if we asked the customer
 * to round the cash up to the nearest peso instead of taking the change?
 * Returns `tip + totalChange` (clamped to a non-negative integer), so the
 * cashier can offer "tip 3000 instead of change 3000" without rewriting the
 * state themselves. With electronic-only lines `totalChange` is 0, so the
 * function is the identity for those.
 */
export function applySurplusAsTip(input: ComputePaymentStateInput): number {
  const state = computePaymentState(input)
  const sanitizedTip = isNonNegativeInteger(input.tip) ? input.tip : 0
  return sanitizedTip + state.totalChange
}
