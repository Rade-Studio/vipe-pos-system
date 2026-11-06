import { describe, expect, it } from "vitest"
import { canRedo, canUndo, createHistory, record, redo, undo } from "./history"

/** T26 — undo/redo of the unsaved layout session. */

describe("layout history", () => {
  it("undoes and redoes recorded states", () => {
    let h = createHistory<Record<string, number>>({})
    expect(canUndo(h)).toBe(false)
    h = record(h, { a: 1 })
    h = record(h, { a: 2 })
    h = undo(h)
    expect(h.present).toEqual({ a: 1 })
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toEqual({ a: 2 })
    expect(canRedo(h)).toBe(false)
  })

  it("a new edit after undo drops the redo branch", () => {
    let h = record(record(createHistory({ a: 0 }), { a: 1 }), { a: 2 })
    h = record(undo(h), { a: 5 })
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toEqual({ a: 1 })
  })

  it("coalesces steps of one gesture (same key) into one undo step", () => {
    let h = createHistory({ a: 0 })
    h = record(h, { a: 1 }, "drag:1")
    h = record(h, { a: 2 }, "drag:1")
    h = record(h, { a: 3 }, "drag:1")
    expect(h.past).toHaveLength(1)
    expect(undo(h).present).toEqual({ a: 0 })
    h = record(h, { a: 4 }, "drag:2")
    expect(undo(h).present).toEqual({ a: 3 })
  })

  it("ignores a state equal to the present and an undo/redo at the ends", () => {
    const h = createHistory({ a: 0 })
    expect(record(h, { a: 0 })).toBe(h)
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it("after an undo the same gesture key starts a new step", () => {
    let h = record(createHistory({ a: 0 }), { a: 1 }, "k")
    h = undo(h)
    h = record(h, { a: 2 }, "k")
    expect(h.past).toEqual([{ a: 0 }])
  })
})
