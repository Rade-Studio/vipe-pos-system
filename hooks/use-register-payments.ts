'use client'

/**
 * `useRegisterPayments(ids)` — TanStack-Query binding for the new
 * payment-ledger read. The browser never reads `payment_transactions`
 * for new sales: this hook is the single source of truth in the
 * cashier/admin UI, and the legacy rows are rendered as a separate
 * read-only block on top.
 *
 * The query key is exported as `registerPaymentsQueryKey` (same shape
 * as `registerSummaryQueryKey`: sorted ids so cache slots are stable
 * regardless of the caller's id order) so the rest of the app can
 * invalidate it from anywhere:
 *   `queryClient.invalidateQueries({ queryKey: registerPaymentsQueryKey(ids) })`.
 *
 * The query is disabled when ids is empty, which keeps the hook safe to
 * mount before the open register is known. It re-fetches when ids
 * change.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { listRegisterPayments } from '@/lib/supabase/payments-service'
import type { PaymentRow } from '@/lib/payments/payment-list'

export function registerPaymentsQueryKey(
  ids: string[],
): readonly (string | number)[] {
  if (ids.length === 0) return ['register-payments']
  return ['register-payments', ...[...ids].sort()]
}

export function useRegisterPayments(
  ids: string[],
): UseQueryResult<PaymentRow[], Error> {
  const queryKey = registerPaymentsQueryKey(ids)
  return useQuery<PaymentRow[], Error>({
    queryKey,
    queryFn: () => listRegisterPayments(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  })
}