import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** caja-cierres S5: "Hora de corte del día de negocio" in Negocio settings. */

const toastMock = vi.hoisted(() => vi.fn())
const config = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn() }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchConfig: config.fetch,
  saveConfig: config.save,
}))

import { useConfigStore } from "@/store/use-config-store"
import { BusinessSettings } from "./BusinessSettings"

const saveConfigToDB = vi.fn(async () => {})

beforeEach(() => {
  toastMock.mockClear()
  saveConfigToDB.mockClear()
  config.fetch.mockReset().mockResolvedValue({ businessDayCutoffHour: 3 })
  config.save.mockReset().mockResolvedValue({ businessDayCutoffHour: 2 })
  useConfigStore.setState({
    businessName: "Demo",
    businessAddress: "Calle 1",
    businessPhone: "123",
    businessNIT: "900",
    isLoading: false,
    error: null,
    saveConfigToDB,
    loadConfigFromDB: vi.fn(async () => {}),
  })
})

describe("BusinessSettings · hora de corte", () => {
  it("shows the saved cut-off with its explanation and hours 0 to 6", async () => {
    render(<BusinessSettings />)
    const field = screen.getByLabelText("Hora de corte del día de negocio") as HTMLSelectElement
    await waitFor(() => expect(field.value).toBe("3"))
    expect(Array.from(field.options).map((o) => o.value)).toEqual(["0", "1", "2", "3", "4", "5", "6"])
    expect(screen.getByText(/pertenecen al día anterior/)).toBeInTheDocument()
  })

  it("saves only the cut-off through PUT /config when it is the only change", async () => {
    render(<BusinessSettings />)
    const field = screen.getByLabelText("Hora de corte del día de negocio") as HTMLSelectElement
    await waitFor(() => expect(field.value).toBe("3"))
    fireEvent.change(field, { target: { value: "2" } })
    expect(screen.getByRole("region", { name: "Cambios sin guardar" })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Guardar/ }))
    })
    expect(config.save).toHaveBeenCalledWith({ businessDayCutoffHour: 2 })
    expect(saveConfigToDB).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cambios sin guardar" })).not.toBeInTheDocument())
  })

  it("defaults to 4 a.m. while the config has no value", async () => {
    config.fetch.mockRejectedValue(new Error("offline"))
    render(<BusinessSettings />)
    expect((screen.getByLabelText("Hora de corte del día de negocio") as HTMLSelectElement).value).toBe("4")
  })

  it("keeps saving the business data through the store", async () => {
    render(<BusinessSettings />)
    fireEvent.change(screen.getByLabelText("Nombre del negocio"), { target: { value: "La Fonda" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Guardar/ }))
    })
    expect(saveConfigToDB).toHaveBeenCalled()
    expect(config.save).not.toHaveBeenCalled()
  })
})

describe("BusinessSettings · validation (H-035)", () => {
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Guardar/ }))
    })
  }

  it("requires the business name and saves nothing while it is blank", async () => {
    render(<BusinessSettings />)
    const name = screen.getByLabelText("Nombre del negocio")
    fireEvent.change(name, { target: { value: "   " } })
    await save()
    expect(saveConfigToDB).not.toHaveBeenCalled()
    expect(useConfigStore.getState().businessName).toBe("Demo")
    expect(name).toHaveAttribute("aria-invalid", "true")
    expect(document.getElementById(name.getAttribute("aria-describedby")!)).toHaveTextContent(
      "El nombre del negocio es obligatorio",
    )
  })

  it("refuses a new phone that is not a Colombian mobile or landline", async () => {
    render(<BusinessSettings />)
    const phone = screen.getByLabelText("Teléfono")
    fireEvent.change(phone, { target: { value: "abc" } })
    await save()
    expect(saveConfigToDB).not.toHaveBeenCalled()
    expect(useConfigStore.getState().businessPhone).toBe("123")
    expect(document.getElementById(phone.getAttribute("aria-describedby")!)).toHaveTextContent(
      "Ingresa un celular de 10 dígitos que empiece por 3 o un fijo de 10 dígitos que empiece por 60",
    )
  })

  it("accepts a landline as typed and keeps an unchanged older phone", async () => {
    render(<BusinessSettings />)
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "(601) 234 5678" } })
    await save()
    expect(useConfigStore.getState().businessPhone).toBe("(601) 234 5678")
    expect(saveConfigToDB).toHaveBeenCalledTimes(1)
  })
})
