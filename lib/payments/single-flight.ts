// Synchronous re-entrancy gate for money-moving actions (split, undo).
// React state flags only take effect after a re-render, so a second
// trigger in the same tick can still slip through; this gate flips
// before the task starts and is released however the task ends.

export interface SingleFlight {
  /** Starts the task, or returns null when one is already running. */
  run<T>(task: () => Promise<T>): Promise<T> | null
  isRunning(): boolean
}

export function createSingleFlight(): SingleFlight {
  let running = false

  return {
    run(task) {
      if (running) return null
      running = true
      try {
        return task().finally(() => {
          running = false
        })
      } catch (error) {
        running = false
        throw error
      }
    },
    isRunning: () => running,
  }
}
