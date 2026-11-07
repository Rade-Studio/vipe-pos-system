import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F5a web (S4, S6) — Ajustes → Estación de impresión
 * (design/estacion-impresion-web/01-pagina-secciones.html): pairing code with
 * countdown and expiry, new-device detection, connected computers (rename,
 * revoke), update channel, empty and printing-off states.
 */

const desktopApi = vi.hoisted(() => ({
  createDesktopPairingCode: vi.fn(),
  listDesktopDevices: vi.fn(),
  renameDesktopDevice: vi.fn(),
  revokeDesktopDevice: vi.fn(),
}))
vi.mock("@/lib/api/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/desktop")>()),
  ...desktopApi,
}))
const stationsApi = vi.hoisted(() => ({ listStations: vi.fn() }))
vi.mock("@/lib/api/stations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/stations")>()),
  ...stationsApi,
}))
const configApi = vi.hoisted(() => ({ fetchConfig: vi.fn(), saveConfig: vi.fn() }))
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  ...configApi,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { PrintStationPage } from "./PrintStationPage"

const printer = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, model: "Epson TM-T20III", connection: "usb", paperMm: 80, hasDrawer: false, stationIds: [], status: "ready", ...extra,
})
const device = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, platform: "windows", appVersion: "1.8.3", createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  lastSeenAt: new Date(Date.now() - 12_000).toISOString(), online: true, revokedAt: null, queue: { pending: 0, failed: 0 }, printers: [], ...extra,
})
const caja = device("d1", "Caja principal", {
  printers: [printer("p1", { hasDrawer: true, stationIds: ["c"] }), printer("p2", { model: "Xprinter XP-80", connection: "network", stationIds: ["b"] })],
})
const cocina = device("d2", "PC Cocina", {
  online: false, lastSeenAt: new Date(Date.now() - 6 * 60_000).toISOString(), queue: { pending: 3, failed: 1 },
  printers: [printer("p3", { model: "Xprinter XP-58IIH", connection: "bluetooth", paperMm: 58, stationIds: ["k", "p"] })],
})
const revoked = device("d3", "PC Viejo", { online: false, revokedAt: new Date(Date.now() - 3_600_000).toISOString() })
const stations = [
  { id: "k", name: "Cocina", kind: "prep", color: "kitchen" }, { id: "p", name: "Postres", kind: "prep", color: "occupied" },
  { id: "b", name: "Barra", kind: "prep", color: "served" }, { id: "c", name: "Caja", kind: "cashier", color: "reserved" },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PrintStationPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  desktopApi.listDesktopDevices.mockResolvedValue([caja, cocina, revoked])
  stationsApi.listStations.mockResolvedValue(stations)
  configApi.fetchConfig.mockResolvedValue({ printingEnabled: true, desktopUpdateChannel: "stable" })
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => vi.useRealTimers())

describe("PrintStationPage", () => {
  it("lists the connected computers with printers, stations, queue and offline warning; revoked hidden", async () => {
    renderPage()
    const list = await screen.findByRole("table", { name: /Computadores conectados/ })
    expect(within(list).queryByText("PC Viejo")).toBeNull()
    expect(screen.getByText("· 2")).toBeTruthy()
    const row1 = within(list).getByText("Caja principal").closest("[role=row]") as HTMLElement
    expect(within(row1).getByText("Windows · VIPE 1.8.3")).toBeTruthy()
    expect(within(row1).getByText("En línea")).toBeTruthy()
    expect(within(row1).getByText("USB · 80 mm")).toBeTruthy()
    expect(within(row1).getByText("Red · 80 mm")).toBeTruthy()
    expect(within(row1).getByText("Cajón")).toBeTruthy()
    expect(within(row1).getByText("Barra")).toBeTruthy()
    expect(within(row1).getByText("Cola al día")).toBeTruthy()
    const row2 = within(list).getByText("PC Cocina").closest("[role=row]") as HTMLElement
    expect(within(row2).getByText("Sin señal hace 6 min")).toBeTruthy()
    expect(within(row2).getByText("Bluetooth · 58 mm")).toBeTruthy()
    expect(within(row2).getByText("3 en cola")).toBeTruthy()
    expect(within(row2).getByText("1 fallida")).toBeTruthy()
    expect(
      within(row2).getByText("Si este computador está apagado o sin internet, las comandas de Cocina y Postres esperan en su cola hasta que vuelva."),
    ).toBeTruthy()
  })

  it("generates a code: 6 digits in two groups, live countdown, copy and cancel", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    desktopApi.createDesktopPairingCode.mockResolvedValue({ code: "481207", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Generar código" }))
    const code = await screen.findByLabelText("Código 4 8 1 2 0 7")
    expect(within(code).getByText("481")).toBeTruthy()
    expect(within(code).getByText("207")).toBeTruthy()
    expect(screen.getByRole("timer").textContent).toContain("10:00")
    await act(async () => vi.advanceTimersByTime(18_000))
    expect(screen.getByRole("timer").textContent).toContain("9:42")
    expect(screen.getByText(/Conectar con código/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("481207")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar código" }))
    expect(screen.queryByLabelText("Código 4 8 1 2 0 7")).toBeNull()
    expect(screen.getByRole("button", { name: "Generar código" })).toBeTruthy()
  })

  it("shows the expiry state with Generar otro", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    desktopApi.createDesktopPairingCode.mockResolvedValue({ code: "481207", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Generar código" }))
    await screen.findByLabelText("Código 4 8 1 2 0 7")
    await act(async () => vi.advanceTimersByTime(10 * 60_000 + 1_000))
    expect(screen.getByText("El código venció.")).toBeTruthy()
    expect(screen.getByLabelText("Código vencido 4 8 1 2 0 7")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Generar otro" }))
    await waitFor(() => expect(desktopApi.createDesktopPairingCode).toHaveBeenCalledTimes(2))
  })

  it("polls every 3 s while a code shows and announces the new computer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    desktopApi.createDesktopPairingCode.mockResolvedValue({ code: "481207", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Generar código" }))
    await screen.findByLabelText("Código 4 8 1 2 0 7")
    const calls = desktopApi.listDesktopDevices.mock.calls.length
    desktopApi.listDesktopDevices.mockResolvedValue([device("d4", "Caja 2"), caja, cocina, revoked])
    await act(async () => vi.advanceTimersByTime(3_100))
    await waitFor(() => expect(screen.getByText("Caja 2 se conectó.")).toBeTruthy())
    expect(desktopApi.listDesktopDevices.mock.calls.length).toBeGreaterThan(calls)
    expect(screen.queryByLabelText("Código 4 8 1 2 0 7")).toBeNull()
  })

  it("renames a computer through PATCH", async () => {
    desktopApi.renameDesktopDevice.mockResolvedValue({ ...cocina, name: "Cocina caliente" })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar nombre de PC Cocina" }))
    const input = screen.getByLabelText("Nombre")
    fireEvent.change(input, { target: { value: "  Cocina caliente " } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(desktopApi.renameDesktopDevice).toHaveBeenCalledWith("d2", "Cocina caliente"))
  })

  it("asks a destructive confirmation before revoking", async () => {
    desktopApi.revokeDesktopDevice.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Desvincular PC Cocina" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("¿Desvincular PC Cocina?")).toBeTruthy()
    expect(within(dialog).getByText(/El computador deja de imprimir de inmediato y debe conectarse de nuevo con un código nuevo/)).toBeTruthy()
    expect(desktopApi.revokeDesktopDevice).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desvincular" }))
    await waitFor(() => expect(desktopApi.revokeDesktopDevice).toHaveBeenCalledWith("d2"))
  })

  it("saves the update channel through the config", async () => {
    configApi.saveConfig.mockResolvedValue({ printingEnabled: true, desktopUpdateChannel: "pilot" })
    renderPage()
    const stable = await screen.findByRole("radio", { name: /Estable/ })
    await waitFor(() => expect(stable.getAttribute("aria-checked")).toBe("true"))
    expect(within(stable).getByText("Recomendado")).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: /Piloto/ }))
    await waitFor(() => expect(configApi.saveConfig).toHaveBeenCalledWith({ desktopUpdateChannel: "pilot" }))
    await waitFor(() => expect(screen.getByRole("radio", { name: /Piloto/ }).getAttribute("aria-checked")).toBe("true"))
  })

  it("shows the empty state when no live computer is paired", async () => {
    desktopApi.listDesktopDevices.mockResolvedValue([revoked])
    renderPage()
    expect(await screen.findByText("Aún no hay computadores conectados")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button", { name: "Generar código" })).toBeTruthy()
  })

  it("explains printing off and links to Estaciones y rutas", async () => {
    configApi.fetchConfig.mockResolvedValue({ printingEnabled: false, desktopUpdateChannel: "stable" })
    renderPage()
    expect(await screen.findByText("La impresión está apagada")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a Estaciones y rutas" }).getAttribute("href")).toBe("#settings/stations")
    expect(screen.queryByRole("button", { name: "Generar código" })).toBeNull()
  })

  it("gives every interactive control a 44 px target", async () => {
    desktopApi.createDesktopPairingCode.mockResolvedValue({ code: "481207", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    renderPage()
    await screen.findByRole("table")
    fireEvent.click(screen.getByRole("button", { name: "Generar código" }))
    await screen.findByLabelText("Código 4 8 1 2 0 7")
    const controls = [...document.querySelectorAll("button, a, [role=radio]")]
    expect(controls.length).toBeGreaterThan(5)
    for (const el of controls) expect(el.className, el.textContent ?? "").toMatch(/min-h-11|h-11/)
  })
})
