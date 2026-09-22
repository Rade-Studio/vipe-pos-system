import { act, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

// TableGrid self-fetches via tableService and subscribes via realtimeService
// inside a useEffect (S3 will move this ownership into the store). Both are
// stubbed here so the component can render in jsdom without a real Supabase
// client or network access.
vi.mock("@/lib/supabase/service", () => ({
  tableService: {
    getAll: vi.fn().mockResolvedValue([
      { id: "t-1", number: 1, status: "available", waiter_id: null, waiter_name: null, updated_at: null },
    ]),
  },
}))

vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: {
    subscribeToTables: vi.fn(() => () => {}),
  },
}))

import { TableGrid } from "./TableGrid"

/**
 * Reproduces the shape of the reported bug (WaiterView.tsx pre-S1): a parent
 * that changes its selection state and passes it down as the `activeTable`
 * prop. The F1 invariant requires that this selection change alone must not
 * unmount/remount the grid subtree.
 */
function SelectionHarness() {
  const [activeTable, setActiveTable] = useState<string | null>(null)

  return (
    <div>
      <button onClick={() => setActiveTable((prev) => (prev === "t-1" ? null : "t-1"))}>toggle-selection</button>
      <TableGrid
        activeTable={activeTable}
        waiterId="w-1"
        onSelectTable={setActiveTable}
        onReserveTable={() => {}}
        onReleaseTable={() => {}}
        isAccessible={() => true}
        profiles={[]}
      />
    </div>
  )
}

describe("TableGrid — F1 remount invariant (Selection State Must Not Force A Grid Remount)", () => {
  it("keeps the grid subtree's DOM node identity stable across a selection prop change", async () => {
    const { container, getByText } = render(<SelectionHarness />)

    // Wait past the initial-load skeleton into the real grid.
    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())

    const gridBefore = container.querySelector(".grid")
    expect(gridBefore).not.toBeNull()

    // Selecting a table changes `activeTable`, which TableGrid receives as a prop.
    act(() => {
      getByText("toggle-selection").click()
    })

    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())

    const gridAfterSelect = container.querySelector(".grid")
    expect(gridAfterSelect).toBe(gridBefore)

    // Clearing the selection (e.g. a remote event freeing the table) must not
    // remount the grid either.
    act(() => {
      getByText("toggle-selection").click()
    })

    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())

    const gridAfterClear = container.querySelector(".grid")
    expect(gridAfterClear).toBe(gridBefore)
  })

  it("does not show a loading/skeleton state as a result of a selection change alone", async () => {
    render(<SelectionHarness />)

    await waitFor(() => expect(screen.getByText("Mesa 1")).toBeInTheDocument())

    act(() => {
      screen.getByText("toggle-selection").click()
    })

    // If the grid had remounted, `initialLoadDone`/`loading` would reset and the
    // skeleton (no "Mesa 1" text) would reappear before the fetch resolves again.
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
  })
})
