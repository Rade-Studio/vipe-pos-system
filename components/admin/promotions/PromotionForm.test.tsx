import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T7b (S4) — the promotion form computes the final dish set and replaces it
 * with ONE `PUT /catalog/promotions/:id/dishes`. The old add/remove pair
 * dropped kept dishes because `removePromotionDishes` was a copy of `assign`.
 */

const catalog = vi.hoisted(() => ({
  fetchDishes: vi.fn(),
  fetchPromotionDishes: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  setPromotionDishes: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalog)
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast: toastMock }))

import { PromotionForm } from "./PromotionForm"
import type { PromotionDto } from "@/lib/api/catalog"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const dish = (id: string, name: string) => ({
  id,
  name,
  description: null,
  price: 10000,
  categoryId: "c-1",
  imageUrl: null,
  active: true,
  allowComments: false,
  createdAt: null,
  updatedAt: null,
})

const promotion: PromotionDto = {
  id: "p-1",
  name: "Martes",
  description: null,
  kind: "product_discount",
  mode: "automatic",
  discountType: "percentage",
  discountValue: 10,
  buyQuantity: null,
  payQuantity: null,
  restDiscountPercent: null,
  comboPrice: null,
  comboGroups: [],
  minSubtotal: null,
  maxDiscount: null,
  startDate: "2026-11-01T00:00:00.000Z",
  endDate: "2026-12-01T00:00:00.000Z",
  daysOfWeek: [],
  timeWindows: [],
  channels: [],
  maxUsesPerOrder: null,
  active: true,
  targets: { dishIds: [], categoryIds: [], subcategoryIds: [] },
  stats: {} as PromotionDto["stats"],
  schedule: {} as PromotionDto["schedule"],
  sentence: "10% en Martes",
  badge: "10%",
  createdAt: null,
  updatedAt: null,
}

beforeEach(() => {
  for (const fn of Object.values(catalog)) fn.mockReset()
  catalog.fetchDishes.mockResolvedValue([dish("d-1", "Arepa"), dish("d-2", "Bandeja"), dish("d-3", "Caldo")])
  catalog.fetchPromotionDishes.mockResolvedValue([dish("d-1", "Arepa"), dish("d-2", "Bandeja")])
  catalog.updatePromotion.mockResolvedValue(promotion)
  catalog.createPromotion.mockResolvedValue({ ...promotion, id: "p-2" })
  catalog.setPromotionDishes.mockResolvedValue([])
  toastMock.mockClear()
})

describe("PromotionForm", () => {
  it("edits a promotion and sends the final dish set with one PUT", async () => {
    const onSubmit = vi.fn(async () => {})
    render(<PromotionForm open onOpenChange={vi.fn()} promotion={promotion} onSubmit={onSubmit} />)
    await waitFor(() => expect(screen.getByLabelText("Arepa")).toBeChecked())

    fireEvent.click(screen.getByLabelText("Arepa"))
    fireEvent.click(screen.getByLabelText("Caldo"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Promoción" }))
    })

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(catalog.fetchDishes).toHaveBeenCalledWith()
    expect(catalog.updatePromotion).toHaveBeenCalledWith("p-1", {
      kind: "product_discount",
      mode: "automatic",
      restDiscountPercent: null,
      name: "Martes",
      description: null,
      discountType: "percentage",
      discountValue: 10,
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
      active: true,
    })
    expect(catalog.setPromotionDishes).toHaveBeenCalledTimes(1)
    expect(catalog.setPromotionDishes).toHaveBeenCalledWith("p-1", ["d-2", "d-3"])
  })

  it("creates a promotion and assigns its dishes with one PUT", async () => {
    const onSubmit = vi.fn(async () => {})
    render(<PromotionForm open onOpenChange={vi.fn()} promotion={null} onSubmit={onSubmit} />)
    await waitFor(() => expect(screen.getByLabelText("Caldo")).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText("Nombre de la promoción"), { target: { value: "Combo" } })
    fireEvent.change(screen.getByLabelText("Porcentaje de descuento"), { target: { value: "15" } })
    fireEvent.click(screen.getByLabelText("Caldo"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear Promoción" }))
    })

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(catalog.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "product_discount",
        mode: "automatic",
        name: "Combo",
        discountType: "percentage",
        discountValue: 15,
        active: true,
      }),
    )
    expect(catalog.setPromotionDishes).toHaveBeenCalledTimes(1)
    expect(catalog.setPromotionDishes).toHaveBeenCalledWith("p-2", ["d-3"])
  })

  it("rejects an empty discount value instead of sending 0", async () => {
    render(<PromotionForm open onOpenChange={vi.fn()} promotion={promotion} onSubmit={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("Arepa")).toBeChecked())

    fireEvent.change(screen.getByLabelText("Porcentaje de descuento"), { target: { value: "" } })
    await act(async () => {
      fireEvent.submit(
        screen.getByRole("button", { name: "Actualizar Promoción" }).closest("form") as HTMLFormElement,
      )
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "El valor del descuento debe ser mayor que 0", variant: "destructive" }),
      ),
    )
    expect(catalog.updatePromotion).not.toHaveBeenCalled()
    expect(catalog.setPromotionDishes).not.toHaveBeenCalled()
  })

  it("shows the API message and keeps the dialog when the save fails", async () => {
    catalog.updatePromotion.mockRejectedValue(new Error("Invalid date"))
    const onOpenChange = vi.fn()
    render(<PromotionForm open onOpenChange={onOpenChange} promotion={promotion} onSubmit={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("Arepa")).toBeChecked())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Promoción" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: "Invalid date", variant: "destructive" })),
    )
    expect(catalog.setPromotionDishes).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
