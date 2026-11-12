import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * promociones T5 (S9) — the Promociones list of the 02 artboard: kind icon,
 * name, the server sentence, pills, uses and discount of the last 30 days, the
 * state pill from `schedule`, tabs with counts, the header cards and the
 * loading, empty and error states.
 */

const catalog = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  fetchPromotions: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalog)
const subApi = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock("@/lib/api/subcategories", () => subApi)
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { PromotionList } from "./PromotionList"
import { ALL_PROMOTIONS, CATEGORIES, CERVEZA, DISHES, NOW, SUBCATEGORIES } from "./promotion-fixtures"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PromotionList />
    </QueryClientProvider>,
  )
}

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name.replace(/[$()]/g, "\\$&")}`) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  for (const fn of [...Object.values(catalog), subApi.getAll, toastMock]) fn.mockReset()
  catalog.fetchPromotions.mockResolvedValue(ALL_PROMOTIONS)
  catalog.fetchCategories.mockResolvedValue(CATEGORIES)
  catalog.fetchDishes.mockResolvedValue(DISHES)
  subApi.getAll.mockResolvedValue(SUBCATEGORIES)
})
afterEach(() => vi.useRealTimers())

describe("PromotionList (S9)", () => {
  it("shows each row with its icon, sentence, pills, uses and state", async () => {
    renderList()
    const happy = await screen.findByRole("button", { name: /^Happy hour 2x1 en cócteles/ })
    expect(within(happy).getByText("2×1")).toBeInTheDocument()
    expect(within(happy).getByText("Lleva 2 cócteles y paga 1; sale gratis el más económico.")).toBeInTheDocument()
    for (const pill of ["Lun–Vie", "17:00–19:00", "Salón"]) expect(within(happy).getByText(pill)).toBeInTheDocument()
    expect(within(happy).getByText("148 usos")).toBeInTheDocument()
    expect(within(happy).getByText("−$3.552.000 · 30 días")).toBeInTheDocument()
    expect(within(happy).getByText("Activa · 50 min")).toBeInTheDocument()

    const states: [string, string][] = [
      ["Menú ejecutivo $24.000", "Hoy 12:00–15:00"],
      ["10% en domicilios desde $80.000", "Activa"],
      ["Martes de hamburguesa 20%", "Martes"],
      ["Cortesía de cumpleaños", "Disponible"],
      ["Navidad: 15% en postres", "Empieza 1 dic"],
      ["Segunda cerveza al 50%", "Pausada"],
    ]
    for (const [name, state] of states) expect(within(row(name)).getByText(state, { selector: "[data-state-pill]" })).toBeInTheDocument()
    const birthday = row("Cortesía de cumpleaños")
    expect(within(birthday).getByText("PIN")).toBeInTheDocument()
    expect(within(birthday).getByText("Manual")).toBeInTheDocument()
    expect(within(row("Navidad: 15% en postres")).getByText("Aún sin usos")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Octubre 10%/ })).not.toBeInTheDocument()
  })

  it("counts every tab and filters by it", async () => {
    renderList()
    await screen.findByRole("button", { name: /^Happy hour/ })
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent)
    expect(tabs).toEqual(["Todas7", "Aplicando ahora2", "Programadas3", "Pausadas1", "Manuales1", "Terminadas1"])
    expect(screen.getByRole("tab", { name: /Todas/ })).toHaveAttribute("aria-selected", "true")

    fireEvent.click(screen.getByRole("tab", { name: /Terminadas/ }))
    expect(screen.getByRole("tab", { name: /Terminadas/ })).toHaveAttribute("aria-selected", "true")
    expect(within(row("Octubre 10%")).getByText("Terminada")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Happy hour/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole("tab", { name: /Terminadas/ }), { key: "ArrowLeft" })
    expect(screen.getByRole("tab", { name: /Manuales/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /Manuales/ })).toHaveFocus()
    expect(row("Cortesía de cumpleaños")).toBeInTheDocument()
  })

  it("sums the header cards from the API data", async () => {
    renderList()
    const now = await screen.findByRole("group", { name: "Aplicando ahora" })
    expect(within(now).getByText("2")).toBeInTheDocument()
    expect(within(now).getByText("Happy hour 2x1 en cócteles termina a las 19:00")).toBeInTheDocument()
    const granted = screen.getByRole("group", { name: "Descuento otorgado · 30 días" })
    expect(within(granted).getByText("$10.966.100")).toBeInTheDocument()
    expect(screen.queryByText(/Venta con promoción/)).not.toBeInTheDocument()
  })

  it("opens the editor for a row and for a new promotion", async () => {
    renderList()
    fireEvent.click(await screen.findByRole("button", { name: /^Segunda cerveza al 50%/ }))
    const editor = await screen.findByRole("dialog")
    expect(within(editor).getByLabelText(/^Nombre/)).toHaveValue("Segunda cerveza al 50%")
    // The list sits behind the modal panel, out of the accessibility tree while it is open.
    expect(screen.getByRole("button", { name: /^Segunda cerveza al 50%/, hidden: true })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(within(editor).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "+ Nueva promoción" }))
    expect(await screen.findByRole("button", { name: "Crear promoción" })).toBeInTheDocument()
  })

  it("reactivates from the editor and refreshes the list", async () => {
    catalog.updatePromotion.mockResolvedValue({ ...CERVEZA, active: true })
    renderList()
    fireEvent.click(await screen.findByRole("button", { name: /^Segunda cerveza al 50%/ }))
    const editor = await screen.findByRole("dialog")
    await act(async () => {
      fireEvent.click(within(editor).getByRole("button", { name: "Reactivar" }))
    })
    expect(catalog.updatePromotion).toHaveBeenCalledWith("p-cerveza", expect.objectContaining({ active: true }))
    await waitFor(() => expect(catalog.fetchPromotions).toHaveBeenCalledTimes(2))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Promoción reactivada" }))
  })

  it("shows loading, then the empty state with its action", async () => {
    let resolve: (value: unknown) => void = () => {}
    catalog.fetchPromotions.mockReturnValue(new Promise((r) => (resolve = r)))
    renderList()
    expect(screen.getByRole("status")).toHaveTextContent("Cargando promociones…")
    await act(async () => resolve([]))
    expect(await screen.findByText("Aún no hay promociones")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "+ Nueva promoción" }).length).toBeGreaterThan(0)
  })

  it("shows the error with a retry", async () => {
    catalog.fetchPromotions.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ALL_PROMOTIONS)
    renderList()
    expect(await screen.findByText("No se pudieron cargar las promociones")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByRole("button", { name: /^Happy hour/ })).toBeInTheDocument()
  })
})
