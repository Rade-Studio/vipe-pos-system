import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  const count = {
    id: "c14", number: 14, locationId: "loc1", locationName: "Cocina caliente", status: "open", stage: "review", notes: null,
    counterId: "p-andres", counterName: "Andrés Gómez", approverId: "p-mariana", approverName: "Mariana Restrepo",
    submittedAt: "2026-11-12T22:31:00Z", appliedAt: null, appliedBy: null, appliedByName: null, differenceValue: -45700,
    createdAt: "2026-11-12T21:48:00Z",
  }
  const line = (id: string, name: string, expected: number, counted: number, value: number, required = false, notes: string | null = null) => ({
    id, itemId: `i-${id}`, itemName: name, sku: `MP-${id}`, unit: "kg", expectedQuantity: expected, countedQuantity: counted,
    difference: Math.round((counted - expected) * 1000) / 1000, differenceValue: value, reasonRequired: required, recount: false, notes,
  })
  return {
    toast: vi.fn(),
    openCount: mutation(), applyCount: mutation(), cancelCount: mutation(), setCounted: mutation(),
    startCount: mutation(), recount: mutation(), reason: mutation(),
    count,
    detail: {
      ...count, reasonThreshold: 50000,
      lines: [
        line("l1", "Aceite vegetal", 5, 6, 9500),
        line("l2", "Chicharrón", 3.5, 1.2, -55200, true),
        line("l3", "Sal", 3, 3, 0),
      ],
    },
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => {
  const q = (data: unknown) => ({ data, isLoading: false })
  return {
    useInventoryCounts: () => q([h.count]),
    useInventoryCount: () => q(h.detail),
    useInventoryItems: () => q([{ id: "i-l1", cost: 9500, categoryId: "cat1", isActive: true }]),
    useInventoryLocations: () => q([{ id: "loc1", name: "Cocina caliente", code: "COC", isDefault: true, isActive: true }]),
    useInventoryCategories: () => q([{ id: "cat1", name: "Aceites" }]),
    useStaffMembers: () =>
      q([
        { id: "p-andres", fullName: "Andrés Gómez", role: "kitchen", active: true },
        { id: "p-mariana", fullName: "Mariana Restrepo", role: "admin", active: true },
        { id: "p-julian", fullName: "Julián Pérez", role: "admin", active: true },
      ]),
    useOpenCount: () => h.openCount,
    useSetCountedQuantity: () => h.setCounted,
    useApplyCount: () => h.applyCount,
    useCancelCount: () => h.cancelCount,
  }
})
vi.mock("@/hooks/counts/use-counts", () => ({
  useStartCount: () => h.startCount,
  useRequestRecount: () => h.recount,
  useSetCountReason: () => h.reason,
}))

import { CountsPage } from "./CountsPage"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const printed: string[] = []

beforeEach(() => {
  printed.splice(0)
  h.detail.lines[1].notes = null
  for (const m of [h.openCount, h.applyCount, h.startCount, h.recount, h.reason]) m.mutateAsync.mockReset()
  h.openCount.mutateAsync.mockResolvedValue({ countId: "c15", number: 15, linesCount: 41 })
  h.applyCount.mutateAsync.mockResolvedValue({ countId: "c14", status: "applied", adjustedLines: 2, valueDelta: -45700 })
  vi.spyOn(window, "open").mockImplementation(
    () => ({ document: { open() {}, close() {}, write: (html: string) => printed.push(html) } }) as unknown as Window,
  )
})

const openReview = (onNavigate = vi.fn()) => {
  render(<CountsPage description="d" onNavigate={onNavigate} />)
  fireEvent.click(screen.getAllByText("#14")[0])
  return onNavigate
}

describe("Conteos — list and Preparar", () => {
  it("explains the 4 steps and lists counts with stage, people and valued difference", () => {
    render(<CountsPage description="d" />)
    const steps = screen.getByRole("list", { name: "Cómo funciona un conteo" })
    expect(steps).toHaveTextContent(/Preparar.*Contar.*Revisar diferencias.*Aplicar ajuste/)
    expect(screen.getAllByText("En revisión").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Andrés Gómez/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/-\$\s?45\.700/).length).toBeGreaterThan(0)
  })

  it("the approver can never be the counter, and opening assigns both and starts the count", async () => {
    render(<CountsPage description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo conteo" }))
    expect(screen.getByText(/Las existencias en tránsito no se cuentan en ninguna bodega/)).toBeInTheDocument()
    const counter = screen.getByLabelText("Cuenta")
    expect(within(counter).getByRole("option", { name: /Andrés Gómez/ })).toBeInTheDocument()
    fireEvent.change(counter, { target: { value: "p-mariana" } })
    const approver = screen.getByLabelText("Revisa y aprueba")
    expect(within(approver).queryByRole("option", { name: /Andrés Gómez/ })).toBeNull()
    expect(within(approver).getByRole("option", { name: /Mariana Restrepo/ })).toBeDisabled()
    expect(approver).toHaveValue("p-julian")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir conteo" }))
    })
    expect(h.openCount.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "loc1", itemIds: null, counterId: "p-mariana", approverId: "p-julian" }),
    )
    expect(h.startCount.mutateAsync).toHaveBeenCalledWith("c15")
  })
})

describe("Conteos — Revisar y aplicar", () => {
  it("sorts by absolute COP difference, highlights big ones and requires a reason at the threshold", async () => {
    openReview()
    const rows = within(screen.getByRole("table", { name: /Diferencias del conteo #14/ })).getAllByRole("row").slice(1)
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      expect.stringContaining("Chicharrón"),
      expect.stringContaining("Aceite vegetal"),
    ])
    expect(rows[0]).toHaveTextContent("Diferencia grande")
    expect(screen.getByRole("button", { name: "Aplicar ajuste" })).toBeDisabled()
    expect(screen.getByText(/Faltan 1 motivo/)).toBeInTheDocument()
    const reason = screen.getByLabelText("Motivo de la diferencia de Chicharrón (obligatorio)")
    await act(async () => {
      fireEvent.change(reason, { target: { value: "Merma no registrada (se dañó o venció)" } })
    })
    expect(h.reason.mutateAsync).toHaveBeenCalledWith({ countId: "c14", lineId: "l2", reason: "Merma no registrada (se dañó o venció)" })
  })

  it("Recontar marks lines and sends them back to the counter", async () => {
    openReview()
    fireEvent.click(screen.getByRole("button", { name: "Recontar Chicharrón" }))
    expect(screen.getByRole("button", { name: "Recontar Chicharrón" })).toHaveAttribute("aria-pressed", "true")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pedir recuento (1)" }))
    })
    expect(h.recount.mutateAsync).toHaveBeenCalledWith({ countId: "c14", lineIds: ["l2"] })
  })

  it("Aplicar ajuste applies once every reason is in and links to Movimientos", async () => {
    h.detail.lines[1].notes = "Merma no registrada (se dañó o venció)"
    const onNavigate = openReview()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar ajuste" }))
    })
    expect(h.applyCount.mutateAsync).toHaveBeenCalledWith("c14")
    fireEvent.click(screen.getByRole("button", { name: /Ver los movimientos/ }))
    expect(onNavigate).toHaveBeenCalledWith("inventory/movements")
  })

  it("prints the blind count sheet and the adjustment record", () => {
    openReview()
    fireEvent.click(screen.getByRole("button", { name: "Imprimir hoja de conteo" }))
    expect(printed[0]).toContain("Hoja de conteo · Conteo #14")
    expect(printed[0]).toContain("Aceites")
    expect(printed[0]).toContain("size:letter")
    fireEvent.click(screen.getByRole("button", { name: "Imprimir acta" }))
    expect(printed[1]).toContain("Acta de ajuste por conteo · #14")
    expect(printed[1]).toContain("Chicharrón")
  })
})
