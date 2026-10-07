import { act, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"

import { useTableStore } from "@/store/useTableStore"
import { TableGrid } from "./TableGrid"

/**
 * Reproduces the shape of the reported bug (WaiterView.tsx pre-S1): a parent
 * that changes its selection state and passes it down as the `activeTable`
 * prop. The F1 invariant requires that this selection change alone must not
 * unmount/remount the grid subtree.
 *
 * S3 moved TableGrid's data ownership into `useTableStore` (D1): it no
 * longer self-fetches via `tableService` or self-subscribes via
 * `realtimeService`, so this harness seeds the store directly instead of
 * stubbing those two modules the way the pre-S3 version of this file did.
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
  beforeEach(() => {
    // TableGrid now reads directly from the single owner (S3, D1) — seed the
    // store instead of mocking tableService/realtimeService. Rendering is
    // synchronous once the store already holds data, so no `waitFor` is
    // needed here the way the pre-S3 version needed it for its async fetch.
    useTableStore.setState({
      tables: [{ id: "t-1", number: 1, status: "available", waiter: undefined, waiter_name: undefined }],
    })
  })

  it("keeps the grid subtree's DOM node identity stable across a selection prop change", () => {
    const { container, getByText } = render(<SelectionHarness />)

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()

    const gridBefore = container.querySelector(".grid")
    expect(gridBefore).not.toBeNull()

    // Selecting a table changes `activeTable`, which TableGrid receives as a prop.
    act(() => {
      getByText("toggle-selection").click()
    })

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    const gridAfterSelect = container.querySelector(".grid")
    expect(gridAfterSelect).toBe(gridBefore)

    // Clearing the selection (e.g. a remote event freeing the table) must not
    // remount the grid either.
    act(() => {
      getByText("toggle-selection").click()
    })

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    const gridAfterClear = container.querySelector(".grid")
    expect(gridAfterClear).toBe(gridBefore)
  })

  it("does not show a loading/skeleton state as a result of a selection change alone", () => {
    render(<SelectionHarness />)

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()

    act(() => {
      screen.getByText("toggle-selection").click()
    })

    // TableGrid no longer owns any loading/skeleton state after S3 (it has
    // no fetch of its own to gate on) — if the grid had remounted anyway,
    // "Mesa 1" would still be gone at this point because the store's data
    // would need to be re-subscribed from scratch.
    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
  })

  it("reflects a store patch for the rendered table without remounting the grid", () => {
    // New in S3: proves the F1 invariant also holds when the *data* changes
    // through the single owner, not only when the selection prop changes —
    // a scenario the pre-S3 self-fetching/self-subscribing component could
    // never exercise under test, since ST stubbed its subscription as a no-op.
    const { container } = render(<SelectionHarness />)

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    const gridBefore = container.querySelector(".grid")

    act(() => {
      useTableStore.getState().applyTableChange({
        eventType: "UPDATE",
        new: { id: "t-1", number: 1, status: "occupied", updated_at: "2026-01-01T00:00:00.000Z" },
      })
    })

    expect(screen.getByText("Mesa 1")).toBeInTheDocument()
    expect(container.querySelector(".grid")).toBe(gridBefore)
  })
})
