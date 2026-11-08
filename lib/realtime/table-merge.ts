import type { Table, TableShape } from "@/types"

/**
 * A `public.tables` row as it arrives inside a postgres_changes payload.
 * Declared locally (rather than importing the DB row type) so this module
 * stays free of runtime and type dependencies beyond `@/types`.
 */
export interface TableRow {
  id?: string | null
  number?: number | null
  status?: string | null
  waiter_id?: string | null
  waiter_name?: string | null
  /** Floor plan columns (migration 0012); numeric columns arrive as JSON numbers. */
  zone_id?: string | null
  x?: number | null
  y?: number | null
  w?: number | null
  h?: number | null
  shape?: string | null
  rotation?: number | null
  seats?: number | null
  /** Migration 0015; absent on older rows: active. */
  is_active?: boolean | null
  updated_at?: string | null
  /** Migration 0022: set exactly while the table is reserved. */
  reservation_name?: string | null
  reservation_arrival_at?: string | null
  reserved_at?: string | null
  /** Mapped from the API DTO only; realtime rows carry `reserved_by` (an id). */
  reserved_by_name?: string | null
}

/**
 * Structural shape of a postgres_changes payload for the `tables` topic.
 * Declared locally rather than importing `RealtimePostgresChangesPayload` so
 * this module stays free of runtime and type dependencies on the Supabase
 * client, and so the single `as` cast lives at the call site instead of
 * being scattered across every consumer.
 */
export interface TableChange {
  eventType: string
  new?: TableRow | null
  old?: TableRow | null
}

/**
 * Normalizes `value` to epoch milliseconds. Returns `0` for `null`,
 * `undefined`, and any unparseable input, so a missing/garbled timestamp
 * never produces `NaN` and silently swallows a live event.
 */
export function toTimestamp(value: string | Date | null | undefined): number {
  if (value == null) return 0
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Normalizes a raw row to the app-level `Table`. Returns `null` when `id`
 * is absent — such a row cannot be inserted, updated, or matched.
 */
export function toTable(row: TableRow): Table | null {
  if (!row.id) return null
  return {
    id: row.id,
    number: row.number as number,
    status: row.status as Table["status"],
    waiter: row.waiter_id || undefined,
    waiter_name: row.waiter_name || undefined,
    zoneId: row.zone_id ?? undefined,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    w: row.w ?? undefined,
    h: row.h ?? undefined,
    shape: (row.shape as TableShape | null) ?? undefined,
    rotation: row.rotation ?? undefined,
    seats: row.seats ?? undefined,
    isActive: row.is_active !== false,
    // D4: makes the out-of-order guard live for the first time — see design.md
    updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
    reservationName: row.reservation_name ?? undefined,
    reservationArrivalAt: row.reservation_arrival_at ?? undefined,
    reservedAt: row.reserved_at ?? undefined,
    reservedByName: row.reserved_by_name ?? undefined,
  }
}

/**
 * Applies `change` to `prev`.
 *
 * INVARIANT: returns the IDENTICAL `prev` reference whenever the change is a
 * no-op. This is what suppresses the re-render — callers and the store
 * depend on reference identity, not on deep equality. See design.md's D10
 * behaviour table for the full 11-row contract this function implements.
 */
export function mergeTableList(prev: readonly Table[], change: TableChange): Table[] {
  const { eventType, new: newRow, old: oldRow } = change

  if (eventType === "INSERT") {
    if (!newRow?.id) return prev as Table[]
    const incoming = toTable(newRow)
    if (!incoming) return prev as Table[]
    // Idempotent — protects against echo and StrictMode double-delivery.
    return prev.some((t) => t.id === incoming.id) ? (prev as Table[]) : [...prev, incoming]
  }

  if (eventType === "UPDATE") {
    if (!newRow?.id) return prev as Table[]
    const incoming = toTable(newRow)
    if (!incoming) return prev as Table[]
    const existing = prev.find((t) => t.id === incoming.id)
    // D5: an UPDATE for an id not present in `prev` is dropped, not upserted.
    if (!existing) return prev as Table[]
    // Out-of-order rejection: incoming must not be strictly older than existing.
    if (toTimestamp(newRow.updated_at) < toTimestamp(existing.updated_at)) return prev as Table[]
    return prev.map((t) => (t.id === incoming.id ? incoming : t))
  }

  if (eventType === "DELETE") {
    if (!oldRow?.id) return prev as Table[]
    return prev.some((t) => t.id === oldRow.id)
      ? prev.filter((t) => t.id !== oldRow.id)
      : (prev as Table[])
  }

  // Unknown eventType: no-op.
  return prev as Table[]
}

/**
 * Structural shape of a postgres_changes payload over raw, untyped rows.
 * Used by {@link mergeRowList}, whose consumers (currently
 * `TableManagementPanel` only — see design.md D9) hold database rows
 * directly rather than the mapped `Table` shape.
 */
export interface RowChange {
  eventType: string
  new?: Record<string, unknown> | null
  old?: Record<string, unknown> | null
}

/**
 * Raw-row variant of {@link mergeTableList} for consumers that hold database
 * rows directly instead of the mapped `Table` type (design.md D9). Performs
 * NO field mapping: a row is inserted/replaced/removed exactly as it arrives
 * on the wire, under its own raw column names (e.g. `waiter_id`,
 * `updated_at`) — never renamed the way `toTable` renames `waiter_id` to
 * `waiter`. Shares the same D10 event-dispatch and reference-stability
 * contract as `mergeTableList`, including the identical `prev` reference on
 * every no-op row.
 *
 * Performs NO enrichment either. Since T8b the API listener attaches
 * `waiter_name` to every `tables` event, so `TableManagementPanel` (which
 * holds rows in this same shape) merges the payload row directly.
 */
export function mergeRowList<T extends { id: string }>(prev: readonly T[], change: RowChange): T[] {
  const { eventType, new: newRow, old: oldRow } = change

  if (eventType === "INSERT") {
    const id = newRow?.id
    if (typeof id !== "string" || !id) return prev as T[]
    // Idempotent — protects against echo and StrictMode double-delivery.
    return prev.some((row) => row.id === id) ? (prev as T[]) : [...prev, newRow as unknown as T]
  }

  if (eventType === "UPDATE") {
    const id = newRow?.id
    if (typeof id !== "string" || !id) return prev as T[]
    const existing = prev.find((row) => row.id === id)
    // D5: an UPDATE for an id not present in `prev` is dropped, not upserted.
    if (!existing) return prev as T[]
    const incomingTs = toTimestamp(newRow?.updated_at as string | Date | null | undefined)
    const existingTs = toTimestamp(
      (existing as Record<string, unknown>).updated_at as string | Date | null | undefined,
    )
    // Out-of-order rejection: incoming must not be strictly older than existing.
    if (incomingTs < existingTs) return prev as T[]
    return prev.map((row) => (row.id === id ? (newRow as unknown as T) : row))
  }

  if (eventType === "DELETE") {
    const id = oldRow?.id
    if (typeof id !== "string" || !id) return prev as T[]
    return prev.some((row) => row.id === id) ? prev.filter((row) => row.id !== id) : (prev as T[])
  }

  // Unknown eventType: no-op.
  return prev as T[]
}
