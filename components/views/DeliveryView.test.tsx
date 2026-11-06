import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T25 (S2, S8) — the delivery view hands the console the operator's name and
 * shows the role nav only to a user with more than one role view (the admin,
 * who previews every role); a delivery operator has only this view.
 */

vi.mock("@/components/delivery/DeliveryBoard", () => ({
  DeliveryBoard: (props: { role: string; operatorName?: string; withRoleNav?: boolean }) => (
    <p data-testid="board">
      {props.role}|{props.operatorName}|{String(props.withRoleNav ?? false)}
    </p>
  ),
}))

vi.mock("@/components/layout/Header", () => ({ Header: () => <header>Domicilios</header> }))

import { DeliveryView } from "@/components/views/DeliveryView"
import { useProfileStore } from "@/store/useProfileStore"

const operator = { id: "p-1", name: "vrios", full_name: "Valentina Ríos", role: "delivery_operator" as const }
const deliveryTile = { id: "delivery-1", name: "Domicilios", full_name: "Domicilios", role: "delivery_operator" as const }

beforeEach(() => {
  useProfileStore.setState({ selectedProfile: null, authProfile: null, showProfileSelection: false })
})

describe("DeliveryView", () => {
  it("a delivery operator gets no role nav; the console gets the operator's name", () => {
    useProfileStore.setState({ authProfile: operator, selectedProfile: operator })
    render(<DeliveryView profile={operator} onChangeProfile={vi.fn()} authRole="delivery_operator" />)
    expect(screen.queryByRole("navigation", { name: "Vistas" })).not.toBeInTheDocument()
    expect(screen.getByTestId("board")).toHaveTextContent("delivery_operator|Valentina Ríos|false")
  })

  it("an admin previewing the delivery view gets the role nav, and a tile switches the view", () => {
    const admin = { id: "p-9", name: "admin", full_name: "Laura Gómez", role: "admin" as const }
    useProfileStore.setState({ authProfile: admin, selectedProfile: deliveryTile })
    render(<DeliveryView profile={deliveryTile} onChangeProfile={vi.fn()} authRole="admin" />)
    const nav = screen.getByRole("navigation", { name: "Vistas" })
    const links = within(nav).getAllByRole("button")
    expect(links.map((b) => b.textContent)).toEqual(["Mesas", "Cocina", "Caja", "Admin", "Domicilios"])
    expect(within(nav).getByRole("button", { name: "Domicilios" })).toHaveAttribute("aria-current", "page")
    // The operator is the signed-in person, not the preview tile.
    expect(screen.getByTestId("board")).toHaveTextContent("admin|Laura Gómez|true")

    fireEvent.click(within(nav).getByRole("button", { name: "Cocina" }))
    expect(useProfileStore.getState().selectedProfile?.role).toBe("kitchen")
  })
})
