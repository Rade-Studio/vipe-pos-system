import { createElement, type ReactNode } from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T6 (S4) — the waiter map reads the zones once through React Query and an
 * admin's zone edit (a realtime `zones` event) refetches them, so the map
 * follows the floor plan live.
 */

const env = vi.hoisted(() => ({
  getAll: vi.fn(),
  zoneCallbacks: [] as ((payload: unknown) => void)[],
  unsubscribes: 0,
}))

vi.mock("@/lib/api/zones", () => ({ getAll: () => env.getAll() }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToZones: (callback: (payload: unknown) => void) => {
      env.zoneCallbacks.push(callback)
      return () => {
        env.unsubscribes += 1
      }
    },
  },
}))

import { useZones, ZONES_QUERY_KEY } from "@/hooks/use-zones"

const zone = (id: string, name: string, aspect = 1.6) => ({
  id,
  name,
  aspect,
  sortOrder: 0,
  labels: [],
  active: true,
  createdAt: null,
  updatedAt: null,
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  return { client, ...renderHook(() => useZones(), { wrapper }) }
}

beforeEach(() => {
  env.getAll.mockReset()
  env.zoneCallbacks = []
  env.unsubscribes = 0
})

describe("useZones", () => {
  it("reads GET /zones once under ['zones']", async () => {
    env.getAll.mockResolvedValue([zone("z-1", "Salón principal")])
    const { result, client } = setup()

    await waitFor(() => expect(result.current.data).toEqual([zone("z-1", "Salón principal")]))
    expect(env.getAll).toHaveBeenCalledTimes(1)
    expect(ZONES_QUERY_KEY).toEqual(["zones"])
    expect(client.getQueryData(["zones"])).toEqual([zone("z-1", "Salón principal")])
  })

  it("refetches the zones when a zones realtime event arrives, and unsubscribes on unmount", async () => {
    env.getAll.mockResolvedValueOnce([zone("z-1", "Salón principal")])
    env.getAll.mockResolvedValueOnce([zone("z-1", "Terraza", 2)])
    const { result, unmount } = setup()
    await waitFor(() => expect(result.current.data?.[0].name).toBe("Salón principal"))
    expect(env.zoneCallbacks).toHaveLength(1)

    await act(async () => {
      env.zoneCallbacks[0]({ table: "zones", eventType: "UPDATE", new: { id: "z-1", name: "Terraza" }, old: {} })
    })

    await waitFor(() => expect(result.current.data?.[0].name).toBe("Terraza"))
    expect(env.getAll).toHaveBeenCalledTimes(2)

    unmount()
    expect(env.unsubscribes).toBe(1)
  })
})
