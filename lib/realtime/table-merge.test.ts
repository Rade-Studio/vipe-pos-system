import { describe, expect, it } from "vitest"

import { mergeRowList, mergeTableList, toTable, toTimestamp, type RowChange, type TableChange, type TableRow } from "./table-merge"
import type { Table } from "@/types"

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t-1",
    number: 1,
    status: "available",
    ...overrides,
  }
}

describe("mergeTableList — D10 behaviour table", () => {
  // Row 1: INSERT, new.id present, id not in prev -> new array, row appended
  it("INSERT with a new id appends the row and returns a new array", () => {
    const prev = [makeTable({ id: "t-1" })]
    const incoming: TableRow = { id: "t-2", number: 2, status: "occupied" }
    const change: TableChange = { eventType: "INSERT", new: incoming }

    const result = mergeTableList(prev, change)

    expect(result).not.toBe(prev)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(prev[0])
    expect(result[1]).toEqual(toTable(incoming))
  })

  // Row 2: INSERT, new.id present, id already in prev -> prev (idempotent)
  it("INSERT with an id already present is idempotent and returns prev", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "INSERT", new: { id: "t-1", number: 1, status: "available" } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 3: INSERT, new.id missing/null -> prev
  it("INSERT with a missing new.id is a no-op", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "INSERT", new: { id: null, number: 2, status: "occupied" } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 4: UPDATE, new.id present, id in prev, incoming not older -> new array,
  // that one row replaced; all other element references preserved
  it("UPDATE with a non-stale timestamp replaces only the matching row and preserves other references", () => {
    const untouched = makeTable({ id: "t-2", status: "available" })
    const prev = [makeTable({ id: "t-1", status: "available" }), untouched]
    const change: TableChange = {
      eventType: "UPDATE",
      new: { id: "t-1", number: 1, status: "occupied", updated_at: "2026-01-01T00:00:00.000Z" },
    }

    const result = mergeTableList(prev, change)

    expect(result).not.toBe(prev)
    expect(result[0].status).toBe("occupied")
    expect(result[1]).toBe(untouched)
  })

  // Row 5: UPDATE, new.id present, id in prev, incoming strictly older -> prev (D4 out-of-order rejection)
  it("UPDATE with a strictly older timestamp is rejected as out-of-order and returns prev", () => {
    const prev = [makeTable({ id: "t-1", status: "occupied", updated_at: new Date("2026-01-02T00:00:00.000Z") })]
    const change: TableChange = {
      eventType: "UPDATE",
      new: { id: "t-1", number: 1, status: "available", updated_at: "2026-01-01T00:00:00.000Z" },
    }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 6: UPDATE, new.id present, id NOT in prev -> prev (D5 — dropped, not upserted)
  it("UPDATE for an id not present in prev is dropped, not upserted", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "UPDATE", new: { id: "t-9", number: 9, status: "occupied" } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 7: UPDATE, new.id missing/null -> prev
  it("UPDATE with a missing new.id is a no-op", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "UPDATE", new: { id: null, number: 1, status: "occupied" } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 8: DELETE, old.id present, id in prev -> new array with that row filtered out
  it("DELETE with a matching old.id filters that row out and returns a new array", () => {
    const kept = makeTable({ id: "t-2" })
    const prev = [makeTable({ id: "t-1" }), kept]
    const change: TableChange = { eventType: "DELETE", old: { id: "t-1" } }

    const result = mergeTableList(prev, change)

    expect(result).not.toBe(prev)
    expect(result).toEqual([kept])
  })

  // Row 9: DELETE, old.id present, id NOT in prev -> prev (no allocation, so no re-render)
  it("DELETE for an id not present in prev is a no-op", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "DELETE", old: { id: "t-9" } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 10: DELETE, old.id missing/null -> prev
  it("DELETE with a missing old.id is a no-op", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "DELETE", old: { id: null } }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })

  // Row 11: any other eventType -> prev
  it("an unknown eventType is a no-op", () => {
    const prev = [makeTable({ id: "t-1" })]
    const change: TableChange = { eventType: "TRUNCATE" }

    const result = mergeTableList(prev, change)

    expect(result).toBe(prev)
  })
})

describe("toTable", () => {
  it("carries and normalizes updated_at to a Date (D4)", () => {
    const result = toTable({ id: "t-1", number: 1, status: "available", updated_at: "2026-01-01T00:00:00.000Z" })

    expect(result?.updated_at).toBeInstanceOf(Date)
    expect(result?.updated_at?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
  })

  it("leaves updated_at undefined when the row carries none", () => {
    const result = toTable({ id: "t-1", number: 1, status: "available" })

    expect(result?.updated_at).toBeUndefined()
  })

  it("returns null when id is absent", () => {
    const result = toTable({ id: null, number: 1, status: "available" })

    expect(result).toBeNull()
  })
})

describe("toTimestamp", () => {
  it("returns 0 for null", () => {
    expect(toTimestamp(null)).toBe(0)
  })

  it("returns 0 for undefined", () => {
    expect(toTimestamp(undefined)).toBe(0)
  })

  it("returns 0 for unparseable input", () => {
    expect(toTimestamp("not-a-date")).toBe(0)
  })

  it("returns epoch milliseconds for a valid Date", () => {
    const date = new Date("2026-01-01T00:00:00.000Z")

    expect(toTimestamp(date)).toBe(date.getTime())
  })

  it("returns epoch milliseconds for a valid date string", () => {
    expect(toTimestamp("2026-01-01T00:00:00.000Z")).toBe(new Date("2026-01-01T00:00:00.000Z").getTime())
  })
})

describe("mergeRowList — raw-row merge (D9)", () => {
  type RawTable = { id: string; number: number; status: string; waiter_id?: string | null; updated_at?: string | null }

  function makeRow(overrides: Partial<RawTable> = {}): RawTable {
    return { id: "t-1", number: 1, status: "available", ...overrides }
  }

  it("INSERT with a new id appends the row verbatim (no field mapping)", () => {
    const prev = [makeRow({ id: "t-1" })]
    const incoming = { id: "t-2", number: 2, status: "occupied", waiter_id: "w-1", updated_at: "2026-01-01T00:00:00.000Z" }
    const change: RowChange = { eventType: "INSERT", new: incoming }

    const result = mergeRowList(prev, change)

    expect(result).not.toBe(prev)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(prev[0])
    // Verbatim: raw column names survive untouched, unlike toTable's waiter_id -> waiter rename.
    expect(result[1]).toEqual(incoming)
  })

  it("INSERT with an id already present is idempotent and returns prev", () => {
    const prev = [makeRow({ id: "t-1" })]
    const change: RowChange = { eventType: "INSERT", new: { id: "t-1", number: 1, status: "available" } }

    const result = mergeRowList(prev, change)

    expect(result).toBe(prev)
  })

  it("UPDATE preserves waiter_id/updated_at under their raw names on the replaced row", () => {
    const untouched = makeRow({ id: "t-2" })
    const prev = [makeRow({ id: "t-1", status: "available" }), untouched]
    const incoming = {
      id: "t-1",
      number: 1,
      status: "occupied",
      waiter_id: "w-9",
      updated_at: "2026-01-01T00:00:00.000Z",
    }
    const change: RowChange = { eventType: "UPDATE", new: incoming }

    const result = mergeRowList(prev, change)

    expect(result).not.toBe(prev)
    expect(result[0]).toEqual(incoming)
    expect((result[0] as RawTable).waiter_id).toBe("w-9")
    expect((result[0] as RawTable).updated_at).toBe("2026-01-01T00:00:00.000Z")
    expect(result[1]).toBe(untouched)
  })

  it("UPDATE with a strictly older timestamp is rejected as out-of-order and returns prev", () => {
    const prev = [makeRow({ id: "t-1", status: "occupied", updated_at: "2026-01-02T00:00:00.000Z" })]
    const change: RowChange = {
      eventType: "UPDATE",
      new: { id: "t-1", number: 1, status: "available", updated_at: "2026-01-01T00:00:00.000Z" },
    }

    const result = mergeRowList(prev, change)

    expect(result).toBe(prev)
  })

  it("UPDATE for an id not present in prev is dropped, not upserted", () => {
    const prev = [makeRow({ id: "t-1" })]
    const change: RowChange = { eventType: "UPDATE", new: { id: "t-9", number: 9, status: "occupied" } }

    const result = mergeRowList(prev, change)

    expect(result).toBe(prev)
  })

  it("DELETE with a matching old.id filters that row out and returns a new array", () => {
    const kept = makeRow({ id: "t-2" })
    const prev = [makeRow({ id: "t-1" }), kept]
    const change: RowChange = { eventType: "DELETE", old: { id: "t-1" } }

    const result = mergeRowList(prev, change)

    expect(result).not.toBe(prev)
    expect(result).toEqual([kept])
  })

  it("DELETE for an id not present in prev is a no-op", () => {
    const prev = [makeRow({ id: "t-1" })]
    const change: RowChange = { eventType: "DELETE", old: { id: "t-9" } }

    const result = mergeRowList(prev, change)

    expect(result).toBe(prev)
  })

  it("an unknown eventType is a no-op", () => {
    const prev = [makeRow({ id: "t-1" })]
    const change: RowChange = { eventType: "TRUNCATE" }

    const result = mergeRowList(prev, change)

    expect(result).toBe(prev)
  })
})
