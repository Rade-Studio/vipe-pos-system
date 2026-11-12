import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { CashZReport } from "@/lib/api/cash"
import { ZReportSlip, zReportLines } from "./ZReportSlip"

/** caja-cierres S8-S10: "Informe Z", the numbered close of the business day (artboard 06, slip c). */
const method = (code: string, name: string, kind: "cash" | "electronic", total: number, count: number) => ({
  id: code, code, name, kind, total, count,
})
const register = (over: Partial<CashZReport["snapshot"]["registers"][number]>): CashZReport["snapshot"]["registers"][number] => ({
  id: "r1",
  status: "closed",
  openedAt: new Date(2026, 10, 10, 7, 58).toISOString(),
  closedAt: new Date(2026, 10, 10, 15, 12).toISOString(),
  openedBy: { id: "p1", name: "Camilo Henao" },
  closedBy: { id: "p1", name: "Camilo Henao" },
  validatedBy: null,
  validatedAt: null,
  initialCash: 200000,
  salesNet: 2318400,
  tickets: 61,
  tips: 186500,
  methods: [],
  deposits: 50000,
  withdrawals: 120000,
  tipsPayout: 74000,
  expected: 1042000,
  countedCash: 1038500,
  cashDifference: -3500,
  closeNote: null,
  ...over,
})

const Z: CashZReport = {
  number: 214,
  businessDay: "2026-11-10",
  emittedAt: new Date(2026, 10, 10, 23, 12).toISOString(),
  emittedBy: { id: "p-m", name: "Mariana Restrepo Gil" },
  snapshot: {
    date: "2026-11-10",
    status: "closed",
    registers: [
      register({}),
      register({
        id: "r2",
        openedAt: new Date(2026, 10, 10, 15, 15).toISOString(),
        closedAt: new Date(2026, 10, 10, 23, 4).toISOString(),
        openedBy: { id: "p2", name: "Daniela Ríos" },
        expected: 1610200,
        countedCash: 1612200,
        cashDifference: 2000,
      }),
    ],
    totals: {
      salesNet: 6221100,
      tickets: 155,
      avgTicket: 40136,
      tables: 48,
      deliveries: { count: 9, amount: 412000 },
      tips: 528400,
      methods: [
        method("cash", "Efectivo", "cash", 2400200, 64),
        method("nequi", "Nequi", "electronic", 702600, 19),
        method("bancolombia", "Bancolombia", "electronic", 0, 0),
      ],
      deposits: 50000,
      withdrawals: 120000,
      expected: 2652200,
      counted: 2650700,
      difference: -1500,
    },
    tipsByWaiter: [
      { waiterId: "w1", name: "Valentina Cardona", amount: 162300 },
      { waiterId: null, name: null, amount: 1000 },
    ],
    voids: {
      count: 3,
      amount: 96000,
      items: [
        { at: "2026-11-10T18:24:00.000Z", kind: "item_void", orderNumber: 1046, table: "7", amount: 61000, reason: "dish_returned", reasonText: null, requestedBy: "V", authorizedBy: "M" },
        { at: "2026-11-10T19:30:00.000Z", kind: "payment_void", orderNumber: 1050, table: "8", amount: 35000, reason: "duplicate_charge", reasonText: null, requestedBy: "C", authorizedBy: "M" },
      ],
    },
    previous: { date: "2026-11-03", salesNet: 5874300 },
    taxes: { rate: 8, base: 5760278, tax: 460822 },
    orders: { first: 18231, last: 18385 },
    discounts: 38000,
    tipsByMethod: [
      { code: "cash", name: "Efectivo", kind: "cash", amount: 202300 },
      { code: "nequi", name: "Nequi", kind: "electronic", amount: 111500 },
    ],
  },
}
const business = { name: "La Fonda de Mariana", nit: "901.234.567-8", address: "Cra. 70 # 44-21, Laureles, Medellín" }
const printedAt = new Date(2026, 10, 10, 23, 15)

describe("ZReportSlip", () => {
  it("prints the numbered header, the business day and hour range, and who emitted it", () => {
    render(<ZReportSlip business={business} z={Z} printedAt={printedAt} />)
    const slip = screen.getByRole("document", { name: "Informe Z N.º 000214" })
    expect(slip).toHaveTextContent("LA FONDA DE MARIANA")
    expect(slip).toHaveTextContent("NIT 901.234.567-8")
    expect(slip).toHaveTextContent("Cra. 70 # 44-21, Laureles, Medellín")
    expect(slip).toHaveTextContent("INFORME Z N.º 000214")
    expect(slip).toHaveTextContent("Martes 10 nov 2026")
    expect(slip).toHaveTextContent(/Horario\s+7:58 a\.m\. – 11:04 p\.m\./)
    expect(slip).toHaveTextContent(/Turnos\s+2/)
    expect(slip).toHaveTextContent(/Emitido\s+10\/11\/2026 11:12 p\.m\./)
    expect(slip).toHaveTextContent(/Emitido por\s+Mariana Restrepo Gil/)
    expect(slip).toHaveTextContent(/Impreso\s+10\/11\/2026 11:15 p\.m\./)
  })

  it("prints sales, discounts, voids, the base and the tax with the stored rate, and the day counters", () => {
    const text = zReportLines({ business, z: Z, printedAt }).map((line) => line.text)
    const at = (pattern: RegExp) => text.findIndex((line) => pattern.test(line))
    expect(text[at(/^Ventas brutas/)]).toMatch(/\$ 6\.259\.100$/)
    expect(text[at(/^− Descuentos/)]).toMatch(/\$ 38\.000$/)
    expect(text[at(/^VENTAS NETAS/)]).toMatch(/\$ 6\.221\.100$/)
    expect(text[at(/^Anulaciones \(3\)/)]).toMatch(/\$ 96\.000$/)
    expect(text[at(/^Base gravable/)]).toMatch(/\$ 5\.760\.278$/)
    expect(text[at(/^Impuesto \(8 %\)/)]).toMatch(/\$ 460\.822$/)
    expect(text[at(/^Domicilios \(9\)/)]).toMatch(/\$ 412\.000$/)
    expect(text[at(/^Tiquetes/)]).toMatch(/155$/)
    expect(text[at(/^Ticket promedio/)]).toMatch(/\$ 40\.136$/)
    expect(text[at(/^Mesas atendidas/)]).toMatch(/48$/)
    expect(text[at(/^Órdenes/)]).toMatch(/N\.º 18231 a 18385$/)
    expect(text[at(/^Efectivo \(64\)/)]).toMatch(/\$ 2\.400\.200$/)
    expect(text[at(/^Nequi \(19\)/)]).toMatch(/\$ 702\.600$/)
    expect(at(/^Bancolombia/)).toBe(-1)
  })

  it("uses the rate stored with the Z (19 %)", () => {
    const z19 = { ...Z, snapshot: { ...Z.snapshot, taxes: { ...Z.snapshot.taxes, rate: 19 } } }
    const text = zReportLines({ business, z: z19, printedAt }).map((line) => line.text)
    expect(text.some((line) => /^Impuesto \(19 %\)\s+\$ 460\.822$/.test(line))).toBe(true)
    expect(text.some((line) => /^Impuesto \(8 %\)/.test(line))).toBe(false)
  })

  it("prints the tips in their own block, by method and by waiter, after sales and the tax", () => {
    const text = zReportLines({ business, z: Z, printedAt }).map((line) => line.text)
    const block = text.findIndex((line) => line === "Propinas (no son ingreso del restaurante)")
    expect(block).toBeGreaterThan(text.findIndex((line) => /^Impuesto \(8 %\)/.test(line)))
    expect(block).toBeGreaterThan(text.findIndex((line) => /^Efectivo \(64\)/.test(line)))
    const tips = text.slice(block)
    expect(tips.some((line) => /^No suman a ventas ni al impuesto\.$/.test(line))).toBe(true)
    expect(tips.some((line) => /^Efectivo\s+\$ 202\.300$/.test(line))).toBe(true)
    expect(tips.some((line) => /^Nequi\s+\$ 111\.500$/.test(line))).toBe(true)
    expect(tips.some((line) => /^Valentina Cardona\s+\$ 162\.300$/.test(line))).toBe(true)
    expect(tips.some((line) => /^Sin mesero\s+\$ 1\.000$/.test(line))).toBe(true)
    expect(tips.some((line) => /^Total propinas\s+\$ 528\.400$/.test(line))).toBe(true)
    // Nothing about tips before the block: they are never part of sales or the tax base.
    expect(text.slice(0, block).some((line) => /propina/i.test(line))).toBe(false)
  })

  it("prints the cash of each turno with its difference, the day difference and the signature", () => {
    const text = zReportLines({ business, z: Z, printedAt }).map((line) => line.text)
    expect(text).toContain("T1 Camilo Henao")
    expect(text).toContain("T2 Daniela Ríos")
    expect(text.some((line) => /^ {3}Contado\s+\$ 1\.038\.500$/.test(line))).toBe(true)
    expect(text.some((line) => /^ {3}Faltante\s+−\$ 3\.500$/.test(line))).toBe(true)
    expect(text.some((line) => /^ {3}Sobrante\s+\+\$ 2\.000$/.test(line))).toBe(true)
    expect(text.some((line) => /^Diferencia neta día\s+−\$ 1\.500$/.test(line))).toBe(true)
    expect(text).toContain("Z cerrado.")
    expect(text).toContain("Los totales no se pueden editar.")
    expect(text.at(-2)).toBe("Administrador")
    expect(text.at(-1)).toBe("Mariana Restrepo Gil")
  })

  it("leaves out discounts and the order range when the Z has none", () => {
    const bare = { ...Z, snapshot: { ...Z.snapshot, discounts: 0, orders: { first: null, last: null } } }
    const text = zReportLines({ business, z: bare, printedAt }).map((line) => line.text)
    expect(text.some((line) => /Descuentos|Ventas brutas|^Órdenes/.test(line))).toBe(false)
  })

  it("fits 58 mm paper (32 characters a line)", () => {
    render(<ZReportSlip business={business} z={Z} printedAt={printedAt} paperMm={58} />)
    const lines = screen.getByRole("document", { name: "Informe Z N.º 000214" }).querySelectorAll("[data-line]")
    for (const line of lines) expect((line.textContent ?? "").length).toBeLessThanOrEqual(32)
  })
})
