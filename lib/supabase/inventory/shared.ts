/**
 * Helpers shared by the inventory services.
 *
 * `db` is the browser client typed loosely, the same `(supabase as any)`
 * pattern `delivery-service.ts` uses: the new tables' embedded selects and the
 * jsonb RPC arguments are mapped through the explicit wire shapes in each
 * service instead. Services throw the raw Supabase error; the hooks map it
 * with `toInventoryError`.
 */

import { supabase } from "@/lib/supabase/client"

export const db = supabase as any

/** PostgREST numerics may be strings; null/undefined/garbage become 0. */
export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? 0 : n
}

export const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : num(v))

/** Resolves a query/RPC result, throwing its error. */
export const unwrap = async <T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> => {
  const { data, error } = await query
  if (error) throw error
  return data as T
}

export const rpc = <T>(fn: string, args: Record<string, unknown>): Promise<T> => unwrap<T>(db.rpc(fn, args))

/** Name of an embedded to-one relation (`{ name }` or null). */
export const embeddedName = (rel: unknown): string | null =>
  rel && typeof rel === "object" && typeof (rel as { name?: unknown }).name === "string"
    ? (rel as { name: string }).name
    : null
