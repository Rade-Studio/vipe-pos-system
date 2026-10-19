import { describe, expect, it } from "vitest"
import {
  anyLevelDirty,
  currentLevel,
  formulaEditorReducer as reduce,
  initialEditorState,
  isLevelDirty,
  openTargetIds,
  type EditorState,
} from "./formula-editor"

const burger = { type: "dish" as const, id: "dish-1", name: "Hamburguesa" }
const salsa = { type: "prep" as const, id: "prep-1", name: "Salsa roja" }
const base = { type: "prep" as const, id: "prep-2", name: "Base" }

const open = (lines = [{ ingredientId: "pan", quantity: 1 }], yieldQuantity = 1): EditorState =>
  reduce(initialEditorState, { type: "open", target: burger, formula: { yieldQuantity, lines } })

describe("formulaEditorReducer", () => {
  it("opens a target with its saved formula and is not dirty", () => {
    const state = open()
    expect(state.stack).toHaveLength(1)
    expect(currentLevel(state)?.target).toEqual(burger)
    expect(currentLevel(state)?.lines).toEqual([{ ingredientId: "pan", quantity: 1 }])
    expect(isLevelDirty(currentLevel(state))).toBe(false)
  })

  it("opens a target without formula as empty with yield 1", () => {
    const state = reduce(initialEditorState, { type: "open", target: salsa })
    expect(currentLevel(state)).toMatchObject({ lines: [], yieldQuantity: 1 })
  })

  it("adds a line, merges duplicates and focuses the line", () => {
    let state = reduce(open(), { type: "addLine", line: { ingredientId: "carne", quantity: 150 } })
    expect(state.focusLineId).toBe("carne")
    state = reduce(state, { type: "addLine", line: { ingredientId: "carne", quantity: 50 } })
    expect(currentLevel(state)?.lines).toEqual([
      { ingredientId: "pan", quantity: 1 },
      { ingredientId: "carne", quantity: 200 },
    ])
    expect(isLevelDirty(currentLevel(state))).toBe(true)
  })

  it("ignores non-positive quantities on add, update, yield and scale", () => {
    const state = open()
    expect(reduce(state, { type: "addLine", line: { ingredientId: "x", quantity: 0 } })).toBe(state)
    expect(reduce(state, { type: "updateLine", ingredientId: "pan", quantity: -1 })).toBe(state)
    expect(reduce(state, { type: "setYield", yieldQuantity: 0 })).toBe(state)
    expect(reduce(state, { type: "scale", factor: 0 })).toBe(state)
  })

  it("updates and removes lines", () => {
    let state = reduce(open(), { type: "updateLine", ingredientId: "pan", quantity: 2 })
    expect(currentLevel(state)?.lines).toEqual([{ ingredientId: "pan", quantity: 2 }])
    state = reduce(state, { type: "removeLine", ingredientId: "pan" })
    expect(currentLevel(state)?.lines).toEqual([])
  })

  it("scales every line", () => {
    const state = reduce(open([{ ingredientId: "a", quantity: 10 }, { ingredientId: "b", quantity: 3 }]), {
      type: "scale",
      factor: 2,
    })
    expect(currentLevel(state)?.lines).toEqual([
      { ingredientId: "a", quantity: 20 },
      { ingredientId: "b", quantity: 6 },
    ])
  })

  it("copies lines merging duplicates and skipping the target itself", () => {
    const state = reduce(open([{ ingredientId: "a", quantity: 10 }]), {
      type: "copy",
      lines: [
        { ingredientId: "a", quantity: 5 },
        { ingredientId: "dish-1", quantity: 1 },
        { ingredientId: "c", quantity: 2 },
      ],
    })
    expect(currentLevel(state)?.lines).toEqual([
      { ingredientId: "a", quantity: 15 },
      { ingredientId: "c", quantity: 2 },
    ])
  })

  it("sets the yield and marks dirty; discard restores the saved values", () => {
    let state = reduce(open(), { type: "setYield", yieldQuantity: 4 })
    state = reduce(state, { type: "addLine", line: { ingredientId: "q", quantity: 1 } })
    expect(isLevelDirty(currentLevel(state))).toBe(true)
    state = reduce(state, { type: "discard" })
    expect(currentLevel(state)).toMatchObject({ yieldQuantity: 1, lines: [{ ingredientId: "pan", quantity: 1 }] })
    expect(isLevelDirty(currentLevel(state))).toBe(false)
  })

  it("saved makes the draft the new baseline", () => {
    let state = reduce(open(), { type: "addLine", line: { ingredientId: "q", quantity: 1 } })
    state = reduce(state, { type: "saved" })
    expect(isLevelDirty(currentLevel(state))).toBe(false)
    expect(currentLevel(state)?.lines).toHaveLength(2)
  })

  it("pushes a nested prep keeping the parent's unsaved draft", () => {
    let state = reduce(open(), { type: "addLine", line: { ingredientId: "q", quantity: 1 } })
    state = reduce(state, { type: "push", target: salsa, addToParent: 50 })
    expect(openTargetIds(state)).toEqual(["dish-1", "prep-1"])
    expect(currentLevel(state)?.target).toEqual(salsa)
    expect(state.stack[0].lines).toHaveLength(2)
    expect(anyLevelDirty(state)).toBe(true)
  })

  it("does not push a target already open in the stack or without a root", () => {
    const state = open()
    expect(reduce(state, { type: "push", target: burger })).toBe(state)
    expect(reduce(initialEditorState, { type: "push", target: salsa })).toBe(initialEditorState)
  })

  it("pop after saving a created prep adds it to the parent and focuses it", () => {
    let state = reduce(open(), { type: "push", target: salsa, addToParent: 50 })
    state = reduce(state, { type: "addLine", line: { ingredientId: "tomate", quantity: 500 } })
    state = reduce(state, { type: "saved" })
    state = reduce(state, { type: "pop", saved: true })
    expect(state.stack).toHaveLength(1)
    expect(currentLevel(state)?.lines).toEqual([
      { ingredientId: "pan", quantity: 1 },
      { ingredientId: "prep-1", quantity: 50 },
    ])
    expect(state.focusLineId).toBe("prep-1")
  })

  it("pop without saving, or of an edited existing prep, leaves the parent unchanged", () => {
    const root = open()
    const cancelled = reduce(reduce(root, { type: "push", target: salsa, addToParent: 50 }), { type: "pop", saved: false })
    expect(cancelled.stack[0].lines).toEqual(root.stack[0].lines)
    const edited = reduce(reduce(root, { type: "push", target: salsa }), { type: "pop", saved: true })
    expect(edited.stack[0].lines).toEqual(root.stack[0].lines)
  })

  it("nests without a depth limit and pops one level at a time", () => {
    let state = reduce(open(), { type: "push", target: salsa, addToParent: 50 })
    state = reduce(state, { type: "push", target: base, addToParent: 100 })
    expect(openTargetIds(state)).toEqual(["dish-1", "prep-1", "prep-2"])
    state = reduce(state, { type: "pop", saved: true })
    expect(currentLevel(state)?.target).toEqual(salsa)
    expect(currentLevel(state)?.lines).toEqual([{ ingredientId: "prep-2", quantity: 100 }])
  })

  it("never pops the root level", () => {
    const state = open()
    expect(reduce(state, { type: "pop", saved: true })).toBe(state)
  })

  it("clearFocus resets the focused line", () => {
    const state = reduce(open(), { type: "addLine", line: { ingredientId: "c", quantity: 1 } })
    expect(reduce(state, { type: "clearFocus" }).focusLineId).toBeNull()
  })

  it("close empties the stack", () => {
    const state = reduce(reduce(open(), { type: "push", target: salsa }), { type: "close" })
    expect(state).toEqual(initialEditorState)
  })
})
