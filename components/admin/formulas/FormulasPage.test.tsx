import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T6 (S3, S4) — formula builder. Data hooks and the dish catalog are mocked;
 * the page, editor reducer and shared inputs run for real.
 */

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  createPrep: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}))

const item = (id: string, name: string, unit: string, cost: number, kind: "raw" | "prep" = "raw", stock = 1000) => ({
  id,
  sku: kind === "prep" ? `PR-${id}` : `MP-${id}`,
  name,
  description: null,
  kind,
  unit,
  barcode: null,
  cost,
  stock,
  minStock: 0,
  maxStock: null,
  purchaseUnit: null,
  purchaseFactor: 1,
  defaultSupplierId: null,
  trackLots: false,
  shelfLifeDays: null,
  isActive: true,
  categoryId: null,
  categoryName: null,
})

const ITEMS = [
  item("pan", "Pan brioche", "unidad", 800),
  item("carne", "Carne molida", "g", 20),
  item("tomate", "Tomate", "g", 4),
  item("base", "Salsa base", "ml", 0, "prep"),
  item("aderezo", "Aderezo", "ml", 0, "prep"),
]

const FORMULAS = {
  byDish: {
    burger: { recipeId: "r1", targetType: "dish", targetId: "burger", yieldQuantity: 1, notes: null, lines: [{ ingredientId: "pan", quantity: 1 }] },
  },
  byPrep: {
    base: { recipeId: "r2", targetType: "prep", targetId: "base", yieldQuantity: 1000, notes: null, lines: [{ ingredientId: "aderezo", quantity: 200 }] },
    aderezo: { recipeId: "r3", targetType: "prep", targetId: "aderezo", yieldQuantity: 500, notes: null, lines: [{ ingredientId: "tomate", quantity: 500 }] },
  },
}

vi.mock("@/hooks/inventory", () => ({
  useInventoryItems: () => ({ data: ITEMS, isLoading: false }),
  useFormulas: () => ({ data: FORMULAS, isLoading: false }),
  useSaveFormula: () => ({ mutateAsync: mocks.save, isPending: false }),
  useCreatePreparation: () => ({ mutateAsync: mocks.createPrep, isPending: false }),
}))

vi.mock("@/lib/admin/catalog", () => ({
  ADMIN_LIST_STALE_MS: 60_000,
  catalogKeys: { dishes: ["catalog", "menu", "dishes"] },
  fetchDishes: async () => [
    { id: "burger", name: "Hamburguesa", price: 20000 },
    { id: "fries", name: "Papas", price: 8000 },
  ],
}))

vi.mock("@/store/use-config-store", () => ({
  useConfigStore: (selector: (s: { priceSuggestion: number }) => unknown) => selector({ priceSuggestion: 300 }),
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}

import { FormulasPage } from "./FormulasPage"

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FormulasPage description="Fórmulas de platos" onNavigate={mocks.navigate} />
    </QueryClientProvider>,
  )

const openDish = async (name = "Hamburguesa") => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }))
  await screen.findByRole("heading", { name })
}

const search = () => screen.getByRole("combobox", { name: "Agregar ingrediente" })

const typeAndEnter = async (text: string) => {
  const input = search()
  input.focus()
  fireEvent.change(input, { target: { value: text } })
  await screen.findByRole("listbox")
  fireEvent.keyDown(input, { key: "Enter" })
}

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({})
  mocks.createPrep.mockReset()
  mocks.toast.mockReset()
  mocks.navigate.mockReset()
})

describe("FormulasPage", () => {
  it("lists dishes with their status chips", async () => {
    renderPage()
    const burger = await screen.findByRole("button", { name: /Hamburguesa/ })
    // 800 cost / 20000 price → 96 % margin.
    expect(within(burger).getByLabelText("Margen 96 %")).toBeInTheDocument()
    expect(within(screen.getByRole("button", { name: /Papas/ })).getByText("Sin fórmula")).toBeInTheDocument()
  })

  it("adds an item by keyboard: Enter adds, focus jumps to its quantity, Enter returns to search", async () => {
    renderPage()
    await openDish()
    await typeAndEnter("carne")
    const quantity = await screen.findByRole("textbox", { name: "Cantidad de Carne molida" })
    await waitFor(() => expect(quantity).toHaveFocus())
    expect(quantity).toHaveValue("50")
    fireEvent.change(quantity, { target: { value: "120" } })
    fireEvent.keyDown(quantity, { key: "Enter" })
    expect(search()).toHaveFocus()
    expect(screen.getByText("Sin guardar")).toBeInTheDocument()
  })

  it("converts a unit-typed quantity into the item's unit and saves the right payload", async () => {
    renderPage()
    await openDish()
    await typeAndEnter("carne")
    const quantity = await screen.findByRole("textbox", { name: "Cantidad de Carne molida" })
    fireEvent.change(quantity, { target: { value: "0,2 kg" } })
    fireEvent.blur(quantity)
    expect(quantity).toHaveValue("200")

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        targetType: "dish",
        targetId: "burger",
        yieldQuantity: 1,
        lines: [
          { ingredientId: "pan", quantity: 1 },
          { ingredientId: "carne", quantity: 200 },
        ],
      }),
    )
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Fórmula guardada" }))
  })

  it("shows an inline Spanish error for an unknown unit", async () => {
    renderPage()
    await openDish()
    const quantity = screen.getByRole("textbox", { name: "Cantidad de Pan brioche" })
    fireEvent.change(quantity, { target: { value: "2 kg" } })
    fireEvent.keyDown(quantity, { key: "Enter" })
    expect(screen.getByRole("alert")).toHaveTextContent("No se puede convertir kg a unidad")
  })

  it("Ctrl+S saves the open formula", async () => {
    renderPage()
    await openDish()
    fireEvent.keyDown(window, { key: "s", ctrlKey: true })
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        targetType: "dish",
        targetId: "burger",
        yieldQuantity: 1,
        lines: [{ ingredientId: "pan", quantity: 1 }],
      }),
    )
  })

  it("creates a preparation nested and returns to the parent with the line added", async () => {
    mocks.createPrep.mockResolvedValue(item("salsa", "Salsa roja", "ml", 0, "prep", 0))
    renderPage()
    await openDish()
    await typeAndEnter("Salsa roja")

    const dialog = await screen.findByRole("dialog", { name: "Nueva preparación" })
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Salsa roja")
    fireEvent.click(within(dialog).getByRole("radio", { name: "ml" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear y abrir" }))
    await waitFor(() => expect(mocks.createPrep).toHaveBeenCalledWith({ name: "Salsa roja", unit: "ml" }))

    await screen.findByRole("heading", { name: "Salsa roja" })
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" })
    expect(crumbs).toHaveTextContent("Hamburguesa›Salsa roja")

    await typeAndEnter("tomate")
    await screen.findByRole("textbox", { name: "Cantidad de Tomate" })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    expect(mocks.save).toHaveBeenCalledWith({
      targetType: "prep",
      targetId: "salsa",
      yieldQuantity: 1,
      lines: [{ ingredientId: "tomate", quantity: 50 }],
    })

    await screen.findByRole("heading", { name: "Hamburguesa" })
    const prepQuantity = screen.getByRole("textbox", { name: "Cantidad de Salsa roja" })
    await waitFor(() => expect(prepQuantity).toHaveFocus())
    expect(screen.getByRole("textbox", { name: "Cantidad de Pan brioche" })).toBeInTheDocument()
  })

  it("Esc closes a nested level and keeps the parent's unsaved draft", async () => {
    renderPage()
    await openDish()
    await typeAndEnter("carne")
    await screen.findByRole("textbox", { name: "Cantidad de Carne molida" })
    await typeAndEnter("salsa base")
    fireEvent.click(await screen.findByRole("button", { name: "Editar preparación" }))
    await screen.findByRole("heading", { name: "Salsa base" })
    fireEvent.keyDown(window, { key: "Escape" })
    await screen.findByRole("heading", { name: "Hamburguesa" })
    expect(screen.getByRole("textbox", { name: "Cantidad de Carne molida" })).toBeInTheDocument()
  })

  it("disables an option that would create a cycle", async () => {
    renderPage()
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Preparaciones/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Aderezo/ }))
    await screen.findByRole("heading", { name: "Aderezo" })
    expect(screen.getByText(/Se puede producir:/)).toHaveTextContent("1.000 ml")

    const input = search()
    input.focus()
    fireEvent.change(input, { target: { value: "salsa base" } })
    const option = await screen.findByRole("option", { name: /Salsa base/ })
    expect(option).toHaveAttribute("aria-disabled", "true")
    expect(option).toHaveTextContent("Crearía un ciclo")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.queryByRole("textbox", { name: "Cantidad de Salsa base" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Producir" }))
    expect(mocks.navigate).toHaveBeenCalledWith("inventory/production")
  })

  it("/ focuses the search and Copiar de… merges another formula's lines; Escalar ×2 doubles them", async () => {
    renderPage()
    await openDish()
    fireEvent.keyDown(document.body, { key: "/" })
    expect(search()).toHaveFocus()

    fireEvent.click(screen.getByRole("button", { name: "Copiar de…" }))
    fireEvent.click(await screen.findByRole("option", { name: /Salsa base/ }))
    expect(screen.getByRole("textbox", { name: "Cantidad de Aderezo" })).toHaveValue("200")

    fireEvent.click(screen.getByRole("button", { name: "Escalar" }))
    fireEvent.click(await screen.findByRole("button", { name: "×2" }))
    expect(screen.getByRole("textbox", { name: "Cantidad de Aderezo" })).toHaveValue("400")
    expect(screen.getByRole("textbox", { name: "Cantidad de Pan brioche" })).toHaveValue("2")
  })
})
