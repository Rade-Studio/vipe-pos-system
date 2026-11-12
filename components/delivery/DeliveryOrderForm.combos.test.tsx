import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PricingPreviewDto } from "@/lib/api/promotions"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { active, menuEjecutivo, other, promotion, today } from "@/lib/promotions/fixtures"

/**
 * S7 (promociones-mejoras M8) — combos in the new-delivery form: the combo
 * tile of a promotion live for delivery opens the waiter's ComboBuilder, the
 * combo is one cart line, the preview prices it as a combo line and the order
 * sends it in `combos`.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  findCustomerByPhone: vi.fn(),
  listPaymentMethods: vi.fn(),
  getMenuTree: vi.fn(),
  getPromotionsToday: vi.fn(),
  getPricingPreview: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock("@/lib/api/catalog", () => ({ getMenuTree: env.getMenuTree, fetchDishes: async () => [] }))
vi.mock("@/lib/api/promotions", () => ({ getPromotionsToday: env.getPromotionsToday, getPricingPreview: env.getPricingPreview }))
vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, findCustomerByPhone: env.findCustomerByPhone, createDeliveryOrder: env.createDeliveryOrder }
})
vi.mock("@/lib/api/payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/payments")>("@/lib/api/payments")
  return { ...actual, listPaymentMethods: env.listPaymentMethods }
})
vi.mock("@/hooks/use-toast", () => ({ toast: env.toast, useToast: () => ({ toast: vi.fn() }) }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"

const customer = {
  customer: { id: "cust-1", phone: "3001234567", name: "Carolina Restrepo", notes: null, createdAt: "", updatedAt: "" },
  addresses: [
    {
      id: "a-1",
      customerId: "cust-1",
      label: null,
      addressLine: "Cra 43A # 18 Sur-135",
      neighborhood: "El Poblado",
      reference: null,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
  ],
  history: { ordersCount: 0, lastOrderAt: null, lastAddress: null },
}

const combo = promotion({ ...menuEjecutivo, channels: ["delivery"] })
const choices = [
  { groupId: "g-sopa", dishId: "d-ajiaco" },
  { groupId: "g-principio", dishId: "d-bandeja" },
  { groupId: "g-bebida", dishId: "d-mora" },
]

const menu = {
  categories: [
    menuCategory({
      id: "c-1",
      name: "Almuerzos",
      dishes: [
        menuDish({ id: "d-ajiaco", name: "Ajiaco", price: 9000, allowComments: false }),
        menuDish({ id: "d-bandeja", name: "Bandeja", price: 17000, allowComments: false }),
        menuDish({ id: "d-pollo", name: "Pollo", price: 16000, allowComments: false }),
        menuDish({ id: "d-mora", name: "Jugo de mora", price: 7000, allowComments: false }),
      ],
    }),
  ],
}

const comboLine = (dishId: string, name: string, unitPrice: number, discount: number) => ({
  sent: false,
  orderItemId: null,
  draftIndex: 0,
  dishId,
  name,
  quantity: 1,
  unitPrice,
  promotionId: "p-ejec",
  promotionName: "Menú ejecutivo",
  comboId: "draft-combo-0",
  addedAt: null,
  discounts: discount ? [{ kind: "combo" as const, promotionId: "p-ejec", label: "Menú ejecutivo", amount: discount }] : [],
})

const preview: PricingPreviewDto = {
  channel: "delivery",
  now: "2026-11-12T17:10:00.000Z",
  lines: [comboLine("d-ajiaco", "Ajiaco", 9000, 9000), comboLine("d-bandeja", "Bandeja", 17000, 0), comboLine("d-mora", "Jugo de mora", 7000, 0)],
  billDiscount: null,
  manualDiscounts: [],
  grossSubtotal: 33000,
  totalDiscounts: 9000,
  netSubtotal: 24000,
  tax: null,
  tip: null,
  total: null,
  deliveryFee: null,
  hints: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  env.findCustomerByPhone.mockResolvedValue(customer)
  env.listPaymentMethods.mockResolvedValue([])
  env.createDeliveryOrder.mockResolvedValue({ consumption: { shortages: [] } })
  env.getMenuTree.mockResolvedValue(menu)
  env.getPromotionsToday.mockResolvedValue(today({ channel: "delivery", active: [active(combo, "15:00", 150)] }))
  env.getPricingPreview.mockResolvedValue(preview)
})

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeliveryOrderForm suggestedFee={5000} taxPct={0} onSubmitted={vi.fn()} />
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
const summary = () => screen.getByRole("complementary", { name: "Resumen del pedido" })

async function lookUp() {
  fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
  await act(async () => {
    fireEvent.blur(screen.getByLabelText("Teléfono"))
  })
  await screen.findByText(/Cliente encontrado/)
}

async function openProducts() {
  await click(formStep("Productos"))
  await screen.findByRole("heading", { level: 2, name: "¿Qué categoría?" })
}

async function buildMenu() {
  await openProducts()
  const tile = await screen.findByRole("button", { name: /^Menú ejecutivo/ })
  expect(tile).not.toHaveAttribute("aria-disabled")
  expect(tile).toHaveTextContent("Combo · hasta 15:00")
  await click(tile)
  expect(screen.getByRole("heading", { name: "Menú ejecutivo" })).toHaveFocus()
  await click(screen.getByRole("button", { name: /^Ajiaco/ }))
  await click(screen.getByRole("button", { name: /^Bandeja/ }))
  await click(screen.getByRole("button", { name: /^Jugo de mora/ }))
  await click(screen.getByRole("button", { name: /^Agregar menú ·/ }))
}

describe("DeliveryOrderForm — combos (S7)", () => {
  it("builds a live delivery combo as one cart line, prices it in the preview and sends it in combos", async () => {
    renderForm()
    await lookUp()
    await buildMenu()
    expect(env.toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Menú ejecutivo agregado · ahorra \$\s?9\.000$/))
    await waitFor(() => expect(env.getPricingPreview).toHaveBeenLastCalledWith({ channel: "delivery", lines: [{ comboPromotionId: "p-ejec", choices }] }))
    const aside = summary()
    expect(within(aside).getAllByRole("listitem")).toHaveLength(1)
    expect(aside).toHaveTextContent("Ajiaco · Bandeja · Jugo de mora")
    await waitFor(() => expect(aside).toHaveTextContent(/Menú ejecutivo\s*−\s*\$\s*9\.000/))
    // 33.000 − 9.000 + 5.000 of delivery fee.
    expect(aside).toHaveTextContent(/Total\s*\$\s*29\.000/)

    await click(formStep("Confirmar"))
    expect(screen.queryByPlaceholderText("Comentario")).not.toBeInTheDocument()
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    const input = env.createDeliveryOrder.mock.calls[0]![0]
    expect(input.items).toEqual([])
    expect(input.combos).toEqual([{ comboPromotionId: "p-ejec", choices }])
  })

  it("before the preview answers, the combo line already shows its own saving", async () => {
    env.getPricingPreview.mockReturnValue(new Promise(() => {}))
    renderForm()
    await lookUp()
    await buildMenu()
    expect(summary()).toHaveTextContent(/Menú ejecutivo\s*−\s*\$\s*9\.000/)
    expect(summary()).toHaveTextContent(/Total\s*\$\s*29\.000/)
  })

  it("outside its schedule the combo tile is disabled and says when it is sold", async () => {
    env.getPromotionsToday.mockResolvedValue(today({ channel: "delivery", others: [other(combo, "outside_hours")] }))
    renderForm()
    await openProducts()
    const tile = await screen.findByRole("button", { name: /^Menú ejecutivo/ })
    expect(tile).toHaveAttribute("aria-disabled", "true")
    await click(tile)
    expect(env.toast.info).toHaveBeenCalledWith("El Menú ejecutivo se vende de lunes a viernes de 12:00 a 15:00")
    expect(screen.queryByText(/Elige 1 de cada grupo/)).not.toBeInTheDocument()
  })

  it("without combos for delivery there is no combo tile and the body has no combos", async () => {
    env.getPromotionsToday.mockResolvedValue(today({ channel: "delivery" }))
    renderForm()
    await lookUp()
    await openProducts()
    await click(screen.getByRole("button", { name: /^Almuerzos/ }))
    expect(screen.queryByRole("button", { name: /^Menú ejecutivo/ })).not.toBeInTheDocument()
    await click(screen.getByRole("button", { name: /^Ajiaco/ }))
    await click(screen.getByRole("button", { name: /^Agregar 1 .* al pedido$/ }))
    await click(formStep("Confirmar"))
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    const input = env.createDeliveryOrder.mock.calls[0]![0]
    expect(input.items).toEqual([{ dishId: "d-ajiaco", quantity: 1 }])
    expect("combos" in input).toBe(false)
  })
})
