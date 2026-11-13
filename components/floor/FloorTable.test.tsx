import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Table } from "@/types"
import type { TableAlert } from "@/lib/floor/alerts"
import { FloorTable } from "./FloorTable"

const table: Table = { id: "t-7", number: 7, status: "occupied", seats: 4, waiter: "w-1" }

const renderTile = (elapsed: string | null, alert?: TableAlert) =>
  render(
    <FloorTable table={table} aspect={1.6} selected={false} mine={false} waiterName="Ana" elapsed={elapsed} alert={alert} onSelect={() => {}} />,
  )

/** S3: an order open 12 h or more gets an icon-only warning badge (ux-carta-mesero S5: no pill). */
describe("FloorTable — old open order (S3)", () => {
  it("warns on an old order and names its age in days", () => {
    renderTile("6 d 1 h")
    expect(screen.getByTestId("table-old")).toHaveClass("bg-status-warning-bg")
    expect(screen.getByRole("button", { name: /abierta hace 6 d 1 h/ })).toBeInTheDocument()
  })

  it("draws no warning on a fresh order", () => {
    renderTile("18 min")
    expect(screen.queryByTestId("table-old")).not.toBeInTheDocument()
  })
})

describe("FloorTable — no state pill (ux-carta-mesero S5)", () => {
  it("prints no status or elapsed pill; the accessible name keeps them", () => {
    renderTile("18 min")
    expect(screen.queryByTestId("table-status")).not.toBeInTheDocument()
    expect(screen.queryByText("Ocupada")).not.toBeInTheDocument()
    expect(screen.getByRole("button")).toHaveAccessibleName("Mesa 7, Ocupada, 4 sillas, Ana, abierta hace 18 min")
  })
})

describe("FloorTable — carta alert (ux-carta-mesero S4)", () => {
  it("draws the attention badge with its count and names the requests", () => {
    renderTile(null, { kinds: new Set(["bill", "proposal"]), count: 2 })
    const badge = screen.getByTestId("table-alert")
    expect(badge).toHaveAttribute("data-kind", "bill")
    expect(badge).toHaveTextContent("2")
    expect(badge).toHaveClass("motion-reduce:animate-none")
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Mesa 7, Ocupada, 4 sillas, Ana, pide la cuenta, pedido de la carta por confirmar",
    )
  })

  it("hides the count for a single item and draws nothing without an alert", () => {
    const { unmount } = renderTile(null, { kinds: new Set(["waiter"]), count: 1 })
    expect(screen.getByTestId("table-alert")).toHaveAttribute("data-kind", "waiter")
    expect(screen.getByTestId("table-alert")).not.toHaveTextContent("1")
    unmount()
    renderTile(null)
    expect(screen.queryByTestId("table-alert")).not.toBeInTheDocument()
  })

  it("draws no alert in the mini map", () => {
    render(<FloorTable table={table} aspect={1.6} selected={false} mine={false} mode="mini" alert={{ kinds: new Set(["bill"]), count: 1 }} onSelect={() => {}} />)
    expect(screen.queryByTestId("table-alert")).not.toBeInTheDocument()
  })
})
