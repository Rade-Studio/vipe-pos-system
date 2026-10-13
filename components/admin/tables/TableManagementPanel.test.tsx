import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// TableManagementPanel self-fetches via tableService and subscribes via
// realtimeService inside a useEffect. Both are stubbed here so the component
// can render in jsdom without a real Supabase client or network access.
vi.mock("@/lib/supabase/service", () => ({
  tableService: {
    getAll: vi.fn().mockResolvedValue([
      {
        id: "t-1",
        number: 1,
        status: "occupied",
        waiter_id: "w-1",
        updated_at: "2026-01-01T00:00:00.000Z",
        profiles: { id: "w-1", full_name: "Ana" },
      },
    ]),
    // Mirrors the real implementation's shape: raw row fields plus a
    // `profiles(id, full_name)` join and a derived `waiter_name`.
    getById: vi.fn().mockResolvedValue({
      id: "t-1",
      number: 1,
      status: "occupied",
      waiter_id: "w-2",
      updated_at: "2026-01-02T00:00:00.000Z",
      profiles: { id: "w-2", full_name: "Nueva Mesera" },
      waiter_name: "Nueva Mesera",
    }),
  },
}))

// A stable `toast` reference matters here: the component's data-loading
// effect depends on `[toast]`, so a mock that returns a fresh function on
// every call would re-trigger the effect (and its setLoading(true)) forever.
const toastMock = vi.fn()
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}))

let capturedCallback: ((payload: unknown) => void) | null = null
vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: {
    subscribeToTables: vi.fn((cb: (payload: unknown) => void) => {
      capturedCallback = cb
      return () => {}
    }),
  },
}))

import { tableService } from "@/lib/supabase/service"
import { TableManagementPanel } from "./TableManagementPanel"

describe("TableManagementPanel — targeted per-row refetch keeps the profiles join alive", () => {
  it("re-fetches only the changed row via tableService.getById so the new waiter's name appears without a full reload", async () => {
    const { container } = render(<TableManagementPanel />)

    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument())

    const rootBefore = container.firstElementChild
    expect(capturedCallback).not.toBeNull()

    // Simulate a postgres_changes UPDATE. A real payload never carries the
    // joined `profiles` relation — only raw columns like `waiter_id`.
    await act(async () => {
      capturedCallback?.({
        eventType: "UPDATE",
        new: {
          id: "t-1",
          number: 1,
          status: "occupied",
          waiter_id: "w-2",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
        old: { id: "t-1" },
      })
    })

    expect(tableService.getById).toHaveBeenCalledWith("t-1")
    await waitFor(() => expect(screen.getByText("Nueva Mesera")).toBeInTheDocument())
    expect(screen.queryByText("Ana")).not.toBeInTheDocument()

    // The loading spinner must never be toggled by this path — if it had
    // been, the root subtree would have been replaced (a `Loader2` branch
    // vs. the `Card` branch are different top-level elements), so the
    // container's first child would no longer be the same DOM node.
    expect(container.firstElementChild).toBe(rootBefore)
  })
})
