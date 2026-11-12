import { act, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Table } from "@/types"
import type { FloorZone } from "@/lib/floor/layout"
import { FloorPlan } from "./FloorPlan"

/**
 * T6 (S4) — the shared floor: tables sit at their x/y fractions of the zone,
 * draw the chairs `seats` asks for (none when absent), say their status in
 * words, are grouped by zone tabs, and a table without a place stays
 * reachable from the "Sin ubicar" strip.
 */

const zones: FloorZone[] = [
  { id: "z-1", name: "Salón principal", aspect: 1.6, labels: [{ text: "Entrada", side: "bottom" }] },
  { id: "z-2", name: "Barra", aspect: 2.2, labels: [] },
]

const placed = (id: string, number: number, extra: Partial<Table> = {}): Table => ({
  id,
  number,
  status: "available",
  zoneId: "z-1",
  x: 0.2,
  y: 0.3,
  w: 0.1,
  h: 0.1,
  shape: "square",
  rotation: 0,
  ...extra,
})

function renderPlan(tables: Table[], props: Partial<Parameters<typeof FloorPlan>[0]> = {}) {
  const onSelectTable = vi.fn()
  render(
    <FloorPlan
      zones={zones}
      tables={tables}
      selectedTableId={null}
      onSelectTable={onSelectTable}
      currentWaiterId="w-1"
      waiterNameOf={(table) => (table.waiter === "w-2" ? "Carolina Ruiz" : table.waiter === "w-1" ? "Ana Gómez" : undefined)}
      {...props}
    />,
  )
  return { onSelectTable }
}

const tableButton = (number: number) => screen.getByRole("button", { name: new RegExp(`^Mesa ${number},`) })

describe("FloorPlan — placement", () => {
  it("places a table at its x/y fractions, sized by w of the zone width and h scaled by the aspect", () => {
    renderPlan([placed("t-1", 4, { x: 0.25, y: 0.5, w: 0.1, h: 0.05, shape: "rect", rotation: 90 })])

    const style = tableButton(4).style
    expect(style.left).toBe("25%")
    expect(style.top).toBe("50%")
    expect(style.width).toBe("10%")
    // h is a fraction of the zone WIDTH: 0.05 * 1.6 of the floor height.
    expect(style.height).toBe("8%")
    expect(tableButton(4).querySelector("[data-tabletop]")?.getAttribute("style")).toContain("rotate(90deg)")
  })

  it("keeps round and square tables square (height follows w)", () => {
    renderPlan([placed("t-1", 1, { w: 0.1, h: 0.3, shape: "round" })])
    expect(tableButton(1).style.height).toBe("16%")
  })

  it("keeps the floor at the zone aspect and prints its wall labels", () => {
    renderPlan([placed("t-1", 1)])
    const floor = screen.getByRole("group", { name: "Plano de Salón principal, 1 mesas" })
    expect(floor.style.aspectRatio).toBe("1.6 / 1")
    expect(within(floor).getByText("Entrada")).toBeInTheDocument()
  })
})

describe("FloorPlan — chairs", () => {
  it("draws one chair per seat", () => {
    renderPlan([placed("t-1", 1, { seats: 6, shape: "rect" }), placed("t-2", 2, { seats: 4, shape: "round", x: 0.6 })])
    expect(tableButton(1).querySelectorAll("[data-chair]")).toHaveLength(6)
    expect(tableButton(2).querySelectorAll("[data-chair]")).toHaveLength(4)
  })

  it("draws no chair when seats is absent or 0", () => {
    renderPlan([placed("t-1", 1), placed("t-2", 2, { seats: 0, shape: "bar", x: 0.6 })])
    expect(tableButton(1).querySelectorAll("[data-chair]")).toHaveLength(0)
    expect(tableButton(2).querySelectorAll("[data-chair]")).toHaveLength(0)
    expect(tableButton(1)).toHaveAccessibleName("Mesa 1, Libre, sin sillas")
  })
})

describe("FloorPlan — status and waiter", () => {
  it.each([
    ["available", "Libre"],
    ["reserved", "Reservada"],
    ["occupied", "Ocupada"],
    ["kitchen", "En cocina"],
    ["served", "Servida"],
  ] as const)("labels %s as %s, in text and in the accessible name", (status, label) => {
    renderPlan([placed("t-1", 1, { status })])
    expect(within(tableButton(1)).getByText(label)).toBeInTheDocument()
    expect(tableButton(1).getAttribute("aria-label")).toContain(`, ${label},`)
  })

  it("marks the current waiter's table with Tú and another waiter's with initials", () => {
    renderPlan([
      placed("t-1", 1, { status: "occupied", waiter: "w-1" }),
      placed("t-2", 2, { status: "kitchen", waiter: "w-2", seats: 4, x: 0.6 }),
    ])
    expect(within(tableButton(1)).getByText("Tú")).toBeInTheDocument()
    expect(within(tableButton(2)).getByText("CR")).toBeInTheDocument()
    expect(tableButton(2)).toHaveAccessibleName("Mesa 2, En cocina, 4 sillas, Carolina Ruiz")
  })

  it("shows the selection as aria-pressed and calls onSelectTable on tap", () => {
    const { onSelectTable } = renderPlan([placed("t-1", 1), placed("t-2", 2, { x: 0.6 })], { selectedTableId: "t-2" })
    expect(tableButton(2)).toHaveAttribute("aria-pressed", "true")
    expect(tableButton(1)).toHaveAttribute("aria-pressed", "false")
    act(() => tableButton(1).click())
    expect(onSelectTable).toHaveBeenCalledWith("t-1")
  })
})

describe("FloorPlan — zones", () => {
  it("shows one tab per zone with its table count and switches the floor", () => {
    renderPlan([placed("t-1", 1), placed("t-2", 2, { zoneId: "z-2", x: 0.5 }), placed("t-3", 3, { x: 0.7 })])

    const salon = screen.getByRole("tab", { name: /Salón principal/ })
    const barra = screen.getByRole("tab", { name: /Barra/ })
    expect(salon).toHaveAttribute("aria-selected", "true")
    expect(salon).toHaveTextContent("2")
    expect(barra).toHaveTextContent("1")
    expect(tableButton(1)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Mesa 2,/ })).not.toBeInTheDocument()

    act(() => barra.click())

    expect(barra).toHaveAttribute("aria-selected", "true")
    expect(tableButton(2)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Mesa 1,/ })).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Plano de Barra, 1 mesas" }).style.aspectRatio).toBe("2.2 / 1")
  })

  it("lists tables without a zone or coordinates under Sin ubicar, and they stay selectable", () => {
    const { onSelectTable } = renderPlan([
      placed("t-1", 1),
      { id: "t-7", number: 7, status: "occupied", waiter: "w-2" },
      { id: "t-8", number: 8, status: "available", zoneId: "z-1" },
      { id: "t-9", number: 9, status: "available", zoneId: "z-gone", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
    ])

    const strip = screen.getByRole("region", { name: "Sin ubicar" })
    expect(within(strip).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Mesa 7"),
      expect.stringContaining("Mesa 8"),
      expect.stringContaining("Mesa 9"),
    ])
    expect(within(strip).getByText("Carolina Ruiz")).toBeInTheDocument()
    expect(within(strip).getByText("Ocupada")).toBeInTheDocument()

    act(() => within(strip).getByText("Mesa 8").click())
    expect(onSelectTable).toHaveBeenCalledWith("t-8")
  })

  it("without zones shows no tabs and every table under Sin ubicar", () => {
    renderPlan([placed("t-1", 1)], { zones: [] })
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Sin ubicar" })).getByText("Mesa 1")).toBeInTheDocument()
  })

  it("zooms the floor with − / + and Ajustar", () => {
    renderPlan([placed("t-1", 1)])
    const wrap = screen.getByTestId("floor-zoom")
    expect(wrap.style.width).toBe("100%")
    act(() => screen.getByRole("button", { name: "Acercar" }).click())
    expect(wrap.style.width).toBe("150%")
    act(() => screen.getByRole("button", { name: "Alejar" }).click())
    expect(wrap.style.width).toBe("100%")
    act(() => screen.getByRole("button", { name: "Acercar" }).click())
    act(() => screen.getByRole("button", { name: "Ajustar" }).click())
    expect(wrap.style.width).toBe("100%")
  })

  // Tables on the last row overflow the floor a little; an own scroll container
  // with overscroll-contain caught the wheel there and the page never scrolled.
  it("leaves the page scroll to the page until the floor is zoomed", () => {
    renderPlan([placed("t-1", 1)])
    const scroller = screen.getByTestId("floor-scroller")
    expect(scroller).toHaveClass("overflow-x-clip")
    expect(scroller).not.toHaveClass("overflow-auto")
    expect(scroller).not.toHaveClass("overscroll-contain")
    act(() => screen.getByRole("button", { name: "Acercar" }).click())
    expect(scroller).toHaveClass("overflow-auto", "overscroll-contain")
    act(() => screen.getByRole("button", { name: "Ajustar" }).click())
    expect(scroller).toHaveClass("overflow-x-clip")
  })
})

describe("FloorPlan — live details (T22)", () => {
  it("draws the elapsed-time chip and the waiter initials on a table with an open order", () => {
    renderPlan([placed("t-1", 4, { status: "kitchen", waiter: "w-2" }), placed("t-2", 5, { x: 0.6 })], {
      elapsedOf: (table) => (table.id === "t-1" ? "18 min" : null),
    })
    // The time rides in the status chip under the table, never over the number or the badge (S6).
    const status = within(tableButton(4)).getByTestId("table-status")
    expect(status).toHaveTextContent("En cocina")
    expect(within(status).getByText("18 min")).toBeInTheDocument()
    expect(within(status).getByText("18m")).toBeInTheDocument()
    expect(within(tableButton(4)).getAllByText("18 min")).toHaveLength(1)
    expect(within(tableButton(4)).getByText("CR")).toBeInTheDocument()
    expect(tableButton(4)).toHaveAccessibleName("Mesa 4, En cocina, sin sillas, Carolina Ruiz, abierta hace 18 min")
    expect(within(tableButton(5)).queryByText(/min$/)).not.toBeInTheDocument()
  })

  it("greys an inactive table and says so instead of its status", () => {
    const { onSelectTable } = renderPlan([placed("t-1", 4, { isActive: false }), placed("t-2", 5, { x: 0.6, isActive: true })])
    const table = tableButton(4)
    expect(table).toHaveAccessibleName("Mesa 4, Inactiva, sin sillas")
    expect(table).toHaveAttribute("data-inactive", "true")
    expect(within(table).getByText("Inactiva")).toBeInTheDocument()
    expect(within(table).queryByText("Libre")).not.toBeInTheDocument()
    expect(tableButton(5)).not.toHaveAttribute("data-inactive")
    // The consumer decides what a tap on it does (the waiter refuses a new order).
    act(() => table.click())
    expect(onSelectTable).toHaveBeenCalledWith("t-1")
  })

  it("an inactive table without a place is greyed in Sin ubicar too", () => {
    renderPlan([{ id: "t-9", number: 9, status: "available", isActive: false }])
    const strip = screen.getByRole("region", { name: "Sin ubicar" })
    expect(within(strip).getByRole("button", { name: /Mesa 9/ })).toHaveTextContent("Inactiva")
  })

  it("shows the zone minimap with the visible part once the floor is zoomed (phone/tablet)", () => {
    renderPlan([placed("t-1", 4), placed("t-2", 5, { x: 0.8, status: "kitchen" })])
    expect(screen.queryByRole("button", { name: /^Minimapa/ })).not.toBeInTheDocument()
    act(() => screen.getByRole("button", { name: "Acercar" }).click())
    const minimap = screen.getByRole("button", { name: "Minimapa de Salón principal: toca para ir a esa parte del plano" })
    expect(within(minimap).getAllByTestId("minimap-table")).toHaveLength(2)
    expect(within(minimap).getByTestId("minimap-view")).toBeInTheDocument()
    act(() => screen.getByRole("button", { name: "Ajustar" }).click())
    expect(screen.queryByRole("button", { name: /^Minimapa/ })).not.toBeInTheDocument()
  })
})

describe("FloorPlan — reservations off the map (reservas-mesas T3, S2)", () => {
  it("an unplaced reserved table shows the reservation name in the Sin ubicar strip", () => {
    renderPlan([{ id: "t-9", number: 9, status: "reserved", reservationName: "Familia López" }])
    const strip = screen.getByRole("region", { name: "Sin ubicar" })
    expect(within(strip).getByRole("button", { name: /Mesa 9.*Reserva: Familia López/ })).toBeInTheDocument()
  })
})
