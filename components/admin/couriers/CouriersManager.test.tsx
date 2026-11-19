import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** H-038: courier phones follow the Colombian rule for new input, and an active duplicate is refused. */

const env = vi.hoisted(() => ({
  listCouriers: vi.fn(),
  createCourier: vi.fn(),
  updateCourier: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/api/delivery", () => ({
  listCouriers: env.listCouriers,
  createCourier: env.createCourier,
  updateCourier: env.updateCourier,
}))
vi.mock("@/utils/toast", () => ({ toast: env.toast }))

import { CouriersManager } from "@/components/admin/couriers/CouriersManager"

const PHONE_ERROR =
  "Ingresa un celular de 10 dígitos que empiece por 3 o un fijo de 10 dígitos que empiece por 60 (por ejemplo 3101234567 o 6011234567)"

const couriers = [
  { id: "k-1", name: "Pedro", phone: "3101234567", isActive: true, createdAt: "", updatedAt: "" },
  { id: "k-2", name: "Viejo", phone: "1234567", isActive: true, createdAt: "", updatedAt: "" },
]

beforeEach(() => {
  vi.clearAllMocks()
  env.listCouriers.mockResolvedValue(couriers)
  env.createCourier.mockResolvedValue(couriers[0])
  env.updateCourier.mockResolvedValue(couriers[1])
})

function renderManager() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CouriersManager />
    </QueryClientProvider>,
  )
}

async function openCreate(name: string, phone: string) {
  renderManager()
  await screen.findByText("Pedro")
  fireEvent.click(screen.getByRole("button", { name: /Nuevo repartidor/ }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: name } })
  fireEvent.change(within(dialog).getByLabelText("Teléfono (opcional)"), { target: { value: phone } })
  return dialog
}

const save = async (dialog: HTMLElement) => {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: /^(Crear|Guardar)/ }))
  })
}

describe("CouriersManager — phone rules (H-038)", () => {
  it("refuses a phone that is not Colombian and creates nothing", async () => {
    const dialog = await openCreate("Rosa", "1234567")
    await save(dialog)
    expect(within(dialog).getByText(PHONE_ERROR)).toBeInTheDocument()
    expect(env.createCourier).not.toHaveBeenCalled()
  })

  it("refuses the phone of another active courier and creates nothing", async () => {
    const dialog = await openCreate("Rosa", "+57 310 123 4567")
    await save(dialog)
    expect(within(dialog).getByText("Pedro ya usa este teléfono. Usa otro número.")).toBeInTheDocument()
    expect(env.createCourier).not.toHaveBeenCalled()
  })

  it("creates a courier with a Colombian landline", async () => {
    const dialog = await openCreate("Rosa", "601 123 4567")
    await save(dialog)
    expect(env.createCourier).toHaveBeenCalledWith({ name: "Rosa", phone: "601 123 4567" })
  })

  it("renames a courier whose stored phone predates the rule without sending the phone", async () => {
    renderManager()
    await screen.findByText("Viejo")
    const row = screen.getByText("Viejo").closest("tr")!
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Viejo Lopez" } })
    await save(dialog)
    expect(env.updateCourier).toHaveBeenCalledWith("k-2", { name: "Viejo Lopez" })
  })
})
