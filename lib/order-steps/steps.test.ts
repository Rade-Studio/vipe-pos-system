import { describe, expect, it } from "vitest"

import {
  addedMessage,
  canGoToStep,
  initialStepState,
  soldOutMessage,
  stepReducer,
  type StepAction,
  type StepState,
} from "./steps"

const run = (...actions: StepAction[]): StepState => actions.reduce(stepReducer, initialStepState)

const pickCategory: StepAction = { type: "category", id: "c-1", skipsSubcategories: false }
const pickDirect: StepAction = { type: "category", id: "c-2", skipsSubcategories: true }

describe("step picker reducer (T10, S5)", () => {
  it("starts on Categoría with nothing picked", () => {
    expect(initialStepState).toEqual({
      step: 1,
      categoryId: null,
      subcategoryId: null,
      skipped: false,
      dishId: null,
      quantity: 1,
      note: "",
    })
  })

  it("walks Categoría → Subcategoría → Plato → Agregar, one level per step", () => {
    const afterCategory = run(pickCategory)
    expect(afterCategory).toMatchObject({ step: 2, categoryId: "c-1", skipped: false })

    const afterSub = run(pickCategory, { type: "subcategory", id: "s-1" })
    expect(afterSub).toMatchObject({ step: 3, subcategoryId: "s-1" })

    const afterDish = run(pickCategory, { type: "subcategory", id: "s-1" }, { type: "dish", id: "d-1", available: true })
    expect(afterDish).toMatchObject({ step: 4, dishId: "d-1", quantity: 1, note: "" })
  })

  it("accepts the dishes without subcategory as a choice of step 2", () => {
    expect(run(pickCategory, { type: "subcategory", id: null })).toMatchObject({ step: 3, subcategoryId: null })
  })

  it("skips step 2 for a category without subcategories", () => {
    const state = run(pickDirect)
    expect(state).toMatchObject({ step: 3, categoryId: "c-2", subcategoryId: null, skipped: true })
    expect(canGoToStep(state, 2)).toBe(false)
    expect(canGoToStep(state, 1)).toBe(true)
  })

  it("leaves an Agotado dish in place: the state does not change", () => {
    const onDishes = run(pickDirect)
    expect(stepReducer(onDishes, { type: "dish", id: "d-out", available: false })).toBe(onDishes)
  })

  it("keeps the quantity at 1 or more and stores the note", () => {
    const onAdd = run(pickDirect, { type: "dish", id: "d-1", available: true })
    expect(stepReducer(onAdd, { type: "quantity", delta: -1 }).quantity).toBe(1)
    const two = run(pickDirect, { type: "dish", id: "d-1", available: true }, { type: "quantity", delta: 1 })
    expect(two.quantity).toBe(2)
    expect(stepReducer(two, { type: "note", note: "sin hielo" }).note).toBe("sin hielo")
  })

  it("goes back one step, over the skipped step 2, and resets what was picked after it", () => {
    const onAdd = run(pickCategory, { type: "subcategory", id: "s-1" }, { type: "dish", id: "d-1", available: true }, { type: "quantity", delta: 2 })
    const back = stepReducer(onAdd, { type: "back" })
    expect(back).toMatchObject({ step: 3, subcategoryId: "s-1", dishId: null, quantity: 1 })
    expect(stepReducer(back, { type: "back" })).toMatchObject({ step: 2, categoryId: "c-1", subcategoryId: null })
    expect(stepReducer(stepReducer(back, { type: "back" }), { type: "back" })).toEqual(initialStepState)

    const directDishes = run(pickDirect)
    expect(stepReducer(directDishes, { type: "back" })).toEqual(initialStepState)
    expect(stepReducer(initialStepState, { type: "back" })).toBe(initialStepState)
  })

  it("jumps back through a crumb but never forward or to a skipped step", () => {
    const onAdd = run(pickCategory, { type: "subcategory", id: "s-1" }, { type: "dish", id: "d-1", available: true })
    expect(canGoToStep(onAdd, 2)).toBe(true)
    expect(stepReducer(onAdd, { type: "crumb", step: 2 })).toMatchObject({ step: 2, categoryId: "c-1", subcategoryId: null, dishId: null })
    expect(stepReducer(onAdd, { type: "crumb", step: 1 })).toEqual(initialStepState)

    const onCategory = run(pickCategory)
    expect(canGoToStep(onCategory, 3)).toBe(false)
    expect(stepReducer(onCategory, { type: "crumb", step: 3 })).toBe(onCategory)

    const direct = run(pickDirect, { type: "dish", id: "d-1", available: true })
    expect(stepReducer(direct, { type: "crumb", step: 2 })).toBe(direct)
  })

  it("returns to Categoría after Agregar", () => {
    const onAdd = run(pickCategory, { type: "subcategory", id: "s-1" }, { type: "dish", id: "d-1", available: true }, { type: "quantity", delta: 1 })
    expect(stepReducer(onAdd, { type: "added" })).toEqual(initialStepState)
  })

  it("words the toasts of the flow", () => {
    expect(addedMessage(2, "Bandeja paisa")).toBe("✓ 2× Bandeja paisa agregada")
    expect(soldOutMessage("Ajiaco")).toBe("Agotado: Ajiaco · ofrece otra opción")
  })
})
