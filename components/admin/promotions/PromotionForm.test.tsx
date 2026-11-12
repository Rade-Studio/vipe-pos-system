import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * promociones T6 (S10) — the promotion editor of the 02 artboard: four kinds,
 * their fields, when, where and how it applies, the live "Así funcionará"
 * sentence with a bill preview, the competing-promotion note, the API's 422
 * codes in Spanish next to the field, and pause, reactivate and delete.
 */

const catalog = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  fetchPromotions: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalog)
const subApi = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock("@/lib/api/subcategories", () => subApi)

import { ApiError } from "@/lib/api/errors"
import { PromotionForm } from "./PromotionForm"
import {
  ALL_PROMOTIONS,
  CATEGORIES,
  CERVEZA,
  DISHES,
  DOMICILIOS,
  HAPPY_HOUR,
  MARTES,
  MENU_EJECUTIVO,
  NOW,
  SUBCATEGORIES,
} from "./promotion-fixtures"
import type { PromotionDto } from "@/lib/api/catalog"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

function renderForm(promotion: PromotionDto | null, extra: Partial<Parameters<typeof PromotionForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    promotion,
    promotions: ALL_PROMOTIONS,
    onSaved: vi.fn(),
    onChanged: vi.fn(),
    onDeleted: vi.fn(),
    ...extra,
  }
  render(
    <QueryClientProvider client={client}>
      <PromotionForm {...props} />
    </QueryClientProvider>,
  )
  return props
}

const summary = () => within(screen.getByRole("region", { name: "Así funcionará" }))

async function pick(fieldLabel: RegExp | string, search: string, option: RegExp | string) {
  const group = screen.getByRole("group", { name: fieldLabel })
  fireEvent.click(within(group).getByRole("button", { name: "+ Agregar" }))
  fireEvent.change(within(group).getByRole("searchbox"), { target: { value: search } })
  fireEvent.click(await within(group).findByRole("button", { name: option }))
}

async function save(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  for (const fn of [...Object.values(catalog), subApi.getAll]) fn.mockReset()
  catalog.fetchCategories.mockResolvedValue(CATEGORIES)
  catalog.fetchDishes.mockResolvedValue(DISHES)
  subApi.getAll.mockResolvedValue(SUBCATEGORIES)
  catalog.createPromotion.mockImplementation(async (body) => ({ ...HAPPY_HOUR, ...body, id: "p-new" }))
  catalog.updatePromotion.mockImplementation(async (id, body) => ({ ...ALL_PROMOTIONS.find((p) => p.id === id), ...body }))
  catalog.deletePromotion.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe("creating each kind (S10, S1)", () => {
  it("sends a product discount on a subcategory, on Tuesdays", async () => {
    const props = renderForm(null)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Martes de hamburguesa 20%" } })
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "20" } })
    await pick("Aplica a", "hambur", /Hamburguesas/)
    for (const day of ["Lun", "Mié", "Jue", "Vie", "Sáb", "Dom"]) fireEvent.click(screen.getByRole("button", { name: day }))
    expect(screen.getByRole("button", { name: "Mar" })).toHaveAttribute("aria-pressed", "true")
    expect(summary().getByText("20% en la subcategoría Hamburguesas.")).toBeInTheDocument()
    expect(summary().getByText("−$5.800")).toBeInTheDocument()

    await save("Crear promoción")

    expect(catalog.createPromotion).toHaveBeenCalledWith({
      name: "Martes de hamburguesa 20%",
      kind: "product_discount",
      mode: "automatic",
      active: true,
      discountType: "percentage",
      discountValue: 20,
      buyQuantity: null,
      payQuantity: null,
      restDiscountPercent: null,
      comboPrice: null,
      comboGroups: [],
      minSubtotal: null,
      maxDiscount: null,
      targets: { dishIds: [], categoryIds: [], subcategoryIds: ["s-hamburguesas"] },
      daysOfWeek: [2],
      timeWindows: [],
      channels: [],
      maxUsesPerOrder: null,
      startDate: "2026-11-13",
      endDate: null,
    })
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "p-new" }), true))
  })

  it("sends a 2x1 on a category, weekdays 17:00–19:00, in the salón", async () => {
    renderForm(null)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Happy hour 2x1 en cócteles" } })
    fireEvent.click(screen.getByRole("radio", { name: /Lleva N, paga M/ }))
    await pick("Productos que cuentan", "cóct", /Cócteles/)
    fireEvent.click(screen.getByRole("button", { name: "Sáb" }))
    fireEvent.click(screen.getByRole("button", { name: "Dom" }))
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "17:00" } })
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "19:00" } })
    fireEvent.click(screen.getByRole("button", { name: "Domicilio" }))
    expect(screen.getByRole("button", { name: "Domicilio" })).toHaveAttribute("aria-pressed", "false")

    expect(summary().getByText("Lleva 2 cócteles y paga 1; sale gratis el más económico.")).toBeInTheDocument()
    expect(summary().getByText("De lunes a viernes de 17:00 a 19:00, en salón. Se aplica sola al pedir.")).toBeInTheDocument()
    expect(summary().getByText("−$24.000")).toBeInTheDocument()

    await save("Crear promoción")

    expect(catalog.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "buy_x_pay_y",
        discountType: null,
        discountValue: null,
        buyQuantity: 2,
        payQuantity: 1,
        restDiscountPercent: 100,
        targets: { dishIds: [], categoryIds: ["c-cocteles"], subcategoryIds: [] },
        daysOfWeek: [1, 2, 3, 4, 5],
        timeWindows: [{ from: "17:00", to: "19:00" }],
        channels: ["dine_in"],
        mode: "automatic",
      }),
    )
  })

  it("sends a combo with its groups", async () => {
    renderForm(null)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Menú ejecutivo $24.000" } })
    fireEvent.click(screen.getByRole("radio", { name: /Combo a precio fijo/ }))
    fireEvent.change(screen.getByLabelText("Precio del combo"), { target: { value: "24000" } })
    fireEvent.change(screen.getByLabelText("Nombre del grupo 1"), { target: { value: "Sopa" } })
    await pick("Platos del grupo 1", "sopa", /Sopa del día/)
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar grupo" }))
    fireEvent.change(screen.getByLabelText("Nombre del grupo 2"), { target: { value: "Principio" } })
    await pick("Platos del grupo 2", "bandeja", /Bandeja ejecutiva/)
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar grupo" }))
    fireEvent.change(screen.getByLabelText("Nombre del grupo 3"), { target: { value: "Jugo" } })
    await pick("Platos del grupo 3", "mora", /Jugo de mora/)
    expect(screen.getAllByText("elige 1")).toHaveLength(3)

    expect(summary().getByText("1 sopa + 1 principio + 1 jugo por $24.000.")).toBeInTheDocument()
    expect(summary().getByText("−$9.000")).toBeInTheDocument()

    await save("Crear promoción")

    expect(catalog.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "combo",
        comboPrice: 24000,
        comboGroups: [
          { name: "Sopa", dishIds: ["d-sopa"] },
          { name: "Principio", dishIds: ["d-bandeja"] },
          { name: "Jugo", dishIds: ["d-jugo"] },
        ],
        targets: { dishIds: [], categoryIds: [], subcategoryIds: [] },
        discountValue: null,
      }),
    )
  })

  it("sends a bill discount with minimum, cap, one use, delivery only and a PIN", async () => {
    renderForm(null)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "10% en domicilios desde $80.000" } })
    fireEvent.click(screen.getByRole("radio", { name: /Descuento a la cuenta/ }))
    fireEvent.change(screen.getByLabelText("Descuento"), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText("Cuenta mínima"), { target: { value: "80000" } })
    fireEvent.change(screen.getByLabelText("Tope"), { target: { value: "15000" } })
    fireEvent.click(screen.getByRole("button", { name: "Salón" }))
    fireEvent.change(screen.getByLabelText("Máximo por cuenta"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Cómo se aplica"), { target: { value: "manual_pin" } })

    expect(summary().getByText("10% en cuentas desde $80.000, con tope de $15.000.")).toBeInTheDocument()
    expect(summary().getByText("−$9.600")).toBeInTheDocument()

    await save("Crear promoción")

    expect(catalog.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "bill_discount",
        discountType: "percentage",
        discountValue: 10,
        minSubtotal: 80000,
        maxDiscount: 15000,
        channels: ["delivery"],
        maxUsesPerOrder: 1,
        mode: "manual_pin",
      }),
    )
  })
})

describe("editing (S10)", () => {
  it("keeps every field and saves only what the form holds, without resetting the start", async () => {
    const props = renderForm(HAPPY_HOUR)
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue("Happy hour 2x1 en cócteles")
    expect(screen.getByRole("radio", { name: /Lleva N, paga M/ })).toBeChecked()
    expect(screen.getByLabelText("Lleva")).toHaveValue(2)
    expect(screen.getByLabelText("Paga")).toHaveValue(1)
    expect(screen.getByLabelText("Las demás")).toHaveValue("100")
    expect(screen.getByLabelText("Desde")).toHaveValue("17:00")
    expect(screen.getByLabelText("Hasta")).toHaveValue("19:00")
    expect(screen.getByRole("button", { name: "Sáb" })).toHaveAttribute("aria-pressed", "false")
    expect(await screen.findByRole("button", { name: "Quitar Cócteles" })).toBeInTheDocument()

    await save("Guardar cambios")

    const [id, body] = catalog.updatePromotion.mock.calls[0]
    expect(id).toBe("p-happy")
    expect(body).not.toHaveProperty("startDate")
    expect(body).toMatchObject({
      kind: "buy_x_pay_y",
      buyQuantity: 2,
      payQuantity: 1,
      restDiscountPercent: 100,
      targets: HAPPY_HOUR.targets,
      daysOfWeek: [1, 2, 3, 4, 5],
      timeWindows: [{ from: "17:00", to: "19:00" }],
      channels: ["dine_in"],
    })
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "p-happy" }), false))
  })

  it("shows the live sentence of each kind as in 02", async () => {
    renderForm(HAPPY_HOUR)
    expect(await summary().findByText("Lleva 2 cócteles y paga 1; sale gratis el más económico.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Las demás"), { target: { value: "50" } })
    expect(summary().getByText("Lleva 2 cócteles; la segunda al 50%.")).toBeInTheDocument()
  })

  it.each([
    [MARTES, "20% en la subcategoría Hamburguesas."],
    [MENU_EJECUTIVO, "1 sopa + 1 principio + 1 jugo por $24.000."],
    [DOMICILIOS, "10% en cuentas desde $80.000, con tope de $15.000."],
  ])("reads %s.name as the server would", async (promotion, sentence) => {
    renderForm(promotion)
    expect(await summary().findByText(sentence)).toBeInTheDocument()
  })

  it("warns when another promotion reaches the same dish", async () => {
    renderForm(HAPPY_HOUR)
    const note = await screen.findByRole("note")
    expect(note).toHaveTextContent("Compite con otra promoción en 1 plato:")
    expect(note).toHaveTextContent("Michelada de la casa también está en «Segunda cerveza al 50%» (pausada).")
    expect(note).toHaveTextContent("Si las dos aplican a la vez, gana la que más ahorre al cliente.")
  })
})

describe("errors (S10)", () => {
  it("checks the form before sending and says why next to the field", async () => {
    renderForm(null)
    fireEvent.click(screen.getByRole("radio", { name: /Lleva N, paga M/ }))
    fireEvent.change(screen.getByLabelText("Paga"), { target: { value: "2" } })
    await save("Crear promoción")

    expect(catalog.createPromotion).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Nombre/)).toHaveAccessibleDescription("Escribe el nombre de la promoción")
    expect(screen.getByLabelText("Paga")).toHaveAccessibleDescription("Paga debe ser al menos 1 y menor que Lleva")
    expect(screen.getByLabelText("Paga")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Elige al menos un producto, categoría o subcategoría")).toBeInTheDocument()
  })

  it("shows a 422 in Spanish next to the field and keeps what was typed", async () => {
    catalog.updatePromotion.mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", "discountValue: discount_percentage_range", { code: "discount_percentage_range" }),
    )
    const props = renderForm(MARTES)
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "120" } })
    // Bypass the client check to exercise the server answer: a value the client accepts.
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "99" } })
    await save("Guardar cambios")

    expect(await screen.findByText("El porcentaje debe ser mayor que 0 y hasta 100")).toBeInTheDocument()
    expect(screen.getByLabelText("Valor")).toHaveValue(99)
    expect(screen.getByLabelText("Valor")).toHaveAccessibleDescription("El porcentaje debe ser mayor que 0 y hasta 100")
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("shows any other failure without losing the form", async () => {
    catalog.createPromotion.mockRejectedValueOnce(new Error("Network down"))
    renderForm(null)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Cortesía" } })
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "10" } })
    await pick("Aplica a", "postr", /Postres/)
    await save("Crear promoción")

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la promoción: Network down")
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue("Cortesía")
  })
})

describe("pause, reactivate and delete (S10)", () => {
  it("pauses an active promotion and reactivates a paused one, keeping the edits", async () => {
    const props = renderForm(HAPPY_HOUR)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Happy hour editado" } })
    await save("Pausar")
    expect(catalog.updatePromotion).toHaveBeenCalledWith("p-happy", {
      kind: "buy_x_pay_y",
      mode: "automatic",
      restDiscountPercent: 100,
      active: false,
    })
    expect(props.onChanged).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue("Happy hour editado")
    expect(screen.getByRole("button", { name: "Reactivar" })).toBeInTheDocument()
  })

  it("reactivates a paused one", async () => {
    renderForm(CERVEZA)
    await save("Reactivar")
    expect(catalog.updatePromotion).toHaveBeenCalledWith("p-cerveza", {
      kind: "buy_x_pay_y",
      mode: "automatic",
      restDiscountPercent: 50,
      active: true,
    })
  })

  it("deletes only after confirming", async () => {
    const props = renderForm(CERVEZA)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("¿Eliminar «Segunda cerveza al 50%»?")
    expect(catalog.deletePromotion).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar promoción" }))
    })
    expect(catalog.deletePromotion).toHaveBeenCalledWith("p-cerveza")
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith(CERVEZA))
  })
})
