import { afterEach, describe, expect, it, vi } from "vitest"
import { createApiClient, onSessionRefreshed } from "./client"
import { ApiError, conflictMessage } from "./errors"
import { onAuthEvent } from "@/lib/shell/auth-events"
import { clearActingToken, setActingToken } from "@/lib/terminal/acting"

/**
 * T7 (S2): the web reaches the API same-origin with the session cookies. A 401
 * on a protected route gets one silent refresh and one retry; when the refresh
 * fails the shell is told the session ended. This is the only spec that mocks
 * at fetch level: it is the fetch boundary.
 */

const session = {
  user: { id: "u-1", email: "admin@vipe.local" },
  profile: { id: "p-1", name: "Admin", role: "admin", restaurantId: "r-1" },
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const unauthorized = () => json(401, { statusCode: 401, error: "Unauthorized", message: "Missing access token" })

/** Fake fetch answering from a queue and recording `METHOD path` per call. */
function fakeFetch(...responses: Response[]) {
  const calls: string[] = []
  const credentials: RequestCredentials[] = []
  const fetch = vi.fn(async (request: Request) => {
    calls.push(`${request.method} ${new URL(request.url).pathname}`)
    credentials.push(request.credentials)
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request ${request.method} ${request.url}`)
    return next
  })
  return { fetch, calls, credentials }
}

const stops: Array<() => void> = []
afterEach(() => {
  while (stops.length) stops.pop()!()
})

function signedOutEvents() {
  const events: string[] = []
  stops.push(onAuthEvent((event) => events.push(event)))
  return events
}

describe("api client", () => {
  it("calls the API path on the same origin and sends the cookies", async () => {
    const { fetch, calls, credentials } = fakeFetch(json(200, session))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const { data } = await api.GET("/api/auth/me")

    expect(data).toEqual(session)
    expect(calls).toEqual(["GET /api/auth/me"])
    expect(credentials).toEqual(["include"])
  })

  it("maps an error body to a typed ApiError", async () => {
    const { fetch } = fakeFetch(json(401, { statusCode: 401, error: "Unauthorized", message: "Invalid credentials" }))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const failure = await api
      .POST("/api/auth/login", { body: { email: "a@b.c", password: "x" } })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 401, error: "Unauthorized", message: "Invalid credentials" })
  })

  it("keeps the extra fields of a 409 body (shortages, prices, orderId) on the ApiError", async () => {
    const body = { statusCode: 409, error: "Conflict", message: "Table has an open order", orderId: "o-9" }
    const { fetch } = fakeFetch(json(409, body))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const failure = await api.GET("/api/auth/me").catch((error: unknown) => error)

    expect(failure).toMatchObject({ status: 409, message: "Table has an open order", body })
  })

  it("tells the realtime client when a silent refresh rotated the cookies", async () => {
    const refreshed = vi.fn()
    stops.push(onSessionRefreshed(refreshed))
    const { fetch } = fakeFetch(unauthorized(), new Response(null, { status: 204 }), json(200, session))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    await api.GET("/api/auth/me")

    expect(refreshed).toHaveBeenCalledTimes(1)
  })

  it("maps a body that is not the API error shape to an ApiError with the status text", async () => {
    const { fetch } = fakeFetch(new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const failure = await api.GET("/api/auth/me").catch((error: unknown) => error)

    expect(failure).toMatchObject({ status: 502, error: "Bad Gateway", message: "Bad Gateway" })
  })

  it("on a 401 refreshes once and retries the request", async () => {
    const events = signedOutEvents()
    const { fetch, calls } = fakeFetch(unauthorized(), new Response(null, { status: 204 }), json(200, session))
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const { data } = await api.GET("/api/auth/me")

    expect(data).toEqual(session)
    expect(calls).toEqual(["GET /api/auth/me", "POST /api/auth/refresh", "GET /api/auth/me"])
    expect(events).toEqual([])
  })

  it("emits signed_out and rejects with the 401 when the refresh is refused and the retry is still 401", async () => {
    const events = signedOutEvents()
    const { fetch, calls } = fakeFetch(
      unauthorized(),
      json(401, { statusCode: 401, error: "Unauthorized", message: "Refresh token missing" }),
      unauthorized(),
    )
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const failure = await api.GET("/api/auth/me").catch((error: unknown) => error)

    expect(failure).toMatchObject({ status: 401, message: "Missing access token" })
    expect(calls).toEqual(["GET /api/auth/me", "POST /api/auth/refresh", "GET /api/auth/me"])
    expect(events).toEqual(["signed_out"])
  })

  it("does not refresh a failed login, refresh or logout", async () => {
    const events = signedOutEvents()
    const { fetch, calls } = fakeFetch(unauthorized(), unauthorized(), unauthorized())
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    await api.POST("/api/auth/login", { body: { email: "a@b.c", password: "x" } }).catch(() => undefined)
    await api.POST("/api/auth/refresh").catch(() => undefined)
    await api.POST("/api/auth/logout").catch(() => undefined)

    expect(calls).toEqual(["POST /api/auth/login", "POST /api/auth/refresh", "POST /api/auth/logout"])
    expect(events).toEqual([])
  })

  it("shares one refresh between concurrent 401s", async () => {
    const { fetch, calls } = fakeFetch(
      unauthorized(),
      unauthorized(),
      new Response(null, { status: 204 }),
      json(200, session),
      json(200, session),
    )
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    await Promise.all([api.GET("/api/auth/me"), api.GET("/api/auth/me")])

    expect(calls.filter((call) => call === "POST /api/auth/refresh")).toHaveLength(1)
  })

  it("does not sign out when another tab already rotated the refresh token", async () => {
    const events = signedOutEvents()
    const { fetch, calls } = fakeFetch(
      unauthorized(),
      json(401, { statusCode: 401, error: "Unauthorized", message: "Invalid refresh token" }),
      json(200, session),
    )
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })

    const { data } = await api.GET("/api/auth/me")

    expect(data).toEqual(session)
    expect(calls).toEqual(["GET /api/auth/me", "POST /api/auth/refresh", "GET /api/auth/me"])
    expect(events).toEqual([])
  })

  it("does not sign out when the refresh fails on the network or with a 5xx", async () => {
    const events = signedOutEvents()
    const network = fakeFetch(unauthorized())
    const failNetwork = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === "/api/auth/refresh") throw new TypeError("Failed to fetch")
      return network.fetch(request)
    })
    const offline = createApiClient({ baseUrl: "http://localhost:3000", fetch: failNetwork })
    const first = await offline.GET("/api/auth/me").catch((error: unknown) => error)

    const { fetch } = fakeFetch(
      unauthorized(),
      json(503, { statusCode: 503, error: "Service Unavailable", message: "down" }),
    )
    const down = createApiClient({ baseUrl: "http://localhost:3000", fetch })
    const second = await down.GET("/api/auth/me").catch((error: unknown) => error)

    expect(first).toMatchObject({ status: 401 })
    expect(second).toMatchObject({ status: 401 })
    expect(events).toEqual([])
  })

  it("shows the API message only for a 409 conflict", () => {
    expect(conflictMessage(new ApiError(409, "Conflict", "Order is paid"), "Error")).toBe("Order is paid")
    expect(conflictMessage(new ApiError(500, "Internal Server Error", "boom"), "Error")).toBe("Error")
    expect(conflictMessage(new Error("offline"), "Error")).toBe("Error")
  })
})

/**
 * F4: on a shared terminal the identified staff member's claim rides on the
 * writes (the API swaps the identity on the order writes and ignores it
 * elsewhere); reads and personal sessions never carry it.
 */
describe("acting claim", () => {
  function headerFetch() {
    const seen: Array<string | null> = []
    const fetch = vi.fn(async (request: Request) => {
      seen.push(request.headers.get("X-Vipe-Acting"))
      return json(200, {})
    })
    return { fetch, seen }
  }
  afterEach(() => clearActingToken())

  it("sends X-Vipe-Acting on writes while a staff member is identified", async () => {
    const { fetch, seen } = headerFetch()
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })
    setActingToken("acting-jwt")
    await api.POST("/api/orders", { body: {} as never })
    await api.PATCH("/api/orders/{id}/status", { params: { path: { id: "o-1" } }, body: {} as never })
    expect(seen).toEqual(["acting-jwt", "acting-jwt"])
  })

  it("never sends it on reads, nor once the identification ended", async () => {
    const { fetch, seen } = headerFetch()
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })
    setActingToken("acting-jwt")
    await api.GET("/api/tables")
    clearActingToken()
    await api.POST("/api/orders", { body: {} as never })
    expect(seen).toEqual([null, null])
  })

  it("keeps it on the retry after a silent refresh", async () => {
    const seen: Array<string | null> = []
    const answers = [unauthorized(), new Response(null, { status: 204 }), json(200, {})]
    const fetch = vi.fn(async (request: Request) => {
      seen.push(`${new URL(request.url).pathname}:${request.headers.get("X-Vipe-Acting")}`)
      return answers.shift()!
    })
    const api = createApiClient({ baseUrl: "http://localhost:3000", fetch })
    setActingToken("acting-jwt")
    await api.POST("/api/orders", { body: {} as never })
    expect(seen).toEqual(["/api/orders:acting-jwt", "/api/auth/refresh:null", "/api/orders:acting-jwt"])
  })
})
