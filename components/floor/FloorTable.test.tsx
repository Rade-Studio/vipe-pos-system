import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Table } from "@/types"
import { FloorTable } from "./FloorTable"

const table: Table = { id: "t-7", number: 7, status: "occupied", seats: 4, waiter: "w-1" }

const renderTile = (elapsed: string) =>
  render(<FloorTable table={table} aspect={1.6} selected={false} mine={false} waiterName="Ana" elapsed={elapsed} onSelect={() => {}} />)

/** S3: an order open 12 h or more gets a warning tone on its age chip. */
describe("FloorTable — old open order (S3)", () => {
  it("warns on an old order and names its age in days", () => {
    renderTile("6 d 1 h")
    const chip = screen.getByTestId("table-status")
    expect(chip).toHaveAttribute("data-old", "true")
    expect(chip).toHaveClass("bg-status-warning-bg")
    expect(screen.getByRole("button", { name: /abierta hace 6 d 1 h/ })).toBeInTheDocument()
  })

  it("keeps the status tone on a fresh order", () => {
    renderTile("18 min")
    const chip = screen.getByTestId("table-status")
    expect(chip).not.toHaveAttribute("data-old")
    expect(chip).not.toHaveClass("bg-status-warning-bg")
  })
})
