import { afterEach, describe, expect, it } from "vitest"
import { ACTING_HEADER, actingToken, clearActingToken, setActingToken } from "./acting"

describe("acting token holder", () => {
  afterEach(() => clearActingToken())

  it("holds the claim of the identified staff member until it is cleared", () => {
    expect(ACTING_HEADER).toBe("X-Vipe-Acting")
    expect(actingToken()).toBeNull()
    setActingToken("t-1")
    expect(actingToken()).toBe("t-1")
    setActingToken("t-2")
    expect(actingToken()).toBe("t-2")
    clearActingToken()
    expect(actingToken()).toBeNull()
  })
})
