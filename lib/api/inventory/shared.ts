/**
 * Helpers shared by the inventory services. The API answers the camelCase
 * domain objects of `./types` directly, so the services only build the
 * request; errors stay `ApiError`s and the hooks map them with
 * `toInventoryError`.
 */

import { ApiError } from "@/lib/api/errors"

/** A 2xx without the body the contract promises. */
export function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

/** Drop undefined entries so the query string and bodies carry only the given keys. */
export function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

export const flag = (value: boolean | undefined): "true" | "false" | undefined =>
  value === undefined ? undefined : value ? "true" : "false"

/** Comma-separated list, or undefined when empty. */
export const csv = (values: readonly string[] | undefined): string | undefined =>
  values && values.length > 0 ? values.join(",") : undefined

export const byId = (id: string) => ({ params: { path: { id } } })
