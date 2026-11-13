import { describe, expect, it } from "vitest"
import { AA, brandPalette, contrastRatio, DARK_CANVAS, LIGHT_CANVAS } from "./brand"
import { cartReducer, loadLines, saveLines, storageKey, type CartLine } from "./cart"
import { formatCop, formatTime, initials } from "./format"
import { STRINGS } from "./i18n"
import { canAddNow, closedSentence } from "./menu"
import { dishPath, shareUrl } from "./share"
import { carta } from "@/components/carta/carta-fixtures"

describe("brandPalette (S3)", () => {
  it.each(["#fde047", "#b4532a", "#ffffff", "#000000", "#7c3aed", null, "not-a-color"])(
    "every text pair passes AA in both themes for %s",
    (color) => {
      const p = brandPalette(color)
      expect(contrastRatio(p.light.brandContrast, p.light.brand)).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(p.light.brandText, LIGHT_CANVAS)).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(p.dark.brandContrast, p.dark.brand)).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(p.dark.brandText, DARK_CANVAS)).toBeGreaterThanOrEqual(AA)
    },
  )

  it("darkens a light yellow for the light theme", () => {
    expect(contrastRatio("#fde047", "#ffffff")).toBeLessThan(AA)
    expect(brandPalette("#fde047").light.brand).not.toBe("#fde047")
  })
})

describe("format", () => {
  it("formats COP and times like the artboard", () => {
    expect(formatCop(42900)).toBe("$42.900")
    expect(formatCop(4000)).toBe("$4.000")
    expect(formatCop(1234567)).toBe("$1.234.567")
    expect(formatTime("22:30")).toBe("10:30 pm")
    expect(formatTime("07:00")).toBe("7:00 am")
    expect(formatTime("12:00")).toBe("12:00 pm")
    expect(formatTime("00:15")).toBe("12:15 am")
    expect(initials("Brasa & Leña")).toBe("B&L")
    expect(initials("Café Central")).toBe("CC")
  })
})

describe("closed sentence and add gate (S5, A1)", () => {
  const t = STRINGS.es
  it("builds the sentence from nextOpening", () => {
    const closed = (inDays: number, date = "2026-11-16") =>
      closedSentence(carta({ isOpenNow: false, nextOpening: { date, opensAt: "07:00", inDays } }), t)
    expect(closed(1)).toBe("Abrimos mañana a las 7:00 am. Puedes ver la carta con calma.")
    expect(closed(0)).toBe("Abrimos hoy a las 7:00 am. Puedes ver la carta con calma.")
    expect(closed(3, "2026-11-16")).toBe("Abrimos el lunes a las 7:00 am. Puedes ver la carta con calma.")
    expect(closedSentence(carta({ isOpenNow: false, nextOpening: null }), t)).toBe("Puedes ver la carta con calma.")
  })

  it("gates on isOpenNow, then on the viewed daypart", () => {
    expect(canAddNow(carta(), "dp-almuerzo")).toBe(true)
    expect(canAddNow(carta(), "dp-noche")).toBe(false)
    expect(canAddNow(carta({ isOpenNow: false }), "dp-almuerzo")).toBe(false)
    expect(canAddNow(carta({ dayparts: [], currentDaypartId: null }), null)).toBe(true)
  })
})

describe("cart (S11)", () => {
  const base = { dishId: "d", name: "D", unitPrice: 1000, options: [], note: null }
  it("merges equal lines and drops a line at zero", () => {
    let lines: CartLine[] = []
    lines = cartReducer(lines, { type: "add", line: base })
    lines = cartReducer(lines, { type: "add", line: base })
    expect(lines).toHaveLength(1)
    expect(lines[0].qty).toBe(2)
    lines = cartReducer(lines, { type: "decrement", key: lines[0].key })
    lines = cartReducer(lines, { type: "decrement", key: lines[0].key })
    expect(lines).toEqual([])
  })

  it("persists per slug and ignores broken storage", () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
    const lines = cartReducer([], { type: "add", line: base })
    saveLines(storage, "a", lines)
    expect(loadLines(storage, "a")).toEqual(lines)
    expect(loadLines(storage, "b")).toEqual([])
    map.set(storageKey("c"), "{oops")
    expect(loadLines(storage, "c")).toEqual([])
  })
})

describe("share links (S9)", () => {
  it("never carries a table", () => {
    expect(dishPath("brasa-y-lena", "lasana")).toBe("/c/brasa-y-lena/p/lasana")
    expect(shareUrl("https://vipe.app/", "brasa-y-lena")).toBe("https://vipe.app/c/brasa-y-lena")
  })
})
