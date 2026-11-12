import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PricingPreviewDto } from "@/lib/api/promotions"
import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { active, promotion, today } from "@/lib/promotions/fixtures"

/**
 * S7 (promociones-mejoras) — the new-delivery form prices the draft like the
 * waiter does, on the delivery channel: tags on the tiles from
 * `GET /catalog/promotions/today?channel=delivery`, per-line discounts, the
 * bill discount, its hint and the savings from `POST /orders/pricing-preview`,
 * and the total and cash-change rule on the net. A failed preview never
 * blocks the order.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  findCustomerByPhone: vi.fn(),
  listPaymentMethods: vi.fn(),
  getMenuTree: vi.fn(),
  getPromotionsToday: vi.fn(),
  getPricingPreview: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

const tenPercent = promotion({
  id: "p-10",
  name: "10% en hamburguesas",
  kind: "product_discount",
  badge: "10%",
  channels: ["delivery"],
  targets: { dishIds: ["d-burger"], categoryIds: [], subcategoryIds: [] },
})
const twoForOne = promotion({
  id: "p-2x1",
  name: "2x1 en limonadas",
  channels: ["delivery"],
  targets: { dishIds: ["d-limonada"], categoryIds: [], subcategoryIds: [] },
})

const menu = {
  categories: [
    menuCategory({
      id: "c-1",
      name: "Comidas",
      dishes: [
        menuDish({ id: "d-burger", name: "Hamburguesa", price: 30000, allowComments: false }),
        menuDish({ id: "d-limonada", name: "Limonada", price: 8000, allowComments: false }),
      ],
    }),
  ],
}

function preview(overrides: Partial<PricingPreviewDto> = {}): PricingPreviewDto {
  return {
    channel: "delivery",
    now: "2026-11-12T23:10:00.000Z",
    lines: [
      {
        sent: false,
        orderItemId: null,
        draftIndex: 0,
        dishId: "d-burger",
        name: "Hamburguesa",
        quantity: 2,
        unitPrice: 30000,
        promotionId: "p-10",
        promotionName: "10% en hamburguesas",
        comboId: null,
        addedAt: null,
        discounts: [{ kind: "promotion_item", promotionId: "p-10", label: "10% en hamburguesas", amount: 6000 }],
      },
    ],
    billDiscount: null,
    manualDiscounts: [],
    grossSubtotal: 60000,
    totalDiscounts: 6000,
    netSubtotal: 54000,
    hints: [
      { kind: "bill_minimum", promotionId: "p-dom", message: "Domicilio: faltan $26.000 para el 10% de descuento.", missing: 26000 },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  env.findCustomerByPhone.mockResolvedValue(customer)
  env.listPaymentMethods.mockResolvedValue([])
  env.createDeliveryOrder.mockResolvedValue({ consumption: { shortages: [] } })
  env.getMenuTree.mockResolvedValue(menu)
  env.getPromotionsToday.mockResolvedValue(
    today({ channel: "delivery", active: [active(tenPercent, null, null), active(twoForOne, "19:00", 50)] }),
  )
  env.getPricingPreview.mockResolvedValue(preview())
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

async function openComidas() {
  await click(formStep("Productos"))
  await screen.findByRole("heading", { level: 2, name: "¿Qué categoría?" })
  await click(screen.getByRole("button", { name: /^Comidas/ }))
}

/** Two hamburgers through the picker's quantity step. */
async function addTwoBurgers() {
  await openComidas()
  await click(screen.getByRole("button", { name: /^Hamburguesa/ }))
  await click(screen.getByRole("button", { name: /^Agregar 1 .* al pedido$/ }))
  await click(formStep("Confirmar"))
  await click(screen.getByRole("button", { name: "Agregar uno de Hamburguesa" }))
}

describe("DeliveryOrderForm — promotions (S7)", () => {
  it("tags the dish tiles from today's delivery promotions", async () => {
    renderForm()
    await openComidas()
    expect(env.getPromotionsToday).toHaveBeenCalledWith("delivery")
    expect(await screen.findByRole("button", { name: /^Hamburguesa, .*, 10%$/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Limonada, .*, 2x1 · hasta 19:00$/ })).toBeInTheDocument()
  })

  it("prices the draft on the delivery channel: line discounts, savings, hint and the net total with the fee", async () => {
    renderForm()
    await lookUp()
    await addTwoBurgers()
    await waitFor(() =>
      expect(env.getPricingPreview).toHaveBeenLastCalledWith({ channel: "delivery", lines: [{ dishId: "d-burger", quantity: 2 }] }),
    )
    const aside = summary()
    await waitFor(() => expect(aside).toHaveTextContent(/10% en hamburguesas\s*−\s*\$\s*6\.000/))
    expect(aside).toHaveTextContent(/Ahorro con promociones\s*\$\s*6\.000/)
    expect(aside).toHaveTextContent("Domicilio: faltan $26.000 para el 10% de descuento.")
    // 60.000 − 6.000 + 5.000 of delivery fee.
    expect(aside).toHaveTextContent(/Total\s*\$\s*59\.000/)
  })

  it("shows the delivery bill discount line", async () => {
    env.getPricingPreview.mockResolvedValue(
      preview({
        billDiscount: { kind: "promotion_bill", promotionId: "p-dom", label: "10% en domicilios desde $80.000", amount: 5400 },
        totalDiscounts: 11400,
        netSubtotal: 48600,
        hints: [],
      }),
    )
    renderForm()
    await lookUp()
    await addTwoBurgers()
    const aside = summary()
    await waitFor(() => expect(aside).toHaveTextContent(/10% en domicilios desde \$80\.000\s*−\s*\$\s*5\.400/))
    expect(aside).not.toHaveTextContent("Domicilio: faltan")
    expect(aside).toHaveTextContent(/Total\s*\$\s*53\.600/)
  })

  it("the cash change is checked against the net total", async () => {
    renderForm()
    await lookUp()
    await addTwoBurgers()
    await waitFor(() => expect(summary()).toHaveTextContent(/Total\s*\$\s*59\.000/))
    await click(formStep("Pago"))
    fireEvent.change(screen.getByLabelText("Lleva cambio de"), { target: { value: "59000" } })
    expect(screen.queryAllByText("El cambio que lleva el domiciliario debe ser mayor o igual al total")).toHaveLength(0)
    fireEvent.change(screen.getByLabelText("Lleva cambio de"), { target: { value: "58999" } })
    expect(screen.getByLabelText("Lleva cambio de")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getAllByText("El cambio que lleva el domiciliario debe ser mayor o igual al total").length).toBeGreaterThan(0)
  })

  it("a preview failure after a good answer keeps the last good pricing", async () => {
    renderForm()
    await lookUp()
    await addTwoBurgers()
    await waitFor(() => expect(summary()).toHaveTextContent(/Ahorro con promociones\s*\$\s*6\.000/))
    env.getPricingPreview.mockRejectedValue(new Error("offline"))
    await click(screen.getByRole("button", { name: "Agregar uno de Hamburguesa" }))
    await waitFor(() => expect(env.getPricingPreview).toHaveBeenCalledTimes(2))
    expect(summary()).toHaveTextContent(/Ahorro con promociones\s*\$\s*6\.000/)
    expect(screen.getByRole("button", { name: "Crear domicilio" })).toBeEnabled()
  })

  it("a failed preview leaves the list-price total and the order can still be created", async () => {
    env.getPricingPreview.mockRejectedValue(new Error("offline"))
    renderForm()
    await lookUp()
    await addTwoBurgers()
    await waitFor(() => expect(env.getPricingPreview).toHaveBeenCalled())
    expect(summary()).toHaveTextContent(/Total\s*\$\s*65\.000/)
    expect(summary()).not.toHaveTextContent("Ahorro con promociones")
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    expect(env.createDeliveryOrder.mock.calls[0]![0].items).toEqual([{ dishId: "d-burger", quantity: 2 }])
  })
})
