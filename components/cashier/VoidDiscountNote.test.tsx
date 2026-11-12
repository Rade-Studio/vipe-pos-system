import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

/**
 * S13: voiding a line of an order with discounts warns that they are
 * recomputed. POST /orders/pricing-preview cannot price an order minus a
 * voided quantity, so v1 shows the generic note with the current discounts.
 */

import { VoidDiscountNote } from "./VoidDiscountNote"
import { formatCurrency } from "@/utils/helpers"

describe("VoidDiscountNote", () => {
  it("warns that the promotions are recomputed, with the current discounts", () => {
    render(<VoidDiscountNote totalDiscounts={38000} />)
    const note = screen.getByRole("note")
    const squash = (value: string | null) => (value ?? "").replace(/\s+/g, "")
    expect(note).toHaveTextContent("Las promociones se recalculan al anular")
    expect(squash(note.textContent)).toContain(squash(`Descuentos actuales: −${formatCurrency(38000)}`))
  })

  it("shows nothing for an order without discounts", () => {
    const { container } = render(<VoidDiscountNote totalDiscounts={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
