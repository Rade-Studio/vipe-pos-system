/**
 * Step state of the order picker (T10, S5): Categoría → Subcategoría → Plato →
 * Agregar, one level per screen. Pure, so the waiter flow and delivery (T11)
 * share it and it is tested without React.
 */

export type Step = 1 | 2 | 3 | 4

export const STEP_LABELS: Record<Step, string> = {
  1: "Categoría",
  2: "Subcategoría",
  3: "Plato",
  4: "Agregar",
}

/** Phone crumbs (390 px: four columns of ~90 px). */
export const STEP_SHORT_LABELS: Record<Step, string> = {
  1: "Categ.",
  2: "Subcat.",
  3: "Plato",
  4: "Agregar",
}

export interface StepState {
  step: Step
  categoryId: string | null
  /** The picked subcategory; null for "Sin subcategoría" or a skipped step 2. */
  subcategoryId: string | null
  /** The category has no subcategories: step 2 was skipped. */
  skipped: boolean
  dishId: string | null
  quantity: number
  note: string
}

export type StepAction =
  | { type: "category"; id: string; skipsSubcategories: boolean }
  | { type: "subcategory"; id: string | null }
  | { type: "dish"; id: string; available: boolean }
  | { type: "quantity"; delta: number }
  | { type: "note"; note: string }
  | { type: "crumb"; step: Step }
  | { type: "back" }
  | { type: "added" }

export const initialStepState: StepState = {
  step: 1,
  categoryId: null,
  subcategoryId: null,
  skipped: false,
  dishId: null,
  quantity: 1,
  note: "",
}

const PICK_RESET = { dishId: null, quantity: 1, note: "" } as const

/** The state at `step` keeping only what was picked before it. */
function rewind(state: StepState, step: Step): StepState {
  if (step === 1) return initialStepState
  if (step === 2) return { ...state, ...PICK_RESET, step, subcategoryId: null }
  return { ...state, ...PICK_RESET, step }
}

/** A crumb is reachable when it is an earlier step that was not skipped. */
export function canGoToStep(state: StepState, step: Step): boolean {
  return step < state.step && !(step === 2 && state.skipped)
}

export function stepReducer(state: StepState, action: StepAction): StepState {
  switch (action.type) {
    case "category":
      return {
        ...initialStepState,
        categoryId: action.id,
        skipped: action.skipsSubcategories,
        step: action.skipsSubcategories ? 3 : 2,
      }
    case "subcategory":
      return { ...state, ...PICK_RESET, subcategoryId: action.id, step: 3 }
    case "dish":
      // "Agotado" stays in place: the tap only tells (the view toasts).
      if (!action.available) return state
      return { ...state, ...PICK_RESET, dishId: action.id, step: 4 }
    case "quantity":
      return { ...state, quantity: Math.max(1, state.quantity + action.delta) }
    case "note":
      return { ...state, note: action.note }
    case "crumb":
      return canGoToStep(state, action.step) ? rewind(state, action.step) : state
    case "back": {
      if (state.step === 1) return state
      const to = state.step === 3 && state.skipped ? 1 : ((state.step - 1) as Step)
      return rewind(state, to)
    }
    case "added":
      return initialStepState
  }
}

export const addedMessage = (quantity: number, name: string) => `✓ ${quantity}× ${name} agregada`
export const soldOutMessage = (name: string) => `Agotado: ${name} · ofrece otra opción`
