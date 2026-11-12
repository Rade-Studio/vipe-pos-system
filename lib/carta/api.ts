import { api } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { Carta, CartaDishShare, CartaLang } from "./types"

/**
 * Public carta reads (T2 contract, L22). Always from the browser (A2): the
 * API rate-limits per client IP, and a Next.js server fetch would make every
 * guest share the server's IP. Same shared client as the staff screens: same
 * origin, `/api` proxied in development.
 */

export interface CartaRequest {
  slug: string
  /** Table QR token: the dine_in carta of that table. */
  token?: string
  /** Absent on the first load: the API resolves the phone's Accept-Language. */
  lang?: CartaLang
}

export type CartaFailure = "not_found" | "rate_limited" | "network"

export function failureOf(error: unknown): CartaFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return "not_found"
    if (error.status === 429) return "rate_limited"
  }
  return "network"
}

function acceptLanguage(): string {
  if (typeof navigator === "undefined") return "es"
  return (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean).join(",") || "es"
}

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function fetchCarta({ slug, token, lang }: CartaRequest): Promise<Carta> {
  const header = { "accept-language": acceptLanguage() }
  if (token) {
    // A5: the table route is always dine_in; it ignores `?channel`.
    const { data } = await api.GET("/api/carta/{slug}/m/{token}", {
      params: { path: { slug, token }, query: lang ? { lang } : undefined, header },
    })
    return required(data)
  }
  const { data } = await api.GET("/api/carta/{slug}", {
    params: { path: { slug }, query: { channel: "delivery", ...(lang ? { lang } : {}) }, header },
  })
  return required(data)
}

export async function fetchDishShare(slug: string, dishId: string): Promise<CartaDishShare> {
  const { data } = await api.GET("/api/carta/{slug}/p/{dishId}", { params: { path: { slug, dishId } } })
  return required(data)
}
