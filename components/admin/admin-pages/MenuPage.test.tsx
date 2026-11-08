import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * T9 (redesign) — the Menú section is the tree editor. menu-platos: promotions
 * live in their own section (T1) and the dish list is the editor's Platos tab
 * (T2), so nothing about dishes renders outside it.
 */

vi.mock("@/components/admin/menu/MenuTreeEditor", () => ({
  MenuTreeEditor: ({ onNavigate }: { onNavigate?: (id: string) => void }) => (
    <button type="button" onClick={() => onNavigate?.("formulas")}>
      stub-tree
    </button>
  ),
}))
vi.mock("@/components/admin/menu/DishList", () => ({
  DishList: () => <section aria-label="stub-dishes" />,
}))
vi.mock("@/components/admin/promotions/PromotionList", () => ({
  PromotionList: () => <section aria-label="stub-promotions" />,
}))

import { MenuPage } from "./MenuPage"

describe("MenuPage", () => {
  it("shows only the tree editor (with its tabs), no dish list or promotions of its own", () => {
    const onNavigate = vi.fn()
    render(<MenuPage description="Carta" onNavigate={onNavigate} />)

    expect(screen.getByRole("heading", { name: "Menú" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "stub-dishes" })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "stub-promotions" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "stub-tree" }))
    expect(onNavigate).toHaveBeenCalledWith("formulas")
  })
})
