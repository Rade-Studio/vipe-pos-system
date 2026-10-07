import { describe, expect, it } from "vitest"
import { createSingleFlight } from "./single-flight"

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("createSingleFlight", () => {
  it("runs the task and reports it as started", async () => {
    const gate = createSingleFlight()
    let calls = 0
    const started = gate.run(async () => {
      calls++
    })
    expect(started).not.toBeNull()
    await started
    expect(calls).toBe(1)
  })

  it("drops a second call while the first is still running", async () => {
    const gate = createSingleFlight()
    const first = deferred()
    let calls = 0
    const task = () => {
      calls++
      return first.promise
    }

    const a = gate.run(task)
    const b = gate.run(task)

    expect(b).toBeNull()
    expect(gate.isRunning()).toBe(true)
    first.resolve()
    await a
    expect(calls).toBe(1)
    expect(gate.isRunning()).toBe(false)
  })

  it("accepts a new call after the previous one finished", async () => {
    const gate = createSingleFlight()
    let calls = 0
    await gate.run(async () => {
      calls++
    })
    await gate.run(async () => {
      calls++
    })
    expect(calls).toBe(2)
  })

  it("releases the gate when the task rejects", async () => {
    const gate = createSingleFlight()
    const failing = deferred()
    const run = gate.run(() => failing.promise)
    failing.reject(new Error("boom"))
    await expect(run).rejects.toThrow("boom")
    expect(gate.isRunning()).toBe(false)
  })

  it("releases the gate when the task throws synchronously", () => {
    const gate = createSingleFlight()
    expect(() =>
      gate.run(() => {
        throw new Error("sync boom")
      }),
    ).toThrow("sync boom")
    expect(gate.isRunning()).toBe(false)
  })
})
