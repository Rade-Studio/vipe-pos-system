/**
 * Waiter row mapping (T6/S1).
 *
 * `WaiterView.loadWaiters` and `WaiterSelectionModal.loadWaiters` each fetched
 * and mapped the same `profiles` rows — twice per interaction. Both now read one
 * shared React Query (see `hooks/use-waiters`), and the mapping is decided here.
 */

import type { Profile, ProfileRole } from "@/types"

export type WaiterRow = {
  id: string
  full_name: string
  username?: string | null
  role: string
}

/** Maps the `profiles` rows of active waiters into the `Profile` shape the views render. */
export function mapWaiterRowsToProfiles(rows: readonly WaiterRow[]): Profile[] {
  return rows
    .filter((row): row is WaiterRow => Boolean(row?.id) && Boolean(row?.full_name))
    .map((row) => ({
      id: row.id,
      name: row.full_name,
      full_name: row.full_name,
      username: row.username,
      role: row.role as ProfileRole,
      hasPassword: false,
    }))
}