/**
 * Pure helpers for the admin payment-methods screen.
 *
 * No React, no Supabase, no DOM. The component imports these and
 * passes the result of `listPaymentMethods()` back and forth. Keeping
 * the helpers in their own module (instead of inside the component)
 * is what lets `catalog-admin.test.ts` pin the contract without
 * mounting the UI.
 *
 *   - `slugifyMethodCode(name, existingCodes)`  -> string
 *       A unique 2..32-char code derived from the human name:
 *       lowercase, accents stripped, non `[a-z0-9]` -> `_`, `_` runs
 *       collapsed and trimmed, clamped to 32, padded to 2 with the
 *       canonical `m_` pattern when the slug is too short, suffixed
 *       `_2`/`_3`/... on collision within 32 chars.
 *
 *   - `validateMethodName(name, others)`       -> 'empty' | 'too-long'
 *       | 'duplicate' | null. Comparison with `others` is case- and
 *       accent-insensitive; the caller filters out the row being
 *       edited so a rename keeps its own name.
 *
 *   - `moveMethod(methods, id, direction)`      -> { methods, changes }
 *       New array with contiguous sort_order (0..n-1) and the list of
 *       {id, sort_order} changes only (no unchanged rows), so the
 *       service can build the smallest possible UPDATE.
 *
 *   - `canDeactivate(methods, id)`              -> true | { reason }
 *       Refuses when the method is the last active one in the whole
 *       catalog (the cashier needs at least one active method) and
 *       when it is the last active cash method (giving change
 *       requires a cash method).
 *
 * `PAYMENT_METHODS_QUERY_KEY` is the TanStack-Query key the cashier
 * dialog and the admin reports use to cache the catalog. The admin
 * screen invalidates it after every mutation so the picker picks up
 * the rename, the new method or the new order without a manual
 * refresh.
 */

import type { PaymentMethodOption } from './types'

const MAX_CODE_LEN = 32
const MIN_CODE_LEN = 2
const MAX_NAME_LEN = 60

// Used to pad short slugs to MIN_CODE_LEN. The pattern is fixed so
// the generated code is deterministic for a given input.
const MIN_PADDING = 'm_'

const DIACRITICS_RE = /\p{Diacritic}/gu
const NON_SLUG_RE = /[^a-z0-9_]+/g
const UNDERSCORE_RUN_RE = /_+/g
const EDGE_UNDERSCORES_RE = /^_+|_+$/g

function stripAccents(input: string): string {
  return input.normalize('NFD').replace(DIACRITICS_RE, '')
}

function normalizeName(name: string): string {
  return stripAccents(name).trim().toLowerCase()
}

function baseSlug(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(NON_SLUG_RE, '_')
    .replace(UNDERSCORE_RUN_RE, '_')
    .replace(EDGE_UNDERSCORES_RE, '')
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function padToMin(value: string): string {
  if (value.length >= MIN_CODE_LEN) return value
  let padded = value
  while (padded.length < MIN_CODE_LEN) {
    padded += MIN_PADDING[padded.length % MIN_PADDING.length]
  }
  return padded
}

/**
 * Generate a unique `code` for a new method, given the codes that
 * already exist. The shape satisfies the DB CHECK constraint
 * `code ~ '^[a-z0-9_]{2,32}$'`:
 *   - lowercase
 *   - accents stripped (NFD + diacritic removal)
 *   - any char outside `[a-z0-9_]` collapsed to a single `_`
 *   - leading / trailing `_` trimmed
 *   - clamped to 32 chars
 *   - padded to 2 with the `m_` pattern when the slug is too short
 *   - suffixed `_2`, `_3`, ... on collision, with the base shortened
 *     as needed so the suffix fits within 32 chars.
 */
export function slugifyMethodCode(
  name: string,
  existingCodes: readonly string[] = [],
): string {
  const base = padToMin(clamp(baseSlug(name), MAX_CODE_LEN))
  const codes = new Set(existingCodes)
  if (!codes.has(base)) return base

  for (let n = 2; n < 10_000; n++) {
    const suffix = `_${n}`
    const room = MAX_CODE_LEN - suffix.length
    const candidate = clamp(base, room) + suffix
    if (!codes.has(candidate)) return candidate
  }
  // The 10k-iteration ceiling is unreachable in practice (the catalog
  // is a per-tenant table with a few dozen rows at most), but a
  // hard return keeps the signature total.
  return base
}

export type MethodNameError = 'empty' | 'too-long' | 'duplicate'

/**
 * Validate a human `name` against the rest of the catalog. The
 * caller passes the OTHER methods (i.e. the row being edited is
 * filtered out), so a rename of "Efectivo" to "Efectivo" against
 * itself returns null.
 *
 * Comparison is case- and accent-insensitive: "EFECTIVO" and
 * "Tarjeta Debito" both match "Efectivo" and "Tarjeta Débito".
 */
export function validateMethodName(
  name: string,
  others: readonly { name: string }[],
): MethodNameError | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'empty'
  if (trimmed.length > MAX_NAME_LEN) return 'too-long'
  const target = normalizeName(trimmed)
  for (const o of others) {
    if (normalizeName(o.name) === target) return 'duplicate'
  }
  return null
}

export interface SortOrderChange {
  id: string
  sortOrder: number
}

/**
 * Move a method up or down by one slot and recompute a contiguous
 * sort_order across the whole list (0..n-1). The returned `changes`
 * contains only the rows whose sort_order actually changed, so the
 * service can run the smallest possible UPDATE batch.
 *
 * Moving past either end is a no-op (returns no changes). The
 * incoming `methods` order is whatever the caller has; we sort by
 * `sortOrder` first so the move is relative to the catalog order,
 * not to whatever order the array happens to be in.
 */
export function moveMethod(
  methods: readonly PaymentMethodOption[],
  id: string,
  direction: 'up' | 'down',
): { methods: PaymentMethodOption[]; changes: SortOrderChange[] } {
  const ordered = methods.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const idx = ordered.findIndex((m) => m.id === id)
  if (idx === -1) {
    return { methods: ordered, changes: [] }
  }
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= ordered.length) {
    return { methods: ordered, changes: [] }
  }

  const next = ordered.slice()
  const [moved] = next.splice(idx, 1)
  next.splice(targetIdx, 0, moved)

  const changes: SortOrderChange[] = []
  const rebuilt: PaymentMethodOption[] = next.map((row, i) => {
    if (row.sortOrder === i) return row
    changes.push({ id: row.id, sortOrder: i })
    return { ...row, sortOrder: i }
  })
  return { methods: rebuilt, changes }
}

export type CanDeactivateResult =
  | true
  | { ok: false; reason: 'last-active' | 'last-cash' }

/**
 * Decide whether a method can be deactivated (is_active=false).
 *
 * The check is on the admin's current view of the catalog, NOT on
 * the server: a stale local snapshot still surfaces the right
 * reason because the rule is "if I were to commit this, would the
 * remaining catalog satisfy the cashier's needs?". The reason code
 * is what the UI uses to render the Spanish explanation in the
 * blocked-switch toast.
 *
 *   - "last-active": deactivating this leaves zero active methods.
 *     The cashier cannot open a sale at all, so we refuse.
 *   - "last-cash":   deactivating this leaves zero active cash
 *     methods, so the cashier cannot give change. We refuse even
 *     when other electronic methods stay active.
 *   - true:          none of the above.
 */
export function canDeactivate(
  methods: readonly PaymentMethodOption[],
  id: string,
): CanDeactivateResult {
  const target = methods.find((m) => m.id === id)
  if (!target) return true
  if (!target.isActive) return true

  const active = methods.filter((m) => m.isActive)
  if (active.length === 1 && active[0].id === id) {
    return { ok: false, reason: 'last-active' }
  }
  if (target.kind === 'cash') {
    const otherActiveCash = active.some((m) => m.kind === 'cash' && m.id !== id)
    if (!otherActiveCash) {
      return { ok: false, reason: 'last-cash' }
    }
  }
  return true
}

/**
 * TanStack-Query key for the payment-methods catalog. Used by the
 * cashier payment dialog (`components/cashier/PaymentMethodDialog.tsx`),
 * the cashier transaction list and the admin reports. The admin
 * screen invalidates it after every mutation so the picker, the
 * reports and the new table stay in sync without a manual refresh.
 *
 * Exported as `const` (not a function) because the read is the same
 * regardless of arguments; making it a function would have invited
 * a per-id cache slot no caller would ever read.
 */
export const PAYMENT_METHODS_QUERY_KEY = ['payment-methods'] as const
