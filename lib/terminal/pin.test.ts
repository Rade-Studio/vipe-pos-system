import { describe, expect, it } from "vitest"
import { PIN_FORMAT_MESSAGE, PIN_MISMATCH_MESSAGE, newPinError, pinDigits } from "./pin"

describe("PIN entry checks", () => {
  it("accepts 4 to 6 digits typed twice and leaves weak PINs to the API", () => {
    expect(newPinError("4829", "4829")).toBeNull()
    expect(newPinError("739146", "739146")).toBeNull()
    expect(newPinError("1234", "1234")).toBeNull()
  })

  it("refuses a bad format before a mismatch, with the API's message", () => {
    expect(newPinError("123", "123")).toBe(PIN_FORMAT_MESSAGE)
    expect(newPinError("1234567", "1234567")).toBe(PIN_FORMAT_MESSAGE)
    expect(newPinError("12a4", "12a4")).toBe(PIN_FORMAT_MESSAGE)
    expect(newPinError("4829", "4828")).toBe(PIN_MISMATCH_MESSAGE)
    expect(PIN_FORMAT_MESSAGE).toBe("El PIN debe tener entre 4 y 6 dígitos")
  })

  it("keeps only digits, at most 6", () => {
    expect(pinDigits("12 34-5678")).toBe("123456")
    expect(pinDigits("ab")).toBe("")
  })
})
