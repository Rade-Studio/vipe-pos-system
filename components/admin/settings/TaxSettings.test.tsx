import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock("@/lib/supabase/business-config-service", () => ({ default: {} }))

import { useConfigStore } from "@/store/use-config-store"
import { BusinessSettings } from "./BusinessSettings"
import { InventorySettings } from "./InventorySettings"
import { TaxSettings } from "./TaxSettings"

// Radix Slider measures itself; jsdom does not.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const saveConfigToDB = vi.fn(async () => {})
const loadConfigFromDB = vi.fn(async () => {})

beforeEach(() => {
  toastMock.mockClear()
  saveConfigToDB.mockReset().mockResolvedValue(undefined)
  loadConfigFromDB.mockClear()
  useConfigStore.setState({
    tipPercentage: 10,
    taxPercentage: 8,
    priceSuggestion: 300,
    inventoryControlEnabled: false,
    businessName: "Demo",
    businessAddress: "Calle 1",
    businessPhone: "123",
    businessNIT: "900",
    isLoading: false,
    error: null,
    saveConfigToDB,
    loadConfigFromDB,
  })
})

const saveBar = () => screen.queryByRole("region", { name: "Cambios sin guardar" })

describe("settings SaveBar", () => {
  it("is hidden while the page is clean and appears once a value changes", async () => {
    render(<TaxSettings />)
    expect(saveBar()).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Impuesto"), { target: { value: "19" } })
    })

    expect(saveBar()).toBeInTheDocument()
    expect(screen.getByTestId("tax-example")).toHaveTextContent("Impuesto (19%)")
  })

  it("Discard restores the saved values and hides the bar", async () => {
    render(<BusinessSettings />)
    const name = screen.getByLabelText("Nombre del negocio")

    await act(async () => {
      fireEvent.change(name, { target: { value: "La Fonda" } })
    })
    expect(screen.getByLabelText("Vista previa del encabezado de la factura")).toHaveTextContent("LA FONDA")
    expect(saveBar()).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    })

    expect(name).toHaveValue("Demo")
    expect(saveBar()).not.toBeInTheDocument()
    expect(saveConfigToDB).not.toHaveBeenCalled()
    expect(useConfigStore.getState().businessName).toBe("Demo")
  })

  it("Save writes the changed value, persists, toasts and hides the bar", async () => {
    render(<InventorySettings />)

    await act(async () => {
      fireEvent.click(screen.getByRole("switch"))
    })
    expect(saveBar()).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })

    expect(useConfigStore.getState().inventoryControlEnabled).toBe(true)
    expect(saveConfigToDB).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Configuración guardada" }))
    expect(saveBar()).not.toBeInTheDocument()
  })

  it("reports a failed save and keeps the changes on screen", async () => {
    saveConfigToDB.mockImplementation(async () => {
      useConfigStore.setState({ error: "boom" })
    })
    render(<TaxSettings />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Propina sugerida"), { target: { value: "15" } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Error", variant: "destructive" }))
    expect(useConfigStore.getState().tipPercentage).toBe(10)
    expect(screen.getByLabelText("Propina sugerida")).toHaveValue(15)
    expect(saveBar()).toBeInTheDocument()
  })
})
