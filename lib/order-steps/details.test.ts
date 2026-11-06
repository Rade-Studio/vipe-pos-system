import { describe, expect, it } from "vitest"

import { clockTime, guestsText, sentGroups } from "./details"

/** T22 (S8): what the waiter flow shows from the order's stored details. */
describe("order details wording (T22)", () => {
  it("prints the send time as 24-hour HH:mm in local time", () => {
    expect(clockTime(new Date(2026, 10, 6, 19, 48, 30))).toBe("19:48")
    expect(clockTime(new Date(2026, 10, 6, 7, 5))).toBe("07:05")
    expect(clockTime(undefined)).toBeNull()
    expect(clockTime(new Date("nope"))).toBeNull()
  })

  it("says the guests in words", () => {
    expect(guestsText(4)).toBe("4 personas")
    expect(guestsText(1)).toBe("1 persona")
    expect(guestsText(undefined)).toBeNull()
  })

  it("groups the sent lines by the minute they were sent, oldest first", () => {
    const at = (h: number, m: number, s = 0) => new Date(2026, 10, 6, h, m, s)
    const lines = [
      { id: "a", addedAt: at(19, 48, 1) },
      { id: "b", addedAt: at(19, 48, 40) },
      { id: "c", addedAt: at(20, 5) },
      { id: "d" },
    ]
    expect(sentGroups(lines).map((group) => [group.time, group.lines.map((line) => line.id)])).toEqual([
      ["19:48", ["a", "b"]],
      ["20:05", ["c"]],
      [null, ["d"]],
    ])
    expect(sentGroups([])).toEqual([])
  })
})
