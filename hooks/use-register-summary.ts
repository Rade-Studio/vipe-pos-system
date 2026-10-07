'use client'

/**
 * `useRegisterSummary(ids)` — TanStack-Query binding for the server-side
 * aggregation. The browser never recomputes register totals any more:
 * the server is the only authority, and this hook is the single point
 * of read access in the cashier/admin UI.
 *
 * The query key is exported as `registerSummaryQueryKey` (in
 * `lib/payments/register-summary.ts`) so callers invalidate it from
 * anywhere: `queryClient.invalidateQueries({
 *   queryKey: registerSummaryQueryKey(ids) })`.
 *
 * The query is disabled when ids is empty, which keeps the hook safe to
 * mount before the open register is known. It re-fetches when ids
 * change; the key is built in canonical order so two callers passing
 * `[a, b]` and `[b, a]` hit the same cache slot.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getRegisterSummary } from '@/lib/supabase/payments-service'
import type { RegisterSummary } from '@/lib/payments/register-summary'
import { registerSummaryQueryKey } from '@/lib/payments/register-summary'

export function useRegisterSummary(
  ids: string[],
): UseQueryResult<RegisterSummary, Error> {
  const queryKey = registerSummaryQueryKey(ids)
  return useQuery<RegisterSummary, Error>({
    queryKey,
    queryFn: () => getRegisterSummary(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  })
}