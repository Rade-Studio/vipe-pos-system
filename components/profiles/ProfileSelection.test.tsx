import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

const signOut = vi.hoisted(() => vi.fn())
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))
vi.mock("@/lib/api/auth", () => ({ signOutAndReload: signOut }))

import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useConfigStore } from "@/store/use-config-store"
import type { Order, Table } from "@/types"

const admin = { id: "p-9", name: "admin", full_name: "Laura Gómez", role: "admin" as const }

function renderPicker() {
  const onSelectProfile = vi.fn()
  render(<ProfileSelection profiles={useProfileStore.getState().roleProfiles} onSelectProfile={onSelectProfile} />)
  return onSelectProfile
}

const rows = () => within(screen.getByRole("list", { name: "Estaciones" })).getAllByRole("button")
const selectedRoles = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map(([p]) => p.role)

beforeEach(() => {
  signOut.mockReset()
  useProfileStore.setState({ authProfile: admin, selectedProfile: null, showProfileSelection: true })
  useTableStore.setState({ tables: [] })
  useOrderStore.setState({ orders: [] })
  useCashRegisterStore.setState({ registers: [], currentRegister: null })
  useConfigStore.setState({ businessName: "Casa Guadua" })
})

describe("ProfileSelection (station launcher)", () => {
  it("lists the five stations in launcher order with purpose, icon and shortcut; admin is current", () => {
    renderPicker()
    expect(screen.getByRole("heading", { level: 1, name: "Seleccionar perfil" })).toBeInTheDocument()
    expect(screen.getByText("Casa Guadua")).toBeInTheDocument()
    const list = rows()
    expect(list.map((r) => r.getAttribute("aria-keyshortcuts"))).toEqual(["1", "2", "3", "4", "5"])
    const expected = [
      ["Mesero", "Tomar pedidos por mesa"],
      ["Cocina", "Ver y despachar comandas"],
      ["Caja", "Cobrar y cerrar el turno"],
      ["Domicilios", "Despachar pedidos a domicilio"],
      ["Administrador", "Configurar y supervisar"],
    ]
    expected.forEach(([name, purpose], i) => {
      expect(list[i]).toHaveTextContent(name)
      expect(list[i]).toHaveTextContent(purpose)
      // A lucide svg, never initials.
      expect(list[i].querySelector("svg.lucide")).not.toBeNull()
    })
    expect(list.filter((r) => r.getAttribute("aria-current") === "true")).toEqual([list[4]])
    expect(list[4]).toHaveTextContent("Perfil actual")
  })

  it("clicking a station hands its role tile to the callback, as before", () => {
    const onSelect = renderPicker()
    for (const r of rows()) fireEvent.click(r)
    expect(selectedRoles(onSelect)).toEqual(["waiter", "kitchen", "cashier", "delivery_operator", "admin"])
    expect(onSelect.mock.calls[0][0]).toBe(useProfileStore.getState().roleProfiles[0])
  })

  it("digits 1–5 select that station; ignored while typing in an input", () => {
    const onSelect = renderPicker()
    fireEvent.keyDown(document, { key: "2" })
    fireEvent.keyDown(document, { key: "4" })
    expect(selectedRoles(onSelect)).toEqual(["kitchen", "delivery_operator"])

    const input = document.createElement("input")
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: "1" })
    fireEvent.keyDown(input, { key: "Escape" })
    input.remove()
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it("arrow keys move focus (wrapping) and Enter opens the focused station", () => {
    const onSelect = renderPicker()
    const list = rows()
    list[0].focus()
    fireEvent.keyDown(list[0], { key: "ArrowDown" })
    expect(list[1]).toHaveFocus()
    fireEvent.keyDown(list[1], { key: "ArrowUp" })
    fireEvent.keyDown(list[0], { key: "ArrowUp" })
    expect(list[4]).toHaveFocus()
    fireEvent.keyDown(list[4], { key: "ArrowDown" })
    expect(list[0]).toHaveFocus()
    fireEvent.click(list[0]) // Enter on a native button activates it
    expect(selectedRoles(onSelect)).toEqual(["waiter"])
  })

  it("Esc returns to the admin panel", () => {
    const onSelect = renderPicker()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(selectedRoles(onSelect)).toEqual(["admin"])
  })

  it("shows live counts only from data already in the stores", () => {
    useTableStore.setState({
      tables: (["available", "occupied", "kitchen", "served", "reserved"] as const).map(
        (status, i) => ({ id: `t${i}`, number: i + 1, status }) as Table,
      ),
    })
    useOrderStore.setState({
      orders: [{ id: "o1", status: "kitchen" }, { id: "o2", status: "kitchen" }, { id: "o3", status: "delivered" }] as Order[],
    })
    useCashRegisterStore.setState({
      registers: [{ id: "r1", status: "open", openingTimestamp: new Date(2026, 10, 6, 6, 42), initialCash: 0, transactions: [], cashTransactions: [] }],
    })
    renderPicker()
    const list = rows()
    expect(list[0]).toHaveTextContent("5 mesas · 3 ocupadas")
    expect(list[1]).toHaveTextContent("2 comandas en cocina")
    expect(list[2]).toHaveTextContent("Caja abierta · desde 06:42")
    expect(list[3]).not.toHaveTextContent(/activos/)
  })

  it("shows no count when the stores hold nothing", () => {
    renderPicker()
    const list = rows()
    expect(list[0]).not.toHaveTextContent(/ocupadas/)
    expect(list[1]).not.toHaveTextContent(/en cocina/)
    expect(list[2]).not.toHaveTextContent(/Caja (abierta|cerrada)/)
  })

  it("shows the signed-in user and signs out with the shared sign-out", () => {
    renderPicker()
    expect(screen.getByText("Laura Gómez")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("shows the shortcut legend", () => {
    renderPicker()
    const legend = screen.getByRole("region", { name: "Atajos de teclado" })
    expect(legend).toHaveTextContent("Entrar a la estación")
    expect(legend).toHaveTextContent("Moverse en la lista")
    expect(legend).toHaveTextContent("Volver al panel de Admin")
  })
})
