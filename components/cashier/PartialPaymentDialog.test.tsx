import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PartialPaymentDialog } from "./PartialPaymentDialog"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"

/** H-067: the dialog shows what the partial order will charge, tax and tip included. */

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")

const items = [
  { id: "i-1", name: "Taco", price: 12345, quantity: 3 },
  { id: "i-2", name: "Hamburguesa", price: 21900, quantity: 1 },
] as unknown as CartItem[]

function renderDialog(extra: { taxPercentage?: number; tipPercentage?: number } = {}) {
  const onCreatePartialOrder = vi.fn()
  render(
    <PartialPaymentDialog
      open
      onOpenChange={() => {}}
      tableItems={items}
      onCreatePartialOrder={onCreatePartialOrder}
      {...extra}
    />,
  )
  return { onCreatePartialOrder }
}

describe("PartialPaymentDialog (H-067)", () => {
  it("shows the amount to charge with tax and tip for the selected units", () => {
    const { onCreatePartialOrder } = renderDialog({ taxPercentage: 8, tipPercentage: 8 })
    fireEvent.click(screen.getByLabelText("Taco"))
    fireEvent.click(screen.getByRole("button", { name: "Disminuir" }))
    fireEvent.click(screen.getByRole("button", { name: "Disminuir" }))

    // 1 × 12.345: tax round(987,6) = 988, tip 988.
    expect(squash(screen.getByTestId("partial-subtotal").textContent)).toBe(squash(formatCurrency(12345)))
    expect(squash(screen.getByTestId("partial-tax").textContent)).toBe(squash(formatCurrency(988)))
    expect(squash(screen.getByTestId("partial-tip").textContent)).toBe(squash(formatCurrency(988)))
    expect(squash(screen.getByTestId("partial-total").textContent)).toBe(squash(formatCurrency(14321)))

    fireEvent.click(screen.getByRole("button", { name: "Crear Orden Parcial" }))
    expect(onCreatePartialOrder).toHaveBeenCalledWith([{ itemId: "i-1", quantity: 1 }])
  })

  it("without percentages the total is still the selected products, as before", () => {
    renderDialog()
    fireEvent.click(screen.getByLabelText("Hamburguesa"))
    expect(squash(screen.getByTestId("partial-total").textContent)).toBe(squash(formatCurrency(21900)))
    expect(screen.queryByTestId("partial-tax")).not.toBeInTheDocument()
    expect(screen.queryByTestId("partial-tip")).not.toBeInTheDocument()
  })
})
