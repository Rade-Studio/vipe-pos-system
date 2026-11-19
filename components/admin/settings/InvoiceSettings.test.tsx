import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): Ajustes › Impuestos y
 * propinas configures the invoice prefix and the DIAN data (resolution,
 * authorized range, validity, tax regime) that the invoice prints.
 */

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))
const config = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn() }))
vi.mock("@/lib/api/config", () => ({ fetchConfig: config.fetch, saveConfig: config.save }))

import { useConfigStore } from "@/store/use-config-store"
import { TaxSettings } from "./TaxSettings"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const STORED = {
  taxType: "INC",
  invoicePrefix: "POS",
  invoiceResolution: null,
  invoiceRangeFrom: 1,
  invoiceRangeTo: null,
  invoiceValidFrom: null,
  invoiceValidTo: null,
  taxRegime: null,
}

beforeEach(() => {
  toastMock.mockClear()
  config.fetch.mockReset().mockResolvedValue(STORED)
  config.save.mockReset().mockImplementation(async (body: object) => ({ ...STORED, ...body }))
  useConfigStore.setState({
    tipPercentage: 10,
    taxPercentage: 8,
    priceSuggestion: 300,
    isLoading: false,
    error: null,
    saveConfigToDB: vi.fn(async () => {}),
    loadConfigFromDB: vi.fn(async () => {}),
  })
})

const saveBar = () => screen.queryByRole("region", { name: "Cambios sin guardar" })
const change = (label: string, value: string) =>
  act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  })
const clickSave = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
  })

async function renderPage() {
  render(<TaxSettings />)
  await waitFor(() => expect(config.fetch).toHaveBeenCalled())
  await screen.findByDisplayValue("POS")
}

describe("Facturación (DIAN) settings", () => {
  it("shows the stored prefix and empty DIAN fields, with no printed DIAN lines", async () => {
    await renderPage()
    expect(screen.getByLabelText("Prefijo")).toHaveValue("POS")
    expect(screen.getByLabelText("Resolución DIAN")).toHaveValue("")
    expect(screen.getByLabelText("Régimen tributario")).toHaveValue("")
    expect(screen.getByTestId("invoice-preview")).toHaveTextContent("POS-000123")
    expect(screen.getByTestId("invoice-preview")).not.toHaveTextContent("DIAN")
    expect(saveBar()).not.toBeInTheDocument()
  })

  it("saves only the invoice keys that changed and previews the printed lines", async () => {
    await renderPage()
    await change("Prefijo", "fe")
    await change("Resolución DIAN", "18764000001234")
    await change("Número inicial", "1000")
    await change("Número final", "2000")
    await change("Vigente desde", "2026-01-01")
    await change("Vigente hasta", "2027-12-31")
    await change("Régimen tributario", "responsable_iva")

    const preview = screen.getByTestId("invoice-preview")
    expect(preview).toHaveTextContent("FE-001000")
    expect(preview).toHaveTextContent("RESPONSABLE DE IVA")
    expect(preview).toHaveTextContent("RES. DIAN No. 18764000001234")
    expect(preview).toHaveTextContent("DEL 01/01/2026 AL 31/12/2027")
    expect(preview).toHaveTextContent("NUMERACIÓN FE-1000 AL FE-2000")

    await clickSave()
    expect(config.save).toHaveBeenCalledTimes(1)
    expect(config.save).toHaveBeenCalledWith({
      invoicePrefix: "FE",
      invoiceResolution: "18764000001234",
      invoiceRangeFrom: 1000,
      invoiceRangeTo: 2000,
      invoiceValidFrom: "2026-01-01",
      invoiceValidTo: "2027-12-31",
      taxRegime: "responsable_iva",
    })
    await waitFor(() => expect(saveBar()).not.toBeInTheDocument())
  })

  it("sends null to clear a value", async () => {
    config.fetch.mockResolvedValue({ ...STORED, invoiceResolution: "123", taxRegime: "regimen_simple" })
    await renderPage()
    await change("Resolución DIAN", "")
    await change("Régimen tributario", "")
    await clickSave()
    expect(config.save).toHaveBeenCalledWith({ invoiceResolution: null, taxRegime: null })
  })

  it.each([
    ["Prefijo", "PO S", "El prefijo lleva de 1 a 10 letras o números, sin espacios ni guiones"],
    ["Número final", "0", "El número final del rango autorizado debe ser mayor o igual al inicial"],
    ["Resolución DIAN", "1876\u001b@40", "La resolución solo lleva letras, números, espacios y los signos - . /"],
  ])("refuses %s = %j before saving, with a message", async (label, value, message) => {
    await renderPage()
    await change(label, value)
    expect(screen.getByText(message)).toBeInTheDocument()
    await clickSave()
    expect(config.save).not.toHaveBeenCalled()
    expect(saveBar()).toBeInTheDocument()
  })

  it("refuses a validity that ends before it starts", async () => {
    await renderPage()
    await change("Vigente desde", "2026-06-01")
    await change("Vigente hasta", "2026-05-31")
    expect(screen.getByText("La fecha final de la vigencia debe ser igual o posterior a la inicial")).toBeInTheDocument()
    await clickSave()
    expect(config.save).not.toHaveBeenCalled()
  })

  it("warns when the stored resolution has expired", async () => {
    config.fetch.mockResolvedValue({ ...STORED, invoiceValidTo: "2020-12-31" })
    await renderPage()
    expect(screen.getByRole("status")).toHaveTextContent(
      "La resolución DIAN venció el 31/12/2020. Los cobros siguen funcionando, pero actualiza la resolución.",
    )
  })

  it("shows the server's refusal and keeps the changes", async () => {
    config.save.mockRejectedValue(new Error("El número final del rango autorizado debe ser mayor o igual al inicial"))
    await renderPage()
    await change("Número final", "5000")
    await clickSave()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "El número final del rango autorizado debe ser mayor o igual al inicial" }),
    )
    expect(saveBar()).toBeInTheDocument()
  })

  it("keeps saving the tax type alone as before (PRESERVE)", async () => {
    await renderPage()
    await change("Tipo de impuesto", "IVA")
    await clickSave()
    expect(config.save).toHaveBeenCalledTimes(1)
    expect(config.save).toHaveBeenCalledWith({ taxType: "IVA" })
  })
})
