import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "@/lib/queryClient"

/**
 * menu-platos T2 (S1, S2, S5) — the Platos tab: every dish in dense rows with
 * search, one category/subcategory filter, pagination, row actions and the
 * redesigned dish dialog. Data and calls are the ones DishList always made.
 */

const api = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  deleteDish: vi.fn(),
  createDish: vi.fn(),
  updateDish: vi.fn(),
  getMenuDraft: vi.fn(),
  fetchModifierGroups: vi.fn(async () => []),
  fetchDishModifierGroups: vi.fn(async () => []),
  setDishModifierGroups: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => api)
const subApi = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock("@/lib/api/subcategories", () => subApi)
vi.mock("@/lib/api/storage", () => ({
  isImageAccessible: vi.fn(async () => true),
  getPlaceholderUrl: () => "/placeholder.svg",
  isPlaceholderUrl: () => false,
  deleteImage: vi.fn(),
}))
vi.mock("@/components/ui/image-upload", () => ({ ImageUpload: () => null }))
vi.mock("next/image", () => ({ default: () => null }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { DishList } from "./DishList"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false

const category = (id: string, name: string, sortOrder: number) => ({
  id, name, description: null, icon: "Soup", active: true, sortOrder, color: "neutral", hasSubcategories: false, createdAt: null, updatedAt: null,
})
const sub = (id: string, categoryId: string, name: string, sortOrder: number) => ({ id, categoryId, name, sortOrder, active: true, createdAt: null, updatedAt: null })
const group = { id: "g-1", name: "Término", required: true, minSelect: 1, maxSelect: 1, options: [] }
const dish = (id: string, name: string, categoryId: string, subcategoryId: string | null = null, extra: object = {}) => ({
  id, name, description: null, price: 5000, categoryId, subcategoryId, imageUrl: null, active: true, allowComments: false,
  sortOrder: 0, modifierGroups: [] as (typeof group)[], createdAt: null, updatedAt: null, ...extra,
})

let dishes: ReturnType<typeof dish>[]

beforeEach(() => {
  queryClient.clear()
  toastMock.mockClear()
  for (const fn of [...Object.values(api), ...Object.values(subApi)]) fn.mockReset()
  dishes = [
    dish("d-lulo", "Lulo", "c-beb", "s-jug", { imageUrl: "https://img/lulo.png" }),
    dish("d-cola", "Cola", "c-beb", "s-gas", { active: false }),
    dish("d-natas", "Natas", "c-pos", null, { modifierGroups: [group] }),
    dish("d-arroz", "Arroz con leche", "c-pos"),
  ]
  api.fetchCategories.mockResolvedValue([category("c-beb", "Bebidas", 0), category("c-pos", "Postres", 1)])
  api.fetchDishes.mockImplementation(async () => dishes)
  api.deleteDish.mockResolvedValue(undefined)
  api.fetchModifierGroups.mockResolvedValue([])
  api.fetchDishModifierGroups.mockResolvedValue([])
  api.createDish.mockResolvedValue({ id: "d-new" })
  // GET /catalog/menu/draft is where "available" lives (Natas is sold out).
  api.getMenuDraft.mockResolvedValue({
    categories: [{ id: "c-pos", subcategories: [], dishes: [{ id: "d-natas", available: false }, { id: "d-arroz", available: true }] }],
    uncategorized: [],
  })
  subApi.getAll.mockResolvedValue([sub("s-jug", "c-beb", "Jugos", 0), sub("s-gas", "c-beb", "Gaseosas", 1)])
})

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>

async function renderList(props: Partial<React.ComponentProps<typeof DishList>> = {}) {
  render(wrap(<DishList {...props} />))
  await waitFor(() => expect(screen.getByText("Lulo")).toBeInTheDocument())
}

const rows = () => within(screen.getByRole("list", { name: "Platos" })).getAllByRole("listitem")
const rowOf = (name: string) => rows().find((row) => within(row).queryByText(name))!
const names = () => rows().map((row) => row.querySelector("[data-dish-name]")?.textContent)
const filter = () => screen.getByRole("combobox", { name: "Categoría" })

describe("DishList — Platos tab", () => {
  it("lists every dish with its count, path, options chip and status chips", async () => {
    await renderList()
    expect(screen.getByRole("heading", { name: "Todos los platos" })).toBeInTheDocument()
    expect(screen.getByText("4 platos")).toBeInTheDocument()
    expect(names()).toEqual(["Lulo", "Cola", "Natas", "Arroz con leche"])
    expect(within(rowOf("Lulo")).getByText("Bebidas › Jugos")).toBeInTheDocument()
    expect(within(rowOf("Natas")).getByText("Postres")).toBeInTheDocument()
    expect(within(rowOf("Natas")).getByText("Con opciones")).toBeInTheDocument()
    expect(within(rowOf("Lulo")).queryByText("Con opciones")).not.toBeInTheDocument()
    expect(within(rowOf("Cola")).getByText("Inactivo")).toBeInTheDocument()
    expect(within(rowOf("Lulo")).getByText("Activo")).toBeInTheDocument()
    await waitFor(() => expect(within(rowOf("Natas")).getByText("Agotado")).toBeInTheDocument())
    expect(within(rowOf("Arroz con leche")).queryByText("Agotado")).not.toBeInTheDocument()
    // Without an image the thumbnail is the initial.
    expect(within(rowOf("Arroz con leche")).getByText("A")).toBeInTheDocument()
  })

  it("the filter lists every category and subcategory with counts and narrows the list", async () => {
    await renderList()
    const options = within(filter()).getAllByRole("option").map((o) => o.textContent?.trim())
    expect(options).toEqual(["Todas las categorías (4)", "Bebidas (2)", "Bebidas › Jugos (1)", "Bebidas › Gaseosas (1)", "Postres (2)"])

    fireEvent.change(filter(), { target: { value: "c-pos" } })
    expect(names()).toEqual(["Natas", "Arroz con leche"])
    expect(screen.getByRole("heading", { name: "Platos de Postres" })).toBeInTheDocument()

    fireEvent.change(filter(), { target: { value: "c-beb|s-jug" } })
    expect(names()).toEqual(["Lulo"])
    expect(screen.getByRole("heading", { name: "Platos de Bebidas › Jugos" })).toBeInTheDocument()
    expect(screen.getByText("1 plato")).toBeInTheDocument()
  })

  it("starts on the filter it is given and reports changes", async () => {
    const onFilterChange = vi.fn()
    render(wrap(<DishList filter={{ categoryId: "c-pos", subcategoryId: null }} onFilterChange={onFilterChange} />))
    await waitFor(() => expect(screen.getByText("Natas")).toBeInTheDocument())
    expect(screen.queryByText("Lulo")).not.toBeInTheDocument()
    fireEvent.change(filter(), { target: { value: "" } })
    expect(onFilterChange).toHaveBeenCalledWith({ categoryId: null, subcategoryId: null })
  })

  it("search with no results says so", async () => {
    await renderList()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar platos" }), { target: { value: "sushi" } })
    expect(screen.getByText("No se encontraron platos con ese término de búsqueda")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Platos" })).not.toBeInTheDocument()
  })

  it("'Nuevo plato' opens the dialog prefilled with the filtered category and subcategory", async () => {
    await renderList({ filter: { categoryId: "c-beb", subcategoryId: "s-jug" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nuevo plato" }))
    })
    const dialog = screen.getByRole("dialog", { name: "Nuevo plato" })
    fireEvent.change(within(dialog).getByLabelText("Nombre del plato"), { target: { value: "Mora" } })
    fireEvent.change(within(dialog).getByLabelText("Precio"), { target: { value: "6000" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Crear plato" }))
    })
    await waitFor(() => expect(api.createDish).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c-beb", subcategoryId: "s-jug" })))
  })

  it("row actions: Fórmula navigates, edit opens the dialog, delete asks first", async () => {
    const onNavigate = vi.fn()
    await renderList({ onNavigate })
    const row = rowOf("Natas")
    for (const label of ["Fórmula de Natas", "Editar Natas", "Eliminar Natas"])
      expect(within(row).getByRole("button", { name: label }).className).toMatch(/\bmin-h-11\b/)

    fireEvent.click(within(row).getByRole("button", { name: "Fórmula de Natas" }))
    expect(onNavigate).toHaveBeenCalledWith("formulas")

    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Editar Natas" }))
    })
    const dialog = screen.getByRole("dialog", { name: "Editar plato" })
    expect(within(dialog).getByDisplayValue("Natas")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    fireEvent.click(within(rowOf("Natas")).getByRole("button", { name: "Eliminar Natas" }))
    const confirm = screen.getByRole("alertdialog")
    expect(confirm).toHaveTextContent("Esta acción eliminará permanentemente el plato Natas y no se puede deshacer.")
    expect(api.deleteDish).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Eliminar" }))
    })
    expect(api.deleteDish).toHaveBeenCalledWith("d-natas")
  })

  it("keeps the pagination of 10 per page", async () => {
    dishes = Array.from({ length: 12 }, (_, i) => dish(`d-${i}`, `Plato ${String(i).padStart(2, "0")}`, "c-pos"))
    render(wrap(<DishList />))
    await waitFor(() => expect(screen.getByText("Plato 00")).toBeInTheDocument())
    expect(rows()).toHaveLength(10)
    expect(screen.getByText("Mostrando 10 de 12 platos")).toBeInTheDocument()
  })
})
