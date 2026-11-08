import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "@/lib/queryClient"

/**
 * F7 T2 (S2–S4, S7) — Menú → Modificadores: the reusable groups with their
 * rule chip, option count and "en N platos", and the group editor (name,
 * Obligatorio, Mínimo/Máximo, options with price and an optional ingredient).
 */

const api = vi.hoisted(() => ({
  fetchModifierGroups: vi.fn(),
  fetchDishes: vi.fn(),
  createModifierGroup: vi.fn(),
  updateModifierGroup: vi.fn(),
  deleteModifierGroup: vi.fn(),
  createModifierOption: vi.fn(),
  updateModifierOption: vi.fn(),
  deleteModifierOption: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => api)
vi.mock("@/hooks/inventory", () => ({
  useInventoryItems: () => ({
    data: [
      { id: "i-queso", name: "Queso cheddar", unit: "lonja", isActive: true },
      { id: "i-tocineta", name: "Tocineta", unit: "tiras", isActive: true },
    ],
  }),
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { ModifierGroupsEditor } from "./ModifierGroupsEditor"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const option = (id: string, groupId: string, name: string, price: number, sortOrder: number, ingredientId: string | null = null, ingredientQty: number | null = null) => ({
  id,
  groupId,
  name,
  price,
  ingredientId,
  ingredientQty,
  sortOrder,
  isActive: true,
})
const group = (id: string, name: string, minSelect: number, maxSelect: number | null, options: ReturnType<typeof option>[]) => ({
  id,
  name,
  required: minSelect >= 1,
  minSelect,
  maxSelect,
  sortOrder: 0,
  isActive: true,
  options,
  createdAt: null,
  updatedAt: null,
})
const termino = group("g-term", "Término de la carne", 1, 1, [option("o-medio", "g-term", "Medio", 0, 0), option("o-azul", "g-term", "Azul", 0, 1)])
const adiciones = group("g-adic", "Adiciones", 0, 3, [option("o-queso", "g-adic", "Queso", 3000, 0, "i-queso", 1)])
const dishWith = (id: string, name: string, groups: { id: string }[]) => ({ id, name, modifierGroups: groups })

let groups: ReturnType<typeof group>[]

beforeEach(() => {
  queryClient.clear()
  toastMock.mockClear()
  groups = [termino, adiciones]
  api.fetchModifierGroups.mockReset().mockImplementation(async () => groups)
  api.fetchDishes.mockReset().mockResolvedValue([
    dishWith("d-1", "Hamburguesa", [termino, adiciones]),
    dishWith("d-2", "Churrasco", [termino]),
    dishWith("d-3", "Papas", []),
  ])
  api.createModifierGroup.mockReset().mockResolvedValue({ ...group("g-new", "Bebida", 1, 1, []) })
  api.updateModifierGroup.mockReset().mockImplementation(async (id: string) => groups.find((g) => g.id === id))
  api.deleteModifierGroup.mockReset().mockResolvedValue(undefined)
  api.createModifierOption.mockReset().mockResolvedValue({})
  api.updateModifierOption.mockReset().mockResolvedValue({})
  api.deleteModifierOption.mockReset().mockResolvedValue(undefined)
})

const renderEditor = async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ModifierGroupsEditor />
    </QueryClientProvider>,
  )
  await screen.findByRole("list", { name: "Grupos de modificadores" })
}
const list = () => screen.getByRole("list", { name: "Grupos de modificadores" })
const editor = () => screen.getByRole("region", { name: /^Editar grupo|^Nuevo grupo/ })
const save = async () => {
  await act(async () => {
    fireEvent.click(within(editor()).getByRole("button", { name: "Guardar grupo" }))
  })
}

describe("ModifierGroupsEditor — list", () => {
  it("lists each group with its rule chip, option count and the dishes that offer it", async () => {
    await renderEditor()
    const rows = within(list()).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Término de la carne")
    expect(rows[0]).toHaveTextContent("Obligatorio · elige 1")
    expect(rows[0]).toHaveTextContent("2 opciones · en 2 platos")
    expect(rows[1]).toHaveTextContent("Opcional · hasta 3")
    expect(rows[1]).toHaveTextContent("1 opción · en 1 plato")
  })

  it("shows the empty state with a way to create the first group", async () => {
    groups = []
    render(
      <QueryClientProvider client={queryClient}>
        <ModifierGroupsEditor />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("Aún no hay grupos de modificadores")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Crear el primer grupo" }))
    expect(screen.getByRole("region", { name: "Nuevo grupo" })).toBeInTheDocument()
  })

  it("keeps every new control at least 44 px tall", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Adiciones/ }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Agregar opción" }))
    const controls = [
      ...screen.getAllByRole("button"),
      ...within(editor()).getAllByRole("textbox"),
      ...within(editor()).getAllByRole("combobox"),
      within(editor()).getByRole("switch"),
    ]
    for (const control of controls) {
      expect(control.className, control.getAttribute("aria-label") ?? control.textContent ?? "").toMatch(/\bmin-h-11\b|\bh-11\b/)
    }
  })
})

describe("ModifierGroupsEditor — group editor", () => {
  it("creates a required group with its options in order", async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }))
    fireEvent.change(within(editor()).getByLabelText("Nombre del grupo"), { target: { value: "Bebida" } })
    fireEvent.click(within(editor()).getByRole("switch", { name: /Obligatorio/ }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Más máximo" }))
    expect(within(editor()).getByText("Obligatorio · elige 1", { selector: "p" })).toBeInTheDocument()
    fireEvent.click(within(editor()).getByRole("button", { name: "Agregar opción" }))
    fireEvent.change(within(editor()).getByLabelText("Nombre de la opción 1"), { target: { value: "Limonada" } })
    fireEvent.click(within(editor()).getByRole("button", { name: "Agregar opción" }))
    fireEvent.change(within(editor()).getByLabelText("Nombre de la opción 2"), { target: { value: "Jugo" } })
    fireEvent.change(within(editor()).getByLabelText("Precio de la opción 2"), { target: { value: "2000" } })
    fireEvent.click(within(editor()).getByRole("button", { name: "Subir opción 2" }))
    await save()

    expect(api.createModifierGroup).toHaveBeenCalledWith({ name: "Bebida", required: true, minSelect: 1, maxSelect: 1 })
    expect(api.createModifierOption.mock.calls).toEqual([
      ["g-new", { name: "Jugo", price: 2000, ingredientId: null, ingredientQty: null, sortOrder: 0 }],
      ["g-new", { name: "Limonada", price: 0, ingredientId: null, ingredientQty: null, sortOrder: 1 }],
    ])
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Grupo creado" }))
  })

  it("edits a shared group, warns it applies to every dish and saves only what changed", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Término de la carne/ }))
    expect(within(editor()).getByText(/Se usa en 2 platos: el cambio aplica en todos/)).toHaveTextContent("Hamburguesa, Churrasco")
    fireEvent.change(within(editor()).getByLabelText("Precio de la opción 2"), { target: { value: "500" } })
    fireEvent.click(within(editor()).getByRole("button", { name: "Sin límite" }))
    await save()

    expect(api.updateModifierGroup).toHaveBeenCalledWith("g-term", { name: "Término de la carne", required: true, minSelect: 1, maxSelect: null })
    expect(api.updateModifierOption.mock.calls).toEqual([
      ["o-azul", { name: "Azul", price: 500, ingredientId: null, ingredientQty: null, sortOrder: 1 }],
    ])
    expect(api.createModifierOption).not.toHaveBeenCalled()
    expect(api.deleteModifierOption).not.toHaveBeenCalled()
  })

  it("does not warn for a group used by one dish", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Adiciones/ }))
    expect(within(editor()).queryByText(/el cambio aplica en todos/)).not.toBeInTheDocument()
  })

  it("refuses to save what the API would refuse, in Spanish", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Término de la carne/ }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Más mínimo" }))
    await save()
    expect(within(editor()).getByRole("alert")).toHaveTextContent("El máximo debe ser mayor o igual al mínimo")

    fireEvent.click(within(editor()).getByRole("button", { name: "Menos mínimo" }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Menos mínimo" }))
    await save()
    expect(within(editor()).getByRole("alert")).toHaveTextContent("Un grupo obligatorio pide al menos una opción y uno opcional ninguna")
    expect(api.updateModifierGroup).not.toHaveBeenCalled()
  })

  it("links an option to an ingredient with its quantity and unit", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Adiciones/ }))
    expect(within(editor()).getByLabelText("Ingrediente de la opción 1")).toHaveValue("i-queso")
    fireEvent.click(within(editor()).getByRole("button", { name: "Agregar opción" }))
    fireEvent.change(within(editor()).getByLabelText("Nombre de la opción 2"), { target: { value: "Tocineta" } })
    fireEvent.change(within(editor()).getByLabelText("Precio de la opción 2"), { target: { value: "4000" } })
    fireEvent.click(within(editor()).getByRole("button", { name: "Descontar un ingrediente en la opción 2" }))
    fireEvent.change(within(editor()).getByLabelText("Ingrediente de la opción 2"), { target: { value: "i-tocineta" } })
    await save()
    expect(within(editor()).getByRole("alert")).toHaveTextContent("El ingrediente y su cantidad van juntos")

    fireEvent.change(within(editor()).getByLabelText("Cantidad de la opción 2"), { target: { value: "2,5" } })
    expect(within(editor()).getByText("tiras")).toBeInTheDocument()
    await save()
    expect(api.createModifierOption).toHaveBeenCalledWith("g-adic", {
      name: "Tocineta",
      price: 4000,
      ingredientId: "i-tocineta",
      ingredientQty: 2.5,
      sortOrder: 1,
    })
  })

  it("removes an option only after confirming, and deletes it on save", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Término de la carne/ }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Quitar opción 1" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    expect(within(editor()).getByLabelText("Nombre de la opción 1")).toHaveValue("Medio")

    fireEvent.click(within(editor()).getByRole("button", { name: "Quitar opción 1" }))
    fireEvent.click(await screen.findByRole("button", { name: "Quitar" }))
    expect(within(editor()).getByLabelText("Nombre de la opción 1")).toHaveValue("Azul")
    await save()
    expect(api.deleteModifierOption).toHaveBeenCalledWith("o-medio")
    expect(api.updateModifierOption).toHaveBeenCalledWith("o-azul", expect.objectContaining({ sortOrder: 0 }))
  })

  it("deletes a group only after confirming", async () => {
    await renderEditor()
    fireEvent.click(within(list()).getByRole("button", { name: /Adiciones/ }))
    fireEvent.click(within(editor()).getByRole("button", { name: "Eliminar grupo" }))
    expect(await screen.findByText("¿Eliminar el grupo Adiciones?")).toBeInTheDocument()
    expect(api.deleteModifierGroup).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })
    await waitFor(() => expect(api.deleteModifierGroup).toHaveBeenCalledWith("g-adic"))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Grupo eliminado" }))
  })
})
