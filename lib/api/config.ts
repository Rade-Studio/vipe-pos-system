import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Business config through the API (T7b). `GET /config` returns every known key
 * with the server defaults filled and typed; `PUT /config` upserts the given
 * keys in one transaction (admin) and returns the full config. The server is
 * the only source of defaults.
 */

export type BusinessConfig = components["schemas"]["BusinessConfig"]
export type BusinessConfigUpdate = components["schemas"]["UpdateBusinessConfigRequest"]

/** One cache slot shared by every config reader (store, delivery fee setting and dialog). */
export const CONFIG_QUERY_KEY = ["config"] as const

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function fetchConfig(): Promise<BusinessConfig> {
  const { data } = await api.GET("/api/config")
  return required(data)
}

export async function saveConfig(changes: BusinessConfigUpdate): Promise<BusinessConfig> {
  const { data } = await api.PUT("/api/config", { body: changes })
  return required(data)
}
