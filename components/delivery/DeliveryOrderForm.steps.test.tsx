import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * T12 (S2) — the new-delivery form is a step layout (Cliente → Dirección →
 * Productos → Pago → Confirmar) with a persistent summary. The draft and its
 * validation are the existing ones; only one step is on screen at a time.
 */

vi.mock("@/lib/api/catalog", () => ({
  fetchCategories: async () => [{ id: "cat-1", name: "Platos", icon: "Soup" }],
  fetchDishes: async () => [{ id: "d-1", name: "Bandeja", price: 12000, categoryId: "cat-1" }],
}))

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, findCustomerByPhone: vi.fn(async () => null), createDeliveryOrder: vi.fn() }
})

vi.mock("@/hooks/use-toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeliveryOrderForm suggestedFee={3000} taxPct={0} onSubmitted={vi.fn()} />
    </QueryClientProvider>,
  )
}

const currentStep = () =>
  within(screen.getByRole("navigation", { name: "Pasos del domicilio" }))
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "step")

describe("DeliveryOrderForm — step layout", () => {
  it("starts on Cliente and lists the five steps in order", () => {
    renderForm()
    const steps = within(screen.getByRole("navigation", { name: "Pasos del domicilio" })).getAllByRole("button")
    expect(steps.map((s) => s.textContent?.replace(/^\d/, ""))).toEqual([
      "Cliente",
      "Dirección",
      "Productos",
      "Pago",
      "Confirmar",
    ])
    expect(currentStep()).toHaveTextContent("Cliente")
    expect(screen.getByRole("heading", { name: "¿Quién pide?" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Crear domicilio" })).not.toBeInTheDocument()
  })

  it("moves with Continuar and Atrás, and only shows the current step", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(currentStep()).toHaveTextContent("Dirección")
    expect(screen.getByRole("heading", { name: "¿A dónde va?" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "¿Quién pide?" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Atrás" }))
    expect(currentStep()).toHaveTextContent("Cliente")
  })

  it("keeps the summary with the totals on every step", () => {
    renderForm()
    const summary = screen.getByRole("complementary", { name: "Resumen del pedido" })
    expect(summary).toHaveTextContent(/Domicilio\s*\$\s*3\.000/)
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(screen.getByRole("complementary", { name: "Resumen del pedido" })).toHaveTextContent(/Total\s*\$\s*3\.000/)
  })

  it("on Confirmar lists what is missing and jumps to the step that fixes it", async () => {
    renderForm()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }))
    })
    expect(screen.getByRole("button", { name: "Crear domicilio" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Agrega al menos un producto al pedido" }))
    expect(currentStep()).toHaveTextContent("Productos")
  })
  it("picks the payment mode on the Pago step; prepaid drops the change field", () => {
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: /Pago/ }))
    expect(screen.getByRole("radio", { name: "Contra entrega" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByLabelText("Lleva cambio de")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: "Anticipado" }))
    expect(screen.getByRole("radio", { name: "Anticipado" })).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByLabelText("Lleva cambio de")).not.toBeInTheDocument()
  })
})
