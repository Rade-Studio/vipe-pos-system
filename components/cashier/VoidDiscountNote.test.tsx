import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

/**
 * S1 (closes L23): voiding a line of an order with discounts shows the
 * discounts and total the void-aware preview recomputes; while it loads or
 * when it fails, the generic note with the current discounts.
 */

import { VoidDiscountNote } from "./VoidDiscountNote"
import { formatCurrency } from "@/utils/helpers"

const squash = (value: string | null) => (value ?? "").replace(/\s+/g, "")

describe("VoidDiscountNote", () => {
  it("warns that the promotions are recomputed, with the current discounts", () => {
    render(<VoidDiscountNote totalDiscounts={38000} />)
    const note = screen.getByRole("note")
    expect(note).toHaveTextContent("Las promociones se recalculan al anular")
    expect(squash(note.textContent)).toContain(squash(`Descuentos actuales: −${formatCurrency(38000)}`))
  })

  it("shows nothing for an order without discounts", () => {
    const { container } = render(<VoidDiscountNote totalDiscounts={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("with the preview, names the void and shows the recomputed discounts and total", () => {
    render(
      <VoidDiscountNote
        totalDiscounts={38000}
        preview={{ quantity: 1, name: "Mojito", promotionName: "2x1", totalDiscounts: 24000, total: 79000 }}
      />,
    )
    const note = screen.getByRole("note")
    expect(note).toHaveTextContent("Si anulas 1 Mojito, el 2x1 se recalcula.")
    expect(squash(note.textContent)).toContain(squash(`Descuentos: −${formatCurrency(24000)} · Total: ${formatCurrency(79000)}`))
    expect(note).not.toHaveTextContent("Las promociones se recalculan al anular")
  })

  it("without a promotion on the line, the promotions are recomputed", () => {
    render(
      <VoidDiscountNote
        totalDiscounts={14000}
        preview={{ quantity: 2, name: "Margarita", promotionName: null, totalDiscounts: 14000, total: 50000 }}
      />,
    )
    expect(screen.getByRole("note")).toHaveTextContent("Si anulas 2 Margarita, las promociones se recalculan.")
  })
})
