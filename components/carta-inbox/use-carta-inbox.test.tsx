import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Table } from "@/types"

/** ux-carta-mesero S4: the floor reads the same inbox as the Carta button, over one realtime listener. */
const env = vi.hoisted(() => ({
  inbox: { proposals: [] as unknown[], requests: [] as unknown[] },
  get: vi.fn(),
  listeners: [] as (() => void)[],
}))

vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: vi.fn() } }))
vi.mock("@/lib/api/print", () => ({ sendCommand: vi.fn() }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => false }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToCartaInbox: (cb: () => void) => {
      env.listeners.push(cb)
      return () => {
        env.listeners = env.listeners.filter((l) => l !== cb)
      }
    },
  },
}))

import { CartaInbox } from "./CartaInbox"
import { useCartaTableAlerts } from "./use-carta-inbox"

const tables: Table[] = [
  { id: "t-1", number: 12, status: "occupied", zoneId: "z-t" },
  { id: "t-2", number: 12, status: "occupied", zoneId: "z-s" },
]
const zones = [
  { id: "z-t", name: "Terraza", aspect: 1.6, labels: [] },
  { id: "z-s", name: "Salón", aspect: 1.6, labels: [] },
]
const row = { orderId: "o-1", waiterName: null, createdAt: "2026-11-12T13:05:00.000Z" }

function Probe() {
  const alertOf = useCartaTableAlerts(tables, zones)
  return <p data-testid="probe">{tables.map((t) => `${t.id}:${alertOf(t)?.count ?? 0}`).join(" ")}</p>
}

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
)

beforeEach(() => {
  env.inbox = { proposals: [], requests: [{ ...row, id: "r-1", kind: "bill", tableNumber: 12, zoneName: "Terraza" }] }
  env.get.mockReset().mockImplementation(async () => ({ data: env.inbox }))
  env.listeners = []
})

describe("useCartaTableAlerts", () => {
  it("maps inbox items to their table and refreshes on the carta stream", async () => {
    render(wrap(<Probe />))
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("t-1:1 t-2:0"))
    env.inbox = {
      proposals: [{ ...row, id: "p-1", tableNumber: 12, zoneName: "Salón", note: null, lines: [] }],
      requests: env.inbox.requests,
    }
    act(() => env.listeners.forEach((l) => l()))
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("t-1:1 t-2:1"))
  })

  it("shares one realtime listener with the Carta button and closes it with the last reader", async () => {
    const { unmount } = render(wrap(<><CartaInbox /><Probe /></>))
    await screen.findByRole("button", { name: "Carta (1 pendientes)" })
    expect(env.listeners).toHaveLength(1)
    expect(env.get).toHaveBeenCalledTimes(1)
    unmount()
    expect(env.listeners).toHaveLength(0)
  })
})
