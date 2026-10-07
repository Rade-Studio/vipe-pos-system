/**
 * Pure reducer for the cashier's multi-tender payment dialog.
 *
 * Owns:
 *   - the in-progress tender lines (cashier order, not server order),
 *   - the tip amount and the four tip modes (none / suggested / custom /
 *     surplus-as-tip),
 *   - the idempotency key for `pay_order` (stable for the dialog session,
 *     rotated only when a new draft is created for a new order),
 *   - the submit lifecycle (submitting flag, last error, last result).
 *
 * Does NOT own:
 *   - the catalog of payment methods. The view loads them via
 *     `listPaymentMethods` and passes them to `selectView` so the
 *     reducer stays pure and the Vitest suite stays node-only.
 *
 * All math goes through `computePaymentState` / `applySurplusAsTip`
 * from `./tenders`, so the catalog and rounding rules live in one
 * place. Money is whole Colombian pesos (COP); the parser in
 * `addLine` rejects non-integers before they reach the helper.
 */

import { applySurplusAsTip, computePaymentState } from './tenders'
import type {
  PayOrderResult,
  PaymentMethodOption,
  PaymentState,
  TenderDraft,
} from './types'

// -----------------------------------------------------------
// State
// -----------------------------------------------------------

/**
 * The dialog's authoritative state. Created once per order by
 * `initialPaymentDraft`, mutated only by `paymentDraftReducer`.
 */
export interface PaymentDraftState {
  /** What the customer has to cover before tip. Set by the view from the order. */
  amountDue: number
  /** The tip the dialog was opened with; preserved so "Sugerida" can be reapplied. */
  suggestedTip: number
  /** Current tip amount (whole pesos). */
  tip: number
  /** Tender lines in the order the cashier entered them. */
  tenders: TenderDraft[]
  /** Method picked for the next line; null = none. */
  selectedMethodId: string | null
  /** Raw text the cashier typed for the next line; '' = no line in progress. */
  amountInput: string
  /** Stable for the whole dialog session. Rotated only by a new draft (new order). */
  idempotencyKey: string
  /** True between `startSubmit` and `submitSucceeded`/`submitFailed`. */
  submitting: boolean
  /** Last submit error message, or null. Cleared on the next `startSubmit`. */
  lastError: string | null
  /** Last successful server response, or null. Held for the receipt. */
  lastResult: PayOrderResult | null
}

// -----------------------------------------------------------
// Actions
// -----------------------------------------------------------

export type PaymentDraftAction =
  | { type: 'selectMethod'; methodId: string }
  | { type: 'setAmountInput'; value: string }
  | { type: 'addLine' }
  | { type: 'removeLine'; lineIndex: number }
  | { type: 'setTipNone' }
  | { type: 'setTipSuggested' }
  | { type: 'setTipCustom'; amount: number }
  | { type: 'startSubmit' }
  | { type: 'submitSucceeded'; result: PayOrderResult }
  | { type: 'submitFailed'; error: string }
  | { type: 'clearLastError' }

// -----------------------------------------------------------
// Public factories
// -----------------------------------------------------------

export interface InitialPaymentDraftInput {
  amountDue: number
  suggestedTip: number
  /**
   * Caller-supplied UUID. The view generates one with `crypto.randomUUID`
   * when the dialog opens; the reducer never invents one. The same key
   * is reused on retries (per the idempotency contract) and is only
   * replaced by creating a new draft for a new order.
   */
  idempotencyKey: string
}

/**
 * Build a fresh draft for a new order. Tip is preloaded with the
 * suggested amount; everything else starts empty.
 */
export function initialPaymentDraft(input: InitialPaymentDraftInput): PaymentDraftState {
  return {
    amountDue: input.amountDue,
    suggestedTip: input.suggestedTip,
    tip: input.suggestedTip,
    tenders: [],
    selectedMethodId: null,
    amountInput: '',
    idempotencyKey: input.idempotencyKey,
    submitting: false,
    lastError: null,
    lastResult: null,
  }
}

// -----------------------------------------------------------
// Reducer
// -----------------------------------------------------------

/**
 * Parse the cashier's `amountInput` into a whole, positive peso count.
 * Returns null on any non-integer / non-positive / non-finite value.
 * We re-parse on every action so the same regex backs every entry path
 * (typed digits, keypad press, programmatic add).
 */
function parseAmountInput(raw: string): number | null {
  if (raw === '') return null
  // Reject anything that is not a non-empty run of digits.
  if (!/^\d+$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function paymentDraftReducer(
  state: PaymentDraftState,
  action: PaymentDraftAction,
): PaymentDraftState {
  switch (action.type) {
    case 'selectMethod': {
      // Allow changing the method while a line is in progress; the
      // amount input stays so the cashier can fix the method without
      // re-typing the amount.
      if (state.submitting) return state
      return { ...state, selectedMethodId: action.methodId }
    }

    case 'setAmountInput': {
      if (state.submitting) return state
      // Strip non-digits so the keypad and pasted values both behave.
      const sanitized = action.value.replace(/[^\d]/g, '')
      return { ...state, amountInput: sanitized }
    }

    case 'addLine': {
      if (state.submitting) return state
      if (state.selectedMethodId === null) return state
      const tendered = parseAmountInput(state.amountInput)
      if (tendered === null) return state
      return {
        ...state,
        tenders: [...state.tenders, { methodId: state.selectedMethodId, tendered }],
        selectedMethodId: null,
        amountInput: '',
      }
    }

    case 'removeLine': {
      if (state.submitting) return state
      if (action.lineIndex < 0 || action.lineIndex >= state.tenders.length) return state
      return {
        ...state,
        tenders: state.tenders.filter((_, i) => i !== action.lineIndex),
      }
    }

    case 'setTipNone':
      if (state.submitting) return state
      return { ...state, tip: 0 }

    case 'setTipSuggested':
      if (state.submitting) return state
      return { ...state, tip: state.suggestedTip }

    case 'setTipCustom':
      if (state.submitting) return state
      // Negative or non-integer is rejected here so the helper doesn't
      // see garbage; the UI's own input guard will normally prevent it.
      if (!Number.isInteger(action.amount) || action.amount < 0) return state
      return { ...state, tip: action.amount }

    case 'startSubmit':
      // Re-arming the submit: clear the last error so the button label /
      // retry path starts clean, but keep the key and the tenders.
      return { ...state, submitting: true, lastError: null }

    case 'submitSucceeded':
      return { ...state, submitting: false, lastError: null, lastResult: action.result }

    case 'submitFailed':
      return { ...state, submitting: false, lastError: action.error }

    case 'clearLastError':
      return { ...state, lastError: null }
  }
}

// -----------------------------------------------------------
// Surplus-as-tip helper (view-side, needs the catalog)
// -----------------------------------------------------------

/**
 * "El excedente es propina": what would the tip become if the cashier
 * asked the customer to round the cash up instead of taking the change?
 * Returns the new tip amount (whole pesos) so the view can dispatch
 * `setTipCustom` with the result. The reducer is pure and doesn't
 * know the catalog, so this math lives in the view layer.
 */
export function computeSurplusAsTip(
  state: PaymentDraftState,
  methods: PaymentMethodOption[],
): number {
  return applySurplusAsTip({
    amountDue: state.amountDue,
    tip: state.tip,
    tenders: state.tenders,
    methods,
  })
}

// -----------------------------------------------------------
// selectView: derive UI flags from the draft + the catalog
// -----------------------------------------------------------

export interface PaymentDraftView extends PaymentState {
  /** `canSubmit && !submitting && no-in-progress-line && no-method-selected`. */
  canConfirm: boolean
  /** True only when there is cash change the cashier can convert to tip. */
  showSurplusAsTip: boolean
  /** `remaining` — what the next line should autofill to. */
  quickFillSuggestion: number
}

/**
 * Build the view the component renders from. The catalog must be the
 * active-only, sortOrder-ordered list from `listPaymentMethods`; the
 * helper treats inactive / unknown methods as `inactive-method` /
 * `unknown-method` issues, which is what we want to surface in the
 * picker even though we never let the cashier pick them.
 */
export function selectView(
  state: PaymentDraftState,
  methods: PaymentMethodOption[],
): PaymentDraftView {
  const base = computePaymentState({
    amountDue: state.amountDue,
    tip: state.tip,
    tenders: state.tenders,
    methods,
  })
  const hasInProgressLine = state.selectedMethodId !== null || state.amountInput !== ''
  const canConfirm =
    base.canSubmit && !state.submitting && !hasInProgressLine && state.lastError === null
  return {
    ...base,
    canConfirm,
    showSurplusAsTip: base.totalChange > 0,
    quickFillSuggestion: base.remaining,
  }
}
