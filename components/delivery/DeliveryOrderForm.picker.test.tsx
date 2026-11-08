import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { modifierGroup } from "@/lib/modifiers/fixtures"

/**
 * T11 (S3, S5) — the Productos step of the new delivery is the waiter's step
 * picker (Categoría → Subcategoría → Plato → Agregar) over the same menu tree;
 * picked dishes go into the existing delivery draft.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  getMenuTree: vi.fn(),
  fetchDishes: vi.fn(),
  pickerToast: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api/catalog", () => ({ getMenuTree: env.getMenuTree, fetchDishes: env.fetchDishes }))

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, findCustomerByPhone: vi.fn(async () => null), createDeliveryOrder: env.createDeliveryOrder }
})

vi.mock("@/hooks/use-toast", () => ({ toast: env.toast, useToast: () => ({ toast: env.pickerToast }) }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"

const tree = {
  categories: [
    menuCategory({
      id: "c-1",
      name: "Platos fuertes",
      color: "orange",
      subcategories: [
        { id: "s-1", name: "Carnes" },
        { id: "s-2", name: "Típicos" },
      ],
      dishes: [
        menuDish({ id: "d-1", name: "Bandeja paisa", price: 32000, subcategoryId: "s-1" }),
        menuDish({ id: "d-2", name: "Ajiaco", price: 28000, subcategoryId: "s-2", available: false }),
      ],
    }),
    menuCategory({
      id: "c-2",
      name: "Bebidas",
      sortOrder: 1,
      dishes: [menuDish({ id: "d-3", name: "Limonada", price: 5000, allowComments: false })],
    }),
  ],
  uncategorized: [menuDish({ id: "d-9", name: "Empanada", price: 3000 })],
}

beforeEach(() => {
  vi.clearAllMocks()
  env.getMenuTree.mockResolvedValue(tree)
  env.createDeliveryOrder.mockResolvedValue({ consumption: { shortages: [] } })
})

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeliveryOrderForm suggestedFee={0} taxPct={0} onSubmitted={vi.fn()} />
    </QueryClientProvider>,
  )
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

const formStep = (name: string) =>
  within(screen.getByRole("navigation", { name: "Pasos del domicilio" })).getByRole("button", { name: new RegExp(name) })

async function openProducts() {
  await click(formStep("Productos"))
  await screen.findByRole("heading", { level: 2, name: "¿Qué categoría?" })
}

/** Category → (subcategory) → dish → quantity/note → Agregar, through the tiles. */
async function addBySteps(category: string, sub: string | null, dish: RegExp, quantity = 1, note?: string) {
  await click(screen.getByRole("button", { name: new RegExp(`^${category}`) }))
  if (sub) await click(screen.getByRole("button", { name: new RegExp(`^${sub}`) }))
  await click(screen.getByRole("button", { name: dish }))
  for (let i = 1; i < quantity; i++) await click(screen.getByRole("button", { name: "Sumar uno" }))
  if (note) fireEvent.change(screen.getByLabelText("Nota para cocina (opcional)"), { target: { value: note } })
  await click(screen.getByRole("button", { name: new RegExp(`^Agregar ${quantity} .* al pedido$`) }))
}

const summary = () => screen.getByRole("complementary", { name: "Resumen del pedido" })

describe("DeliveryOrderForm — Productos uses the step picker (T11)", () => {
  it("renders the categories of the menu tree as tiles, with Otros for dishes without category", async () => {
    renderForm()
    await openProducts()
    expect(env.getMenuTree).toHaveBeenCalledTimes(1)
    const tiles = ["Platos fuertes", "Bebidas", "Otros"].map((name) =>
      screen.getByRole("button", { name: new RegExp(`^${name}`) }),
    )
    expect(tiles.every(Boolean)).toBe(true)
    expect(screen.queryByLabelText("Buscar plato")).not.toBeInTheDocument()
  })

  it("does not read the menu until the Productos step opens", () => {
    renderForm()
    expect(env.getMenuTree).not.toHaveBeenCalled()
  })

  it("adds through the steps with the dish, quantity, unit price and note; the same dish + note merges", async () => {
    renderForm()
    await openProducts()
    await addBySteps("Platos fuertes", "Carnes", /^Bandeja paisa/, 2, "sin cebolla")
    // After Agregar the picker is back on Categoría.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("¿Qué categoría?")
    await addBySteps("Platos fuertes", "Carnes", /^Bandeja paisa/, 1, "sin cebolla")
    await addBySteps("Bebidas", null, /^Limonada/)

    const lines = within(summary()).getAllByRole("listitem")
    expect(lines.map((li) => li.textContent?.replace(/\s/g, " "))).toEqual([
      expect.stringMatching(/^3×Bandeja paisa\$ ?96\.000$/),
      expect.stringMatching(/^1×Limonada\$ ?5\.000$/),
    ])
    expect(summary()).toHaveTextContent(/Total\s*\$\s*101\.000/)
  })

  it("Deshacer in the toast takes back exactly what was added", async () => {
    renderForm()
    await openProducts()
    await addBySteps("Platos fuertes", "Carnes", /^Bandeja paisa/, 1)
    await addBySteps("Platos fuertes", "Carnes", /^Bandeja paisa/, 2)
    expect(env.pickerToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "✓ 2× Bandeja paisa agregada" }))
    const action = env.pickerToast.mock.calls.at(-1)![0].action as ReactElement<{ onClick: () => void }>
    await act(async () => action.props.onClick())
    expect(within(summary()).getAllByRole("listitem")[0]).toHaveTextContent(/^1×Bandeja paisa/)
    const first = env.pickerToast.mock.calls[0]![0].action as ReactElement<{ onClick: () => void }>
    await act(async () => first.props.onClick())
    expect(summary()).toHaveTextContent("Sin productos todavía.")
  })

  it("a sold-out dish cannot be added", async () => {
    renderForm()
    await openProducts()
    await click(screen.getByRole("button", { name: /^Platos fuertes/ }))
    await click(screen.getByRole("button", { name: /^Típicos/ }))
    await click(screen.getByRole("button", { name: /^Ajiaco, .*agotado$/ }))
    expect(env.pickerToast).toHaveBeenCalledWith({ title: "Agotado: Ajiaco · ofrece otra opción" })
    expect(screen.queryByRole("button", { name: /^Agregar \d+ .* al pedido$/ })).not.toBeInTheDocument()
    expect(summary()).toHaveTextContent("Sin productos todavía.")
  })

  it("Continuar on the picker goes to Pago and the exit goes back to Dirección", async () => {
    renderForm()
    await openProducts()
    await click(screen.getByRole("button", { name: "Dirección" }))
    expect(screen.getByRole("heading", { name: "¿A dónde va?" })).toBeInTheDocument()
    await openProducts()
    await click(screen.getByRole("button", { name: "Continuar" }))
    expect(screen.getByRole("heading", { name: "¿Cómo paga?" })).toBeInTheDocument()
  })

  it("creates the delivery with the same request body the old picker sent", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("Teléfono"))
    })
    fireEvent.change(await screen.findByLabelText("Nombre del cliente"), { target: { value: "Luis" } })
    fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Calle 1 # 2-3" } })
    await openProducts()
    await addBySteps("Platos fuertes", "Carnes", /^Bandeja paisa/, 2, "sin cebolla")
    await addBySteps("Bebidas", null, /^Limonada/)
    await addBySteps("Otros", null, /^Empanada/, 3)
    await click(formStep("Confirmar"))
    await click(screen.getByRole("button", { name: "Crear domicilio" }))

    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    expect(env.createDeliveryOrder.mock.calls[0]![0]).toEqual({
      customer: { phone: "3001234567", name: "Luis" },
      address: { addressLine: "Calle 1 # 2-3", neighborhood: null, reference: null, label: null, save: false },
      items: [
        { dishId: "d-1", quantity: 2, comments: "sin cebolla" },
        { dishId: "d-3", quantity: 1 },
        { dishId: "d-9", quantity: 3 },
      ],
      deliveryFee: 0,
      paymentMode: "cash_on_delivery",
      cashChangeFor: null,
      notes: null,
    })
  })
})

describe("DeliveryOrderForm — modifier sheet (F7 T3)", () => {
  const termino = modifierGroup({ id: "g-t", name: "Término", minSelect: 1, maxSelect: 1, options: [["o-medio", "Medio", 0]] })
  const adic = modifierGroup({ id: "g-a", name: "Adiciones", maxSelect: 2, options: [["o-ched", "Queso cheddar", 3000]] })

  it("adds a dish with options through the same sheet: totals include them and the body carries modifiers", async () => {
    env.getMenuTree.mockResolvedValue({
      categories: [
        menuCategory({ id: "c-h", name: "Hamburguesas", dishes: [menuDish({ id: "d-h", name: "Hamburguesa", price: 22000, modifierGroups: [termino, adic] })] }),
      ],
      uncategorized: [],
    })
    renderForm()
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("Teléfono"))
    })
    fireEvent.change(await screen.findByLabelText("Nombre del cliente"), { target: { value: "Luis" } })
    fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Calle 1 # 2-3" } })
    await openProducts()
    await click(screen.getByRole("button", { name: /^Hamburguesas/ }))
    await click(screen.getByRole("button", { name: /^Hamburguesa,/ }))
    const sheet = screen.getByRole("dialog", { name: "Hamburguesa" })
    await click(within(sheet).getByRole("radio", { name: /^Medio/ }))
    await click(within(sheet).getByRole("checkbox", { name: /^Queso cheddar/ }))
    await click(within(sheet).getByRole("button", { name: /^Agregar ·/ }))
    expect(summary().textContent?.replace(/\s+/g, " ")).toContain("25.000")
    await click(formStep("Confirmar"))
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    expect(env.createDeliveryOrder.mock.calls[0]![0].items).toEqual([
      { dishId: "d-h", quantity: 1, modifiers: [{ optionId: "o-medio" }, { optionId: "o-ched" }] },
    ])
  })
})
