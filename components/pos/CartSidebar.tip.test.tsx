import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { CartSidebar } from "./CartSidebar"
import { useConfigStore } from "@/store/use-config-store"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"

/** H-047: the cart shows the tip set in Ajustes, read-only; the waiter cannot change it. */

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")
const items = [{ id: "d-1", name: "Bandeja", price: 20000, quantity: 1, categoryId: "c", image: "" }] as CartItem[]

function renderCart() {
  render(
    <CartSidebar
      tableNumber={1}
      cartItems={items}
      cartTotal={20000}
      onUpdateQuantity={() => {}}
      onUpdateComments={() => {}}
      onClearCart={() => {}}
      onSendToKitchen={() => {}}
      onToggleSidebar={() => {}}
      isSending={false}
      hasActiveTable
    />,
  )
}

beforeEach(() => {
  useConfigStore.setState({ tipPercentage: 10, taxPercentage: 0 })
})

describe("CartSidebar — tip (H-047)", () => {
  it("shows the configured tip with no control to change it", () => {
    renderCart()
    const row = screen.getByText(/Propina \(10%\)/).closest("div")!
    expect(squash(row.textContent)).toBe(squash(`Propina (10%): ${formatCurrency(2000)}`))
    expect(screen.queryByRole("button", { name: /propina/i })).not.toBeInTheDocument()
    expect(row.querySelector("button")).toBeNull()
    expect(screen.queryByRole("slider")).not.toBeInTheDocument()
    expect(useConfigStore.getState().tipPercentage).toBe(10)
  })
})
