/**
 * Non-visual state of the formula builder (odd/tasks/admin-dashboard-inventario.md,
 * T6). The editor is a stack of levels: the root is the selected dish or prep,
 * and every nested level is a preparation opened on top of it ("Hamburguesa ›
 * Salsa roja"). Each level keeps its own draft, so the parent's unsaved
 * changes survive while a child is open.
 */

import { mergeLine, scaleLines, type FormulaLine } from "./formula"

export type EditorTargetType = "dish" | "prep"

export interface EditorTarget {
  type: EditorTargetType
  id: string
  name: string
}

export interface EditorLevel {
  target: EditorTarget
  lines: FormulaLine[]
  yieldQuantity: number
  /** Last saved (or loaded) values; the level is dirty when the draft differs. */
  savedLines: FormulaLine[]
  savedYield: number
  /** Quantity of this prep added to the parent level when it is saved and popped. */
  addToParent: number | null
}

export interface EditorState {
  stack: EditorLevel[]
  /** Line whose quantity input should take focus (set by add, cleared by the UI). */
  focusLineId: string | null
}

export interface LoadedFormula {
  yieldQuantity: number
  lines: FormulaLine[]
}

export type EditorAction =
  | { type: "open"; target: EditorTarget; formula?: LoadedFormula | null }
  | { type: "push"; target: EditorTarget; formula?: LoadedFormula | null; addToParent?: number | null }
  | { type: "pop"; saved: boolean }
  | { type: "addLine"; line: FormulaLine }
  | { type: "removeLine"; ingredientId: string }
  | { type: "updateLine"; ingredientId: string; quantity: number }
  | { type: "setYield"; yieldQuantity: number }
  | { type: "scale"; factor: number }
  | { type: "copy"; lines: FormulaLine[] }
  | { type: "discard" }
  | { type: "saved" }
  | { type: "clearFocus" }
  | { type: "close" }

export const initialEditorState: EditorState = { stack: [], focusLineId: null }

const makeLevel = (target: EditorTarget, formula: LoadedFormula | null | undefined, addToParent: number | null): EditorLevel => {
  const lines = formula?.lines.map((line) => ({ ...line })) ?? []
  const yieldQuantity = formula?.yieldQuantity ?? 1
  return { target, lines, yieldQuantity, savedLines: lines, savedYield: yieldQuantity, addToParent }
}

const sameLines = (a: FormulaLine[], b: FormulaLine[]) =>
  a.length === b.length && a.every((line, i) => line.ingredientId === b[i].ingredientId && line.quantity === b[i].quantity)

export function isLevelDirty(level: EditorLevel | undefined): boolean {
  if (!level) return false
  return level.yieldQuantity !== level.savedYield || !sameLines(level.lines, level.savedLines)
}

export function currentLevel(state: EditorState): EditorLevel | undefined {
  return state.stack[state.stack.length - 1]
}

export function anyLevelDirty(state: EditorState): boolean {
  return state.stack.some(isLevelDirty)
}

/** Ids of every target open in the stack (a nested prep cannot use any of them). */
export function openTargetIds(state: EditorState): string[] {
  return state.stack.map((level) => level.target.id)
}

const updateTop = (state: EditorState, update: (level: EditorLevel) => EditorLevel, focusLineId = state.focusLineId): EditorState => {
  const top = currentLevel(state)
  if (!top) return state
  return { stack: [...state.stack.slice(0, -1), update(top)], focusLineId }
}

export function formulaEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open":
      return { stack: [makeLevel(action.target, action.formula, null)], focusLineId: null }
    case "push":
      if (state.stack.length === 0 || state.stack.some((level) => level.target.id === action.target.id)) return state
      return {
        stack: [...state.stack, makeLevel(action.target, action.formula, action.addToParent ?? null)],
        focusLineId: null,
      }
    case "pop": {
      if (state.stack.length < 2) return state
      const child = state.stack[state.stack.length - 1]
      const rest = state.stack.slice(0, -1)
      if (!action.saved || child.addToParent === null) return { stack: rest, focusLineId: null }
      const parent = rest[rest.length - 1]
      const line = { ingredientId: child.target.id, quantity: child.addToParent }
      return {
        stack: [...rest.slice(0, -1), { ...parent, lines: mergeLine(parent.lines, line) }],
        focusLineId: child.target.id,
      }
    }
    case "addLine":
      if (!(action.line.quantity > 0)) return state
      return updateTop(state, (level) => ({ ...level, lines: mergeLine(level.lines, action.line) }), action.line.ingredientId)
    case "removeLine":
      return updateTop(state, (level) => ({
        ...level,
        lines: level.lines.filter((line) => line.ingredientId !== action.ingredientId),
      }))
    case "updateLine":
      if (!(action.quantity > 0)) return state
      return updateTop(state, (level) => ({
        ...level,
        lines: level.lines.map((line) =>
          line.ingredientId === action.ingredientId ? { ...line, quantity: action.quantity } : line,
        ),
      }))
    case "setYield":
      if (!(action.yieldQuantity > 0)) return state
      return updateTop(state, (level) => ({ ...level, yieldQuantity: action.yieldQuantity }))
    case "scale":
      if (!(action.factor > 0)) return state
      return updateTop(state, (level) => ({ ...level, lines: scaleLines(level.lines, action.factor) }))
    case "copy": {
      const top = currentLevel(state)
      if (!top) return state
      const source = action.lines.filter((line) => line.ingredientId !== top.target.id && line.quantity > 0)
      return updateTop(state, (level) => ({ ...level, lines: source.reduce(mergeLine, level.lines) }))
    }
    case "discard":
      return updateTop(state, (level) => ({ ...level, lines: level.savedLines, yieldQuantity: level.savedYield }), null)
    case "saved":
      return updateTop(state, (level) => ({ ...level, savedLines: level.lines, savedYield: level.yieldQuantity }))
    case "clearFocus":
      return state.focusLineId === null ? state : { ...state, focusLineId: null }
    case "close":
      return initialEditorState
  }
}
