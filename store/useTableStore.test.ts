import { beforeEach, describe, expect, it } from "vitest"

import { useTableStore } from "./useTableStore"
import type { Table } from "@/types"

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t-1",
    number: 1,
    status: "available",
    ...overrides,
  }
}

describe("useTableStore.applyTableChange", () => {
  beforeEach(() => {
    // Vanilla store instance — no React render required (design.md D1
    // rationale, "Purity and composition"). Reset between tests so seeded
    // state from one test never leaks into the next.
    useTableStore.setState({ tables: [] })
  })

  it("leaves getState().tables reference-identical to its pre-call value on a no-op change", () => {
    const seeded = [makeTable({ id: "t-1" }), makeTable({ id: "t-2" })]
    useTableStore.setState({ tables: seeded })

    const before = useTableStore.getState().tables

    // UPDATE for an id absent from `prev` is dropped, not upserted (D5) — a no-op.
    useTableStore.getState().applyTableChange({
      eventType: "UPDATE",
      new: { id: "t-9", number: 9, status: "occupied" },
    })

    expect(useTableStore.getState().tables).toBe(before)
  })

  it("replaces exactly one element on an UPDATE and preserves every other element's reference", () => {
    const untouched = makeTable({ id: "t-2", status: "available" })
    const seeded = [makeTable({ id: "t-1", status: "available" }), untouched]
    useTableStore.setState({ tables: seeded })

    useTableStore.getState().applyTableChange({
      eventType: "UPDATE",
      new: { id: "t-1", number: 1, status: "occupied", updated_at: "2026-01-01T00:00:00.000Z" },
    })

    const after = useTableStore.getState().tables
    expect(after).not.toBe(seeded)
    expect(after).toHaveLength(2)
    expect(after[0].status).toBe("occupied")
    // The untouched row keeps its exact reference — this is what suppresses
    // an unrelated consumer's re-render (D6).
    expect(after[1]).toBe(untouched)
  })
})
