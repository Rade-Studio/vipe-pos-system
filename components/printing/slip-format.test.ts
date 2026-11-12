import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { wrapText, differenceText, padLine, pesos, printSlip, signedPesos, slipChars, slipDate, slipDateTime, slipTime } from "./slip-format"

/** caja-cierres S4: the shared formatting of the thermal slips. */
describe("slip-format", () => {
  it("formats pesos with dot thousands and no decimals", () => {
    expect(pesos(1234567)).toBe("$ 1.234.567")
    expect(pesos(0)).toBe("$ 0")
    expect(pesos(-3500)).toBe("−$ 3.500")
    expect(signedPesos(2000)).toBe("+$ 2.000")
    expect(signedPesos(-3500)).toBe("−$ 3.500")
    expect(signedPesos(0)).toBe("$ 0")
  })

  it("writes the difference as Cuadra, Sobrante or Faltante", () => {
    expect(differenceText(0)).toBe("Cuadra")
    expect(differenceText(2000)).toBe("Sobrante +$ 2.000")
    expect(differenceText(-3500)).toBe("Faltante −$ 3.500")
  })

  it("formats dates and times es-CO", () => {
    const d = new Date(2026, 10, 10, 7, 58)
    expect(slipDate(d)).toBe("10/11/2026")
    expect(slipTime(d)).toBe("7:58 a.m.")
    expect(slipTime(new Date(2026, 10, 10, 15, 2))).toBe("3:02 p.m.")
    expect(slipTime(new Date(2026, 10, 10, 0, 5))).toBe("12:05 a.m.")
    expect(slipDateTime(d)).toBe("10/11/2026 7:58 a.m.")
  })

  it("pads a line to the paper width and truncates a long label", () => {
    expect(slipChars(80)).toBe(42)
    expect(slipChars(58)).toBe(32)
    expect(padLine("Fondo", "$ 200.000", 20)).toBe("Fondo      $ 200.000")
    expect(padLine("Fondo", "$ 200.000", 20)).toHaveLength(20)
    expect(padLine("Una etiqueta muy larga", "$ 1", 12)).toBe("Una eti… $ 1")
    expect(padLine("Solo", "", 8)).toBe("Solo")
  })

  it("wraps a note to the paper width", () => {
    expect(wrapText("Nota: cambio mal dado en mesa 7", 12)).toEqual(["Nota: cambio", "mal dado en", "mesa 7"])
  })
})

describe("printSlip", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("writes the slip to a print window sized to the paper", () => {
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
    vi.stubGlobal("window", { open: vi.fn().mockReturnValue({ document: doc }) })
    expect(printSlip(createElement("p", null, "INFORME X"), { title: "Informe X", paperMm: 58 })).toBe(true)
    const html = doc.write.mock.calls[0][0] as string
    expect(html).toContain("<p>INFORME X</p>")
    expect(html).toContain("<title>Informe X</title>")
    expect(html).toContain("58mm")
    expect(html).toContain("window.print()")
  })

  it("answers false when the browser blocks the window", () => {
    vi.stubGlobal("window", { open: vi.fn().mockReturnValue(null) })
    expect(printSlip(createElement("p", null, "x"), { title: "x" })).toBe(false)
  })
})
