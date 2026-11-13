import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Profile, Table } from "@/types"

/** ux-carta-mesero S4: the waiter floor puts carta requests on their table. */
const env = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: vi.fn() } }))
vi.mock("@/lib/api/realtime", () => ({ realtimeService: { subscribeToCartaInbox: () => () => {} } }))

import { useTableStore } from "@/store/useTableStore"
import { TablesSection } from "./TablesSection"

const tables: Table[] = [
  { id: "t-1", number: 3, status: "occupied", zoneId: "z-1", x: 0.2, y: 0.3, w: 0.1, h: 0.1, shape: "square" },
  { id: "t-2", number: 4, status: "occupied", zoneId: "z-1", x: 0.6, y: 0.3, w: 0.1, h: 0.1, shape: "square" },
]
const zones = [{ id: "z-1", name: "Terraza", aspect: 1.6, labels: [] }]
const profile = { id: "w-1", name: "Ana", role: "waiter" } as unknown as Profile

beforeEach(() => {
  useTableStore.setState({ tables })
  env.get.mockReset().mockResolvedValue({
    data: {
      proposals: [],
      requests: [{ id: "r-1", kind: "waiter", orderId: "o-1", tableNumber: 3, zoneName: "Terraza", waiterName: null, createdAt: "2026-11-12T13:05:00.000Z" }],
    },
  })
})

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
)

describe("TablesSection — carta alerts on the floor", () => {
  it("draws the alert badge on the table the request came from", async () => {
    render(
      wrap(
        <TablesSection
          activeTable={null}
          profile={profile}
          profiles={[]}
          onSelectTable={() => {}}
          onReserveTable={() => {}}
          onReleaseTable={() => {}}
          isTableAccessible={() => true}
          floor={{ zones }}
        />,
      ),
    )
    const table = await screen.findByRole("button", { name: /^Mesa 3,.*llama al mesero$/ })
    expect(within(table).getByTestId("table-alert")).toHaveAttribute("data-kind", "waiter")
    await waitFor(() => expect(env.get).toHaveBeenCalled())
    expect(within(screen.getByRole("button", { name: /^Mesa 4,/ })).queryByTestId("table-alert")).not.toBeInTheDocument()
  })
})
