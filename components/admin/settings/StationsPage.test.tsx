import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F6 (S1 c, S2) — Ajustes → Estaciones y rutas (design/admin-stations/02):
 * station strip, category routes with dish exceptions, the "sin estación"
 * banner, the split preview, the empty state, delete with move-to and the
 * printing switch.
 */

const stationsApi = vi.hoisted(() => ({
  listStations: vi.fn(),
  fetchStationRoutes: vi.fn(),
  createStation: vi.fn(),
  createStarterStations: vi.fn(),
  updateStation: vi.fn(),
  deleteStation: vi.fn(),
  setCategoryStation: vi.fn(),
  setDishStation: vi.fn(),
}))
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

import { ApiError } from "@/lib/api/errors"
import { StationsPage } from "./StationsPage"

const st = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, kind: "prep", color: "kitchen", sortOrder: 0, isDefault: false,
  createdAt: "2026-11-07T11:00:00.000Z", updatedAt: "2026-11-07T11:00:00.000Z", ...extra,
})
const stations = [st("k", "Cocina", { isDefault: true }), st("b", "Barra", { color: "served", sortOrder: 1 }), st("c", "Caja", { kind: "cashier", color: "occupied", sortOrder: 2 })]
const routes = {
  categories: [
    { id: "pf", name: "Platos fuertes", stationId: "k", dishCount: 1 },
    { id: "be", name: "Bebidas", stationId: "b", dishCount: 2 },
    { id: "es", name: "Especiales del día", stationId: null, dishCount: 2 },
  ],
  dishes: [
    { id: "d1", name: "Bandeja paisa", categoryId: "pf", active: true, stationId: null, routedStationId: "k", source: "category" },
    { id: "d3", name: "Jugo de lulo", categoryId: "be", active: true, stationId: null, routedStationId: "b", source: "category" },
    { id: "d4", name: "Limonada de coco", categoryId: "be", active: true, stationId: "k", routedStationId: "k", source: "dish" },
    { id: "d5", name: "Cazuela de mariscos", categoryId: "es", active: true, stationId: null, routedStationId: "k", source: "fallback" },
    { id: "d6", name: "Lechona tolimense", categoryId: "es", active: true, stationId: null, routedStationId: "k", source: "fallback" },
  ],
  unroutedDishes: [
    { id: "d5", name: "Cazuela de mariscos", categoryId: "es", categoryName: "Especiales del día" },
    { id: "d6", name: "Lechona tolimense", categoryId: "es", categoryName: "Especiales del día" },
  ],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StationsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(stationsApi)) fn.mockReset().mockResolvedValue(undefined)
  stationsApi.listStations.mockResolvedValue(stations)
  stationsApi.fetchStationRoutes.mockResolvedValue(routes)
  configApi.fetchConfig.mockReset().mockResolvedValue({ printingEnabled: true })
  configApi.saveConfig.mockReset().mockImplementation(async (changes: object) => changes)
  toastMock.mockClear()
})

describe("StationsPage", () => {
  it("shows the stations, their dishes and the unrouted banner", async () => {
    renderPage()
    const strip = await screen.findByRole("list", { name: "Estaciones" })
    expect(within(strip).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent)).toEqual(["Cocina", "Barra", "Caja"])
    expect(within(strip).getByText("4 platos")).toBeInTheDocument()
    expect(within(strip).getByText("1 plato")).toBeInTheDocument()
    expect(within(strip).getByText("Facturas y precuentas")).toBeInTheDocument()
    expect(within(strip).getAllByText("Sin impresora · solo pantalla")).toHaveLength(3)
    expect(within(strip).queryByRole("button", { name: "Eliminar Caja" })).not.toBeInTheDocument()
    const banner = screen.getByRole("status")
    expect(banner).toHaveTextContent(
      "Especiales del día no tiene estación. Sus 2 platos (Cazuela de mariscos y Lechona tolimense) salen en la comanda de Cocina hasta que la asignes.",
    )
    expect(screen.getByLabelText("Estación de Especiales del día")).toHaveValue("")
    fireEvent.click(within(banner).getByRole("button", { name: "Asignar estación" }))
    expect(screen.getByLabelText("Estación de Especiales del día")).toHaveFocus()
  })

  it("routes a category and sets or clears a dish exception", async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText("Estación de Especiales del día"), { target: { value: "k" } })
    await waitFor(() => expect(stationsApi.setCategoryStation).toHaveBeenCalledWith("es", "k"))
    fireEvent.click(screen.getByRole("button", { name: "Ver platos de Bebidas" }))
    const dishes = screen.getByRole("list", { name: "Platos de Bebidas" })
    expect(within(dishes).getByText("Excepción")).toBeInTheDocument()
    expect(within(dishes).getByText("Igual que la categoría")).toBeInTheDocument()
    fireEvent.change(within(dishes).getByLabelText("Estación de Jugo de lulo"), { target: { value: "k" } })
    await waitFor(() => expect(stationsApi.setDishStation).toHaveBeenCalledWith("d3", "k"))
    fireEvent.change(within(dishes).getByLabelText("Estación de Limonada de coco"), { target: { value: "b" } })
    await waitFor(() => expect(stationsApi.setDishStation).toHaveBeenLastCalledWith("d4", null))
    expect(within(dishes).getByLabelText("Estación de Jugo de lulo").querySelectorAll("option")).toHaveLength(2)
  })

  it("previews the split with the restaurant's own dishes", async () => {
    renderPage()
    const preview = await screen.findByRole("region", { name: "Así se parte una comanda" })
    expect(within(preview).getByRole("group", { name: "Comanda de Barra" })).toHaveTextContent("1× Jugo de lulo")
    expect(within(preview).getByRole("group", { name: "Comanda de Cocina" })).toHaveTextContent("1× Limonada de coco")
    expect(preview).toHaveTextContent("Limonada de coco es de Bebidas, pero se prepara en Cocina (excepción).")
  })

  it("filters categories and dishes with the search", async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText("Buscar plato o categoría"), { target: { value: "lulo" } })
    expect(screen.queryByLabelText("Estación de Platos fuertes")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Estación de Jugo de lulo")).toBeInTheDocument()
  })

  it("offers the starter set when there are no stations", async () => {
    stationsApi.listStations.mockResolvedValue([])
    stationsApi.createStarterStations.mockResolvedValue(stations)
    renderPage()
    expect(await screen.findByRole("heading", { name: "Todavía no hay estaciones" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Nueva estación" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Crear Cocina, Barra y Caja" }))
    await waitFor(() => expect(stationsApi.createStarterStations).toHaveBeenCalledTimes(1))
  })

  it("deletes a station by moving its routes to the chosen one", async () => {
    stationsApi.listStations.mockResolvedValue([...stations.slice(0, 2), st("p", "Postres", { color: "free", sortOrder: 2 }), stations[2]])
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar Barra" }))
    const dialog = screen.getByRole("dialog", { name: "¿Eliminar la estación Barra?" })
    expect(dialog).toHaveTextContent("Barra recibe Bebidas (1 plato).")
    expect(within(dialog).getByRole("radio", { name: /Cocina/ })).toHaveAttribute("aria-checked", "true")
    fireEvent.click(within(dialog).getByRole("radio", { name: /Postres/ }))
    stationsApi.deleteStation.mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", "Elige otra estación de preparación del restaurante", { code: "target_invalid" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Mover a Postres y eliminar" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Elige otra estación de preparación del restaurante")
    fireEvent.click(within(dialog).getByRole("button", { name: "Mover a Postres y eliminar" }))
    await waitFor(() => expect(stationsApi.deleteStation).toHaveBeenLastCalledWith("b", "p"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("creates a station and shows the API refusal in the dialog", async () => {
    stationsApi.createStation.mockRejectedValueOnce(new ApiError(409, "Conflict", "Ya existe una estación con ese nombre", { code: "station_name_taken" }))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Nueva estación" }))
    const dialog = screen.getByRole("dialog", { name: "Nueva estación" })
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Barra" } })
    fireEvent.click(within(dialog).getByRole("radio", { name: "Verde" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ya existe una estación con ese nombre")
    expect(stationsApi.createStation).toHaveBeenCalledWith({ name: "Barra", color: "free" })
  })

  it("turns printing off for the restaurant", async () => {
    renderPage()
    const toggle = await screen.findByRole("switch", { name: "Este restaurante usa impresoras térmicas" })
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
    fireEvent.click(toggle)
    await waitFor(() => expect(configApi.saveConfig).toHaveBeenCalledWith({ printingEnabled: false }))
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))
  })
})
