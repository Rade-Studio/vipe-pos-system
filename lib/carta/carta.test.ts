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

describe("table ordering (T5, S11/S12)", () => {
  it("proposes only on a table page with table ordering on", async () => {
    const { orderingMode } = await import("./cart")
    const { tableCarta } = await import("@/components/carta/carta-fixtures")
    const on = (c: ReturnType<typeof carta>) => ({ ...c, settings: { ...c.settings, tableOrderingEnabled: true } })
    expect(orderingMode(on(tableCarta()))).toBe("propose")
    expect(orderingMode(tableCarta())).toBe("list")
    expect(orderingMode(on(carta()))).toBe("list")
  })

  it("keeps one 24-char base64url guest key per slug", async () => {
    const { guestKeyFor, guestKeyStorageKey } = await import("./table")
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const key = guestKeyFor(storage, "brasa")
    expect(key).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(store.get(guestKeyStorageKey("brasa"))).toBe(key)
    expect(guestKeyFor(storage, "brasa")).toBe(key)
    expect(guestKeyFor(storage, "otro")).not.toBe(key)
  })

  it("normalizes cart lines into proposal items", async () => {
    const { proposalItems } = await import("./table")
    expect(
      proposalItems([
        { key: "a", dishId: "d-1", name: "A", qty: 2, unitPrice: 1, options: [{ groupId: "g", optionId: "o-1", name: "x", price: 0 }], note: "sin sal" },
        { key: "b", dishId: "d-2", name: "B", qty: 1, unitPrice: 1, options: [], note: null },
      ]),
    ).toEqual([
      { dishId: "d-1", quantity: 2, optionIds: ["o-1"], note: "sin sal" },
      { dishId: "d-2", quantity: 1 },
    ])
  })

  it("splits the bill equally or by line, spreading discounts, with the tip on the part", async () => {
    const { billShare } = await import("./table")
    const bill = {
      lines: [
        { name: "Churrasco", quantity: 1, unitPrice: 42900, lineTotal: 42900 },
        { name: "Limonada", quantity: 2, unitPrice: 9900, lineTotal: 19800 },
      ],
      discounts: [],
      grossSubtotal: 62700,
      totalDiscounts: 0,
      subtotal: 62700,
      tipPercentage: 10,
      updatedAt: "2026-11-12T13:00:00.000Z",
    }
    expect(billShare(bill, { mode: "equal", people: 3 }, false, 10)).toEqual({ part: 20900, tip: 0, total: 20900 })
    expect(billShare(bill, { mode: "equal", people: 3 }, true, 10)).toEqual({ part: 20900, tip: 2090, total: 22990 })
    expect(billShare(bill, { mode: "lines", shares: { 0: 1, 1: 2 } }, false, 10).total).toBe(52800)
    const discounted = { ...bill, totalDiscounts: 6270, subtotal: 56430 }
    expect(billShare(discounted, { mode: "lines", shares: { 0: 1 } }, false, 10).total).toBe(38610)
  })
})
