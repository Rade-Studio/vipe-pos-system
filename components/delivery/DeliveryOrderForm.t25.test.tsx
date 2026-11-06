import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"

/**
 * T25 (S8) — the new-delivery drawer shows what L14 left out: the customer's
 * history and last address on Cliente, the prepaid payment channel on Pago
 * (the restaurant's active payment methods) and the editable fee.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  findCustomerByPhone: vi.fn(),
  listPaymentMethods: vi.fn(),
  getMenuTree: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api/catalog", () => ({ getMenuTree: env.getMenuTree, fetchDishes: async () => [] }))

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

const DAY = 86_400_000

const customer = {
  customer: {
    id: "cust-1",
    phone: "3001234567",
    name: "Carolina Restrepo",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
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
    {
      id: "a-2",
      customerId: "cust-1",
      label: null,
      addressLine: "Cl 10 # 32-15",
      neighborhood: "Laureles",
      reference: "frente al parque",
      isDefault: false,
      createdAt: "",
      updatedAt: "",
    },
  ],
  history: {
    ordersCount: 14,
    lastOrderAt: new Date(Date.now() - 6 * DAY - 60_000).toISOString(),
    lastAddress: { addressLine: "Cl 10 # 32-15", neighborhood: "Laureles", reference: "frente al parque" },
  },
}

const methods = [
  { id: "m-cash", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 0 },
  { id: "m-nequi", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 1 },
  { id: "m-davi", code: "daviplata", name: "Daviplata", kind: "electronic", isActive: false, sortOrder: 2 },
  { id: "m-card", code: "card", name: "Tarjeta", kind: "electronic", isActive: true, sortOrder: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  env.findCustomerByPhone.mockResolvedValue(customer)
  env.listPaymentMethods.mockResolvedValue(methods)
  env.createDeliveryOrder.mockResolvedValue({ consumption: { shortages: [] } })
  env.getMenuTree.mockResolvedValue({
    categories: [menuCategory({ id: "c-1", name: "Bebidas", dishes: [menuDish({ id: "d-3", name: "Limonada", price: 5000, allowComments: false })] })],
  })
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

async function lookUp() {
  fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
  await act(async () => {
    fireEvent.blur(screen.getByLabelText("Teléfono"))
  })
  await screen.findByText(/Cliente encontrado/)
}

async function addLimonada() {
  await click(formStep("Productos"))
  await screen.findByRole("heading", { level: 2, name: "¿Qué categoría?" })
  await click(screen.getByRole("button", { name: /^Bebidas/ }))
  await click(screen.getByRole("button", { name: /^Limonada/ }))
  await click(screen.getByRole("button", { name: /^Agregar 1 .* al pedido$/ }))
}

async function submit() {
  await click(formStep("Confirmar"))
  await click(screen.getByRole("button", { name: "Crear domicilio" }))
  await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
  return env.createDeliveryOrder.mock.calls[0]![0]
}

describe("DeliveryOrderForm — customer history (T25)", () => {
  it("shows the history line and offers the last address, which selects the saved one", async () => {
    renderForm()
    await lookUp()
    expect(screen.getByText(/Cliente encontrado/)).toHaveTextContent("Cliente encontrado · 14 pedidos · último hace 6 días")
    const last = screen.getByRole("group", { name: "Última dirección" })
    expect(last).toHaveTextContent("Cl 10 # 32-15, Laureles (frente al parque)")
    await click(within(last).getByRole("button", { name: "Usar esta dirección" }))
    // The drawer moves on to Dirección with the matching saved address chosen.
    expect(screen.getByRole("heading", { name: "¿A dónde va?" })).toBeInTheDocument()
    await addLimonada()
    expect((await submit()).address).toEqual({ id: "a-2" })
  })

  it("without history the line says so and no last address is offered", async () => {
    env.findCustomerByPhone.mockResolvedValue({ ...customer, history: { ordersCount: 0, lastOrderAt: null, lastAddress: null } })
    renderForm()
    await lookUp()
    expect(screen.getByText(/Cliente encontrado/)).toHaveTextContent("Cliente encontrado · Sin pedidos anteriores")
    expect(screen.queryByRole("group", { name: "Última dirección" })).not.toBeInTheDocument()
  })
})

describe("DeliveryOrderForm — prepaid payment channel (T25)", () => {
  it("lists the active non-cash payment methods only for a prepaid order", async () => {
    renderForm()
    await click(formStep("Pago"))
    expect(screen.queryByRole("radiogroup", { name: /^Canal de pago/ })).not.toBeInTheDocument()
    expect(env.listPaymentMethods).not.toHaveBeenCalled()
    await click(screen.getByRole("radio", { name: "Anticipado" }))
    const group = await screen.findByRole("radiogroup", { name: /^Canal de pago/ })
    await waitFor(() => expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Nequi", "Tarjeta"]))
  })

  it("sends the chosen method with the order and shows it on Confirmar", async () => {
    renderForm()
    await lookUp()
    await addLimonada()
    await click(formStep("Pago"))
    await click(screen.getByRole("radio", { name: "Anticipado" }))
    await click(await screen.findByRole("radio", { name: "Nequi" }))
    await click(formStep("Confirmar"))
    expect(screen.getByText("Anticipado · Nequi")).toBeInTheDocument()
    await click(screen.getByRole("button", { name: "Crear domicilio" }))
    await waitFor(() => expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1))
    expect(env.createDeliveryOrder.mock.calls[0]![0]).toEqual({
      customer: { id: "cust-1" },
      address: { id: "a-1" },
      items: [{ dishId: "d-3", quantity: 1 }],
      deliveryFee: 5000,
      paymentMode: "prepaid",
      cashChangeFor: null,
      notes: null,
      prepaidMethodId: "m-nequi",
    })
  })

  it("a prepaid order without a chosen method sends the old body (no prepaidMethodId)", async () => {
    renderForm()
    await lookUp()
    await addLimonada()
    await click(formStep("Pago"))
    await click(screen.getByRole("radio", { name: "Anticipado" }))
    expect(await submit()).toEqual({
      customer: { id: "cust-1" },
      address: { id: "a-1" },
      items: [{ dishId: "d-3", quantity: 1 }],
      deliveryFee: 5000,
      paymentMode: "prepaid",
      cashChangeFor: null,
      notes: null,
    })
  })
})

describe("DeliveryOrderForm — fee edit (T25, preserved)", () => {
  it("the operator edits the fee of this delivery; the summary and the body follow", async () => {
    renderForm()
    await lookUp()
    await addLimonada()
    await click(formStep("Pago"))
    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "7.500" } })
    expect(screen.getByRole("complementary", { name: "Resumen del pedido" })).toHaveTextContent(/Domicilio\s*\$\s*7\.500/)
    expect((await submit()).deliveryFee).toBe(7500)
  })
})
