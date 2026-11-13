import qrcode from "qrcode-generator"
import { describe, expect, it } from "vitest"
import { fileName, qrSvg } from "./qr"

/** T9 (S18) — table QR images. */

const URL_A = "https://vipe.example/c/brasa-y-lena/m/tok-10"

/** Reads the dark cells back out of the path the SVG draws ("M{x} {y}h1v1h-1z"). */
function darkCells(svg: string): Set<string> {
  const d = /<path[^>]* d="([^"]*)"/.exec(svg)?.[1] ?? ""
  return new Set([...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`))
}

describe("qrSvg", () => {
  it("draws exactly the modules of the code for the text, inside a 4-module quiet zone", () => {
    const reference = qrcode(0, "M")
    reference.addData(URL_A)
    reference.make()
    const count = reference.getModuleCount()
    const expected = new Set<string>()
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (reference.isDark(row, col)) expected.add(`${col + 4},${row + 4}`)
    }

    const svg = qrSvg(URL_A)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${count + 8} ${count + 8}"`)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain(`<rect width="${count + 8}" height="${count + 8}" fill="#fff"/>`)
    expect(darkCells(svg)).toEqual(expected)
  })

  it("honours margin and error correction level", () => {
    const reference = qrcode(0, "H")
    reference.addData(URL_A)
    reference.make()
    const count = reference.getModuleCount()
    const svg = qrSvg(URL_A, { margin: 2, ecc: "H" })
    expect(svg).toContain(`viewBox="0 0 ${count + 4} ${count + 4}"`)
    expect(darkCells(svg).has(`2,2`)).toBe(true)
  })

  it("changes when the text changes", () => {
    expect(qrSvg(URL_A)).not.toBe(qrSvg(`${URL_A}-x`))
  })
})

describe("fileName", () => {
  it("names the PNG after the restaurant and the table", () => {
    expect(fileName("brasa-y-lena", 12)).toBe("carta-brasa-y-lena-mesa-12.png")
  })
})
