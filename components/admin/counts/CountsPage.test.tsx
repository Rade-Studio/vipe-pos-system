import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    toast: vi.fn(),
    setCounted: mutation(),
    applyCount: mutation(),
    cancelCount: mutation(),
    openCount: mutation(),
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => {
  const q = (data: unknown) => ({ data, isLoading: false })
  const count = { id: "c1", number: 7, locationId: "loc1", locationName: "Bodega principal", status: "open", notes: null, appliedAt: null, createdAt: "2026-10-18T10:00:00Z" }
  const line = (id: string, itemId: string, name: string, expected: number, counted: number | null) => ({
    id, itemId, itemName: name, sku: `MP-${id}`, unit: "kg", expectedQuantity: expected, countedQuantity: counted, notes: null,
  })
  const items = [
    { id: "i1", cost: 2000 },
    { id: "i2", cost: 1000 },
    { id: "i3", cost: 500 },
  ]
  return {
    useInventoryCounts: () => q([count]),
    useInventoryCount: () =>
      q({
        ...count,
        lines: [line("l1", "i1", "Tomate", 10, 8), line("l2", "i2", "Cebolla", 5, null), line("l3", "i3", "Papa", 3, null)],
      }),
    useInventoryItems: () => q(items),
    useInventoryLocations: () => q([{ id: "loc1", name: "Bodega principal", code: "BOD", isDefault: true, isActive: true }]),
    useInventoryCategories: () => q([]),
    useOpenCount: () => h.openCount,
    useSetCountedQuantity: () => h.setCounted,
    useApplyCount: () => h.applyCount,
    useCancelCount: () => h.cancelCount,
  }
})

import { CountsPage } from "./CountsPage"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const openSheet = () => {
  render(<CountsPage description="d" />)
  fireEvent.click(screen.getAllByText("#7")[0])
}

beforeEach(() => {
  h.toast.mockReset()
  h.setCounted.mutateAsync.mockReset().mockResolvedValue(undefined)
  h.applyCount.mutateAsync.mockReset().mockResolvedValue({ countId: "c1", status: "applied", adjustedLines: 1, valueDelta: -4000 })
})

describe("CountsPage", () => {
  it("lists counts with counted lines and valued difference, and points mermas to Artículos", () => {
    const onNavigate = vi.fn()
    render(<CountsPage description="d" onNavigate={onNavigate} />)
    expect(screen.getAllByText("1/3").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Abierto").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Registrar merma en Artículos" }))
    expect(onNavigate).toHaveBeenCalledWith("inventory/items")
  })

  it("Enter saves the counted quantity and moves focus to the next row", async () => {
    openSheet()
    const onion = screen.getByLabelText("Contado Cebolla")
    fireEvent.focus(onion)
    fireEvent.change(onion, { target: { value: "4,5" } })
    await act(async () => {
      fireEvent.keyDown(onion, { key: "Enter" })
    })
    expect(h.setCounted.mutateAsync).toHaveBeenCalledWith({ countId: "c1", lineId: "l2", countedQuantity: 4.5 })
    expect(screen.getByLabelText("Contado Papa")).toHaveFocus()
  })

  it("blind mode hides the expected quantity until toggled", () => {
    openSheet()
    const row = screen.getByTestId("count-row-l1")
    expect(within(row).queryByText("10 kg")).toBeNull()
    expect(within(row).queryByText("-2 kg")).toBeNull()
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar esperado" }))
    expect(within(row).getByText("10 kg")).toBeInTheDocument()
  })

  it("apply shows the summary and calls applyCount", async () => {
    openSheet()
    fireEvent.click(screen.getByRole("button", { name: "Aplicar conteo" }))
    const summary = screen.getByTestId("apply-summary")
    expect(summary).toHaveTextContent("Líneas con diferencia: 1")
    expect(summary).toHaveTextContent(/Diferencia valorizada total: -\$\s?4\.000/)
    expect(summary).toHaveTextContent("Las 2 líneas sin contar se dejan sin cambios.")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })
    expect(h.applyCount.mutateAsync).toHaveBeenCalledWith("c1")
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Conteo aplicado" }))
  })
})
