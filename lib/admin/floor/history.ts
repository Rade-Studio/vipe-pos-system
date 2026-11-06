/**
 * Undo/redo of the floor plan editor's unsaved layout session (T26). Each
 * state is the whole `edits` map; one gesture (a drag, typing in one field)
 * records under one `key` and becomes one undo step.
 */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** Gesture of the last recorded step; a record with the same key replaces it. */
  key: string | null
}

const LIMIT = 100

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], key: null })

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

export function record<T>(history: History<T>, next: T, key: string | null = null): History<T> {
  if (same(history.present, next)) return history
  if (key !== null && key === history.key) return { ...history, present: next, future: [] }
  return { past: [...history.past, history.present].slice(-LIMIT), present: next, future: [], key }
}

export const canUndo = (history: History<unknown>): boolean => history.past.length > 0
export const canRedo = (history: History<unknown>): boolean => history.future.length > 0

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history
  const previous = history.past[history.past.length - 1]
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], key: null }
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history
  const [next, ...future] = history.future
  return { past: [...history.past, history.present], present: next, future, key: null }
}
