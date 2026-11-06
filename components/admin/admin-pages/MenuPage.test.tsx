import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * T9 (redesign) — the Menú section is the tree editor; the full dish list (search,
 * pages, Fórmula) and the promotions stay reachable below it.
 */

vi.mock("@/components/admin/menu/MenuTreeEditor", () => ({
  MenuTreeEditor: () => <section aria-label="stub-tree" />,
}))
vi.mock("@/components/admin/menu/DishList", () => ({
  DishList: ({ onNavigate }: { onNavigate?: (id: string) => void }) => (
    <button type="button" onClick={() => onNavigate?.("formulas")}>
      stub-dishes
    </button>
  ),
}))
vi.mock("@/components/admin/promotions/PromotionList", () => ({
  PromotionList: () => <section aria-label="stub-promotions" />,
}))

import { MenuPage } from "./MenuPage"

describe("MenuPage", () => {
  it("shows the tree editor, then every dish and the promotions", () => {
    const onNavigate = vi.fn()
    render(<MenuPage description="Carta" onNavigate={onNavigate} />)

    expect(screen.getByRole("heading", { name: "Menú" })).toBeInTheDocument()
    const tree = screen.getByRole("region", { name: "stub-tree" })
    const promotions = screen.getByRole("region", { name: "stub-promotions" })
    const dishes = screen.getByRole("button", { name: "stub-dishes" })
    expect(tree.compareDocumentPosition(dishes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dishes.compareDocumentPosition(promotions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(dishes)
    expect(onNavigate).toHaveBeenCalledWith("formulas")
  })
})
