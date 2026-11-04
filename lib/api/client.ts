import createClient from "openapi-fetch"
import { emitAuthEvent } from "@/lib/shell/auth-events"
import { ApiError } from "./errors"
import type { paths } from "./schema"

/**
 * The web's only way to reach the API. Same origin: the paths in the generated
 * contract already carry the `/api` prefix, and in development `next.config.mjs`
 * proxies them to the API, so there is no build-time API URL. The session
 * lives in the API's httpOnly cookies, sent with `credentials: "include"`.
 *
 * Every non-2xx answer rejects with an `ApiError`. A 401 on a protected route
 * triggers one silent `POST /api/auth/refresh` (shared by concurrent requests)
 * and one retry; the shell gets `signed_out` only when the refresh is refused
 * (401/403) and the retry is still 401.
 */

/** Auth routes answer 401 on their own terms; refreshing them would loop. */
const NO_REFRESH = new Set(["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"])

type Fetch = (request: Request) => Promise<Response>

export interface ApiClientOptions {
  /** Origin the paths are resolved against; the page's own origin by default. */
  baseUrl?: string
  fetch?: Fetch
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseFetch: Fetch = options.fetch ?? ((request) => globalThis.fetch(request))
  /**
   * `ok` rotated the cookies; `rejected` (401/403) means the refresh token is
   * no longer valid here; `failed` is a network error or a 5xx, which says
   * nothing about the session.
   */
  type RefreshOutcome = "ok" | "rejected" | "failed"
  let refreshing: Promise<RefreshOutcome> | null = null

  const refresh = (from: Request) => {
    refreshing ??= baseFetch(
      new Request(new URL("/api/auth/refresh", from.url), { method: "POST", credentials: "include" }),
    )
      .then(
        (response): RefreshOutcome =>
          response.ok ? "ok" : response.status === 401 || response.status === 403 ? "rejected" : "failed",
        (): RefreshOutcome => "failed",
      )
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  const fetchWithRefresh: Fetch = async (request) => {
    const retry = request.clone()
    const response = await baseFetch(request)
    if (response.status !== 401 || NO_REFRESH.has(new URL(request.url).pathname)) return response
    const outcome = await refresh(request)
    // Network error or 5xx: keep the session, surface the original 401.
    if (outcome === "failed") return response
    // Retry even after a rejected refresh: another tab may have rotated the
    // cookies first, and the browser already holds the new ones.
    const retried = await baseFetch(retry)
    if (outcome === "rejected" && retried.status === 401) emitAuthEvent("signed_out")
    return retried
  }

  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? "",
    credentials: "include",
    fetch: fetchWithRefresh,
  })
  client.use({
    async onResponse({ response }) {
      if (!response.ok) throw await ApiError.fromResponse(response)
      return undefined
    },
  })
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>

export const api = createApiClient()
