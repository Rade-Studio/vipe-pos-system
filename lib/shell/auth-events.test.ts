import { describe, expect, it } from "vitest"
import { emitAuthEvent, onAuthEvent } from "./auth-events"

/**
 * T7 (S2): the API client is the only source of auth events. A failed silent
 * refresh emits `signed_out`; the shell listens and goes back to the login.
 */
describe("auth event bus", () => {
  it("delivers signed_out to every listener", () => {
    const a: string[] = []
    const b: string[] = []
    const stopA = onAuthEvent((event) => a.push(event))
    const stopB = onAuthEvent((event) => b.push(event))

    emitAuthEvent("signed_out")

    expect(a).toEqual(["signed_out"])
    expect(b).toEqual(["signed_out"])
    stopA()
    stopB()
  })

  it("stops delivering after unsubscribe", () => {
    const seen: string[] = []
    const stop = onAuthEvent((event) => seen.push(event))
    stop()

    emitAuthEvent("signed_out")

    expect(seen).toEqual([])
  })

  it("a throwing listener does not stop the others", () => {
    const seen: string[] = []
    const stopBad = onAuthEvent(() => {
      throw new Error("boom")
    })
    const stopGood = onAuthEvent((event) => seen.push(event))

    emitAuthEvent("signed_out")

    expect(seen).toEqual(["signed_out"])
    stopBad()
    stopGood()
  })
})
