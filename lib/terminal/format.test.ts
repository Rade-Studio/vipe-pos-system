import { describe, expect, it } from "vitest"
import { clockTime, countdown, initialsOf } from "./format"

describe("terminal labels", () => {
  it("shows a lock end as a 24-hour local clock (\"Bloqueado hasta 12:49\")", () => {
    expect(clockTime(new Date(2026, 10, 7, 12, 49, 30).toISOString())).toBe("12:49")
    expect(clockTime(new Date(2026, 10, 7, 9, 5).toISOString())).toBe("09:05")
    expect(clockTime(new Date(2026, 10, 7, 17, 0).toISOString())).toBe("17:00")
  })

  it("counts the identification down as m:ss, never below 0:00", () => {
    expect(countdown(5 * 60_000)).toBe("5:00")
    expect(countdown(4 * 60_000 + 12_000)).toBe("4:12")
    expect(countdown(4 * 60_000 + 11_001)).toBe("4:12")
    expect(countdown(9_000)).toBe("0:09")
    expect(countdown(0)).toBe("0:00")
    expect(countdown(-3_000)).toBe("0:00")
  })

  it("takes up to two initials from a name, accents kept", () => {
    expect(initialsOf("Andrés")).toBe("A")
    expect(initialsOf("Laura Gómez")).toBe("LG")
    expect(initialsOf("  carlos   pérez  ruiz ")).toBe("CP")
    expect(initialsOf("Óscar")).toBe("Ó")
    expect(initialsOf("")).toBe("?")
  })
})
