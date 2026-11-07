import { describe, expect, it } from "vitest"
import { codeGroups, connectionLabel, countdown, newDevice, sinceLabel, stationNames, visibleDevices } from "./print-station"

const device = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, revokedAt: null, printers: [], ...extra }) as never

describe("print station helpers (F5a web)", () => {
  it("splits the 6 digits in two groups of 3", () => {
    expect(codeGroups("481207")).toEqual(["481", "207"])
  })

  it("formats the time left as m:ss and never below 0:00", () => {
    expect(countdown(9 * 60_000 + 42_000)).toBe("9:42")
    expect(countdown(5_000)).toBe("0:05")
    expect(countdown(-1)).toBe("0:00")
  })

  it("names the time since the last signal", () => {
    const now = Date.now()
    expect(sinceLabel(new Date(now - 12_000).toISOString(), now)).toBe("12 s")
    expect(sinceLabel(new Date(now - 6 * 60_000).toISOString(), now)).toBe("6 min")
    expect(sinceLabel(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 h")
    expect(sinceLabel(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2 días")
  })

  it("labels the connection kinds", () => {
    expect(["usb", "network", "bluetooth"].map((c) => connectionLabel(c as never))).toEqual(["USB", "Red", "Bluetooth"])
  })

  it("hides revoked devices and finds the first device not seen before", () => {
    const list = [device("a"), device("b", { revokedAt: "2026-01-01T00:00:00.000Z" })]
    expect(visibleDevices(list).map((d: { id: string }) => d.id)).toEqual(["a"])
    expect(newDevice(list, new Set(["b"]))).toMatchObject({ id: "a" })
    expect(newDevice(list, new Set(["a", "b"]))).toBeUndefined()
  })

  it("lists the stations a device serves once, in station order", () => {
    const stations = [{ id: "k", name: "Cocina" }, { id: "p", name: "Postres" }, { id: "c", name: "Caja" }] as never
    const d = device("a", { printers: [{ stationIds: ["p", "k"] }, { stationIds: ["p"] }] })
    expect(stationNames(d, stations)).toEqual(["Cocina", "Postres"])
  })
})
