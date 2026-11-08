import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"
import { queryClient } from "@/lib/queryClient"
import { formatCurrency } from "@/utils/helpers"

/**
 * T9 (redesign, S2/S5) — the admin Menú tree: categories in waiter order
 * (reordered by drag or ↑/↓ on the handle, saved with PUT /catalog/categories/order),
 * their subcategories (create, rename, reorder, activate, delete with the API 409)
 * and dishes, the category inspector with the derived "Sin subcategorías" state,
 * and the live "Así lo ve el mesero" preview.
 */

const api = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  fetchPromotions: vi.fn(async () => []),
  reorderCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createDish: vi.fn(),
  updateDish: vi.fn(),
  deleteDish: vi.fn(),
  reorderDishes: vi.fn(),
  getMenuDraft: vi.fn(),
  getMenuPublication: vi.fn(),
  publishMenu: vi.fn(),
  fetchModifierGroups: vi.fn(async () => []),
}))
vi.mock("@/lib/api/catalog", () => api)
const subApi = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
  delete: vi.fn(),
}))
vi.mock("@/lib/api/subcategories", () => subApi)
vi.mock("@/lib/api/storage", () => ({
  isImageAccessible: vi.fn(async () => true),
  getPlaceholderUrl: () => "/placeholder.svg",
  isPlaceholderUrl: () => false,
  deleteImage: vi.fn(),
}))
vi.mock("@/components/ui/image-upload", () => ({ ImageUpload: () => null }))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("@/hooks/inventory", () => ({ useInventoryItems: () => ({ data: [] }) }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { MenuTreeEditor } from "./MenuTreeEditor"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false

const category = (id: string, name: string, sortOrder: number, color: string, icon: string, hasSubcategories = false) => ({
  id,
  name,
  description: null,
  icon,
  active: true,
  sortOrder,
  color,
  hasSubcategories,
  createdAt: null,
  updatedAt: null,
})
const sub = (id: string, categoryId: string, name: string, sortOrder: number, active = true) => ({
  id,
  categoryId,
  name,
  sortOrder,
  active,
  createdAt: null,
  updatedAt: null,
})
const dish = (id: string, name: string, categoryId: string, subcategoryId: string | null = null) => ({
  id,
  name,
  description: null,
  price: 5000,
  categoryId,
  subcategoryId,
  imageUrl: null,
  active: true,
  allowComments: false,
  sortOrder: 0,
  modifierGroups: [] as { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: { id: string; groupId: string; name: string; price: number; ingredientId: null; ingredientQty: null; sortOrder: number; isActive: boolean }[] }[],
  createdAt: null,
  updatedAt: null,
})

let categories: ReturnType<typeof category>[]
let subcategories: ReturnType<typeof sub>[]
let dishes: ReturnType<typeof dish>[]
let publication: { publishedAt: string | null; publishedByName: string | null; pendingChanges: number }

/** GET /catalog/menu/draft: the live structure, active rows only, as the API serves it. */
const draftOf = () => ({
  categories: categories
    .filter((c) => c.active)
    .map((c) => ({
      ...c,
      subcategories: subcategories.filter((s) => s.categoryId === c.id && s.active),
      dishes: dishes.filter((d) => d.categoryId === c.id && d.active).map((d) => ({ ...d, available: true })),
    })),
  uncategorized: [],
})
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  queryClient.clear()
  toastMock.mockClear()
  categories = [
    category("c-beb", "Bebidas", 0, "sky", "Coffee", true),
    category("c-pos", "Postres", 1, "violet", "Cake"),
    category("c-ent", "Entradas", 2, "yellow", "Soup"),
  ]
  subcategories = [sub("s-jug", "c-beb", "Jugos", 0), sub("s-gas", "c-beb", "Gaseosas", 1)]
  dishes = [
    dish("d-lulo", "Lulo", "c-beb", "s-jug"),
    dish("d-cola", "Cola", "c-beb", "s-gas"),
    dish("d-natas", "Natas", "c-pos"),
    dish("d-arroz", "Arroz con leche", "c-pos"),
  ]
  publication = { publishedAt: hoursAgo(2), publishedByName: "Ana Gómez", pendingChanges: 0 }
  for (const fn of [...Object.values(api), ...Object.values(subApi)]) fn.mockReset()
  api.getMenuDraft.mockImplementation(async () => draftOf())
  api.getMenuPublication.mockImplementation(async () => publication)
  api.publishMenu.mockImplementation(async () => {
    publication = { publishedAt: new Date().toISOString(), publishedByName: "Ana Gómez", pendingChanges: 0 }
    return publication
  })
  api.reorderDishes.mockImplementation(async (_group: unknown, ids: string[]) =>
    ids.map((id, i) => ({ ...dishes.find((d) => d.id === id)!, sortOrder: i })),
  )
  api.fetchCategories.mockImplementation(async () => categories)
  api.fetchDishes.mockImplementation(async () => dishes)
  api.reorderCategories.mockImplementation(async (ids: string[]) =>
    ids.map((id, i) => ({ ...categories.find((c) => c.id === id)!, sortOrder: i })),
  )
  api.updateDish.mockImplementation(async (id: string, body: object) => ({ ...dishes.find((d) => d.id === id), ...body }))
  api.updateCategory.mockResolvedValue({})
  subApi.getAll.mockImplementation(async () => subcategories)
  subApi.create.mockImplementation(async (body: { categoryId: string; name: string }) => sub("s-new", body.categoryId, body.name, 9))
  subApi.update.mockResolvedValue({})
  subApi.reorder.mockResolvedValue([])
  subApi.delete.mockResolvedValue(undefined)
})

async function renderEditor() {
  render(wrap(<MenuTreeEditor />))
  await waitFor(() => expect(screen.getByRole("button", { name: /^Bebidas/ })).toBeInTheDocument())
}

const tree = () => screen.getByRole("list", { name: "Categorías" })
const treeNames = () =>
  within(tree())
    .getAllByRole("listitem")
    .filter((li) => li.parentElement === tree())
    .map((li) => li.querySelector("[data-category-name]")?.textContent)

async function select(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }))
  })
}

const inspector = () => screen.getByRole("region", { name: /Editar categoría/ })

describe("MenuTreeEditor — categories", () => {
  it("lists the categories in waiter order with their subcategory and dish summary", async () => {
    await renderEditor()

    expect(treeNames()).toEqual(["Bebidas", "Postres", "Entradas"])
    expect(within(tree()).getByText("2 subcategorías · 2 platos")).toBeInTheDocument()
    expect(within(tree()).getByText("Sin subcategorías · 2 platos")).toBeInTheDocument()
  })

  it("moves a category with ↓ on its handle, saves the order and announces it", async () => {
    await renderEditor()

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Mover Bebidas, posición 1 de 3" }), { key: "ArrowDown" })
    })

    expect(api.reorderCategories).toHaveBeenCalledWith(["c-pos", "c-beb", "c-ent"])
    expect(treeNames()).toEqual(["Postres", "Bebidas", "Entradas"])
    expect(screen.getByRole("status")).toHaveTextContent("Bebidas movida a la posición 2 de 3")
    expect(screen.getByRole("button", { name: "Mover Bebidas, posición 2 de 3" })).toHaveFocus()
  })

  it("does nothing on ↑ at the top", async () => {
    await renderEditor()

    fireEvent.keyDown(screen.getByRole("button", { name: "Mover Bebidas, posición 1 de 3" }), { key: "ArrowUp" })

    expect(api.reorderCategories).not.toHaveBeenCalled()
  })

  it("shows the API message and restores the saved order when the order is refused", async () => {
    api.reorderCategories.mockRejectedValue(new ApiError(422, "Unprocessable Entity", "Unknown category"))
    await renderEditor()

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Mover Bebidas, posición 1 de 3" }), { key: "ArrowDown" })
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "No se guardó el orden: Unknown category" }),
      ),
    )
    await waitFor(() => expect(treeNames()).toEqual(["Bebidas", "Postres", "Entradas"]))
  })

  it("expands a category to its subcategories and dishes", async () => {
    await renderEditor()

    const toggle = screen.getByRole("button", { name: "Expandir Bebidas" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)

    expect(screen.getByRole("button", { name: "Contraer Bebidas" })).toHaveAttribute("aria-expanded", "true")
    const kids = screen.getByRole("list", { name: "Subcategorías de Bebidas" })
    expect(within(kids).getByText("Jugos")).toBeInTheDocument()
    expect(within(kids).getByText("Lulo")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expandir Postres" }))
    expect(within(screen.getByRole("list", { name: "Platos de Postres" })).getByText("Natas")).toBeInTheDocument()
  })

  it("opens the selected category in the inspector with its position and colour", async () => {
    await renderEditor()
    await select("Postres")

    expect(screen.getByRole("button", { name: /^Postres/ })).toHaveAttribute("aria-current", "true")
    expect(within(inspector()).getByRole("heading", { name: "Postres" })).toBeInTheDocument()
    expect(within(inspector()).getByText("Posición 2 de 3 en el paso 1 del mesero")).toBeInTheDocument()
    expect(within(inspector()).getByRole("radio", { name: "Violeta" })).toBeChecked()
  })

  it("moves the selected category from the inspector (list editing, no drag)", async () => {
    await renderEditor()
    await select("Postres")

    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("button", { name: "Subir" }))
    })

    expect(api.reorderCategories).toHaveBeenCalledWith(["c-pos", "c-beb", "c-ent"])
  })

  it("shows the API 409 message when a category with subcategories is deleted", async () => {
    api.deleteCategory.mockRejectedValue(new ApiError(409, "Conflict", "La categoría tiene subcategorías; elimínalas primero"))
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(inspector()).getByRole("button", { name: "Eliminar categoría" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "La categoría tiene subcategorías; elimínalas primero" }),
      ),
    )
    expect(api.deleteCategory).toHaveBeenCalledWith("c-beb")
  })
})

describe("MenuTreeEditor — subcategories", () => {
  it("creates a subcategory in the selected category", async () => {
    await renderEditor()
    await select("Bebidas")

    fireEvent.change(within(inspector()).getByLabelText("Nueva subcategoría"), { target: { value: " Calientes " } })
    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("button", { name: "Agregar subcategoría" }))
    })

    expect(subApi.create).toHaveBeenCalledWith({ categoryId: "c-beb", name: "Calientes" })
  })

  it("shows the API 409 message for a duplicate name", async () => {
    subApi.create.mockRejectedValue(new ApiError(409, "Conflict", "Ya existe una subcategoría con ese nombre en la categoría"))
    await renderEditor()
    await select("Bebidas")

    fireEvent.change(within(inspector()).getByLabelText("Nueva subcategoría"), { target: { value: "Jugos" } })
    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("button", { name: "Agregar subcategoría" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Ya existe una subcategoría con ese nombre en la categoría" }),
      ),
    )
  })

  it("renames a subcategory", async () => {
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(inspector()).getByRole("button", { name: "Renombrar Jugos" }))
    fireEvent.change(within(inspector()).getByLabelText("Nombre de Jugos"), { target: { value: "Jugos naturales" } })
    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("button", { name: "Guardar" }))
    })

    expect(subApi.update).toHaveBeenCalledWith("s-jug", { name: "Jugos naturales" })
  })

  it("reorders subcategories with the PUT order call", async () => {
    await renderEditor()
    await select("Bebidas")

    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("button", { name: "Bajar Jugos" }))
    })

    expect(subApi.reorder).toHaveBeenCalledWith("c-beb", ["s-gas", "s-jug"])
  })

  it("deactivates a subcategory", async () => {
    await renderEditor()
    await select("Bebidas")

    await act(async () => {
      fireEvent.click(within(inspector()).getByRole("switch", { name: "Gaseosas activa" }))
    })

    expect(subApi.update).toHaveBeenCalledWith("s-gas", { active: false })
  })

  it("shows the API 409 message when a subcategory with dishes is deleted", async () => {
    subApi.delete.mockRejectedValue(new ApiError(409, "Conflict", "La subcategoría tiene platos; muévelos primero"))
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(inspector()).getByRole("button", { name: "Eliminar Jugos" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })

    expect(subApi.delete).toHaveBeenCalledWith("s-jug")
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "La subcategoría tiene platos; muévelos primero" }),
      ),
    )
  })
})

describe("MenuTreeEditor — 'Sin subcategorías'", () => {
  it("a category whose dishes sit in no subcategory offers 'Crear subcategoría General', confirmed", async () => {
    await renderEditor()
    await select("Postres")

    expect(within(inspector()).getByText("Sin subcategorías")).toBeInTheDocument()
    fireEvent.click(within(inspector()).getByRole("button", { name: "Crear subcategoría General" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/Sus 2 platos pasarán a «General»/)).toBeInTheDocument()
    expect(subApi.create).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Crear y mover platos" }))
    })

    expect(subApi.create).toHaveBeenCalledWith({ categoryId: "c-pos", name: "General" })
    await waitFor(() => expect(api.updateDish).toHaveBeenCalledTimes(2))
    expect(api.updateDish).toHaveBeenCalledWith("d-arroz", { subcategoryId: "s-new" })
    expect(api.updateDish).toHaveBeenCalledWith("d-natas", { subcategoryId: "s-new" })
  })

  it("a category with subcategories offers 'Unir platos en la categoría', confirmed", async () => {
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(inspector()).getByRole("button", { name: "Unir platos en la categoría" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Lulo")).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Unir platos" }))
    })

    await waitFor(() => expect(api.updateDish).toHaveBeenCalledTimes(2))
    expect(api.updateDish).toHaveBeenCalledWith("d-lulo", { subcategoryId: null })
    expect(api.updateDish).toHaveBeenCalledWith("d-cola", { subcategoryId: null })
  })

  it("cancelling the confirmation changes nothing", async () => {
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(inspector()).getByRole("button", { name: "Unir platos en la categoría" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }))

    expect(api.updateDish).not.toHaveBeenCalled()
  })
})

describe("MenuTreeEditor — 'Así lo ve el mesero'", () => {
  const preview = () => screen.getByRole("region", { name: "Así lo ve el mesero" })

  it("step 1 shows the active categories as tiles in waiter order, the selected one marked", async () => {
    categories.push({ ...category("c-off", "Apagada", 3, "rose", "Soup"), active: false })
    await renderEditor()
    await select("Postres")

    const tiles = within(preview()).getAllByRole("listitem")
    expect(tiles.map((t) => t.querySelector("b")?.textContent)).toEqual(["Bebidas", "Postres", "Entradas"])
    expect(tiles[1]).toHaveAttribute("data-selected", "true")
    expect(within(tiles[0]).getByText("2 subcategorías")).toBeInTheDocument()
    expect(within(tiles[1]).getByText("2 platos · directo")).toBeInTheDocument()
  })

  it("step 2 shows the subcategories of the selected category, or its dishes when it has none", async () => {
    await renderEditor()
    await select("Bebidas")

    fireEvent.click(within(preview()).getByRole("button", { name: "Paso 2 · Bebidas" }))
    expect(within(preview()).getAllByRole("listitem").map((t) => t.querySelector("b")?.textContent)).toEqual([
      "Jugos",
      "Gaseosas",
    ])

    await select("Postres")
    fireEvent.click(within(preview()).getByRole("button", { name: "Platos de Postres" }))
    expect(within(preview()).getAllByRole("listitem").map((t) => t.querySelector("b")?.textContent)).toEqual([
      "Arroz con leche",
      "Natas",
    ])
  })
})

describe("MenuTreeEditor — phone", () => {
  it("below 1024 px opens the inspector as a sheet with a back button", async () => {
    const width = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    try {
      await renderEditor()
      expect(screen.queryByRole("region", { name: /Editar categoría/ })).not.toBeInTheDocument()

      await select("Postres")
      const sheet = screen.getByRole("dialog")
      expect(within(sheet).getByRole("heading", { name: "Postres" })).toHaveFocus()
      expect(within(sheet).getByRole("region", { name: "Editar categoría Postres" })).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(within(sheet).getByRole("button", { name: "Categorías" }))
      })
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width })
    }
  })
})

describe("MenuTreeEditor — 'Publicar a meseros' (T27)", () => {
  const bar = () => screen.getByRole("region", { name: "Publicación del menú" })

  it("with nothing pending shows when and who published, and the button is off", async () => {
    await renderEditor()

    await waitFor(() => expect(within(bar()).getByText("Publicado hace 2 h · por Ana Gómez")).toBeInTheDocument())
    expect(within(bar()).getByRole("button", { name: "Publicar a meseros, sin cambios" })).toBeDisabled()
    expect(screen.queryByText(/cambios? sin publicar/)).not.toBeInTheDocument()
    expect(screen.queryByText("Vista previa (sin publicar)")).not.toBeInTheDocument()
  })

  it("with n changes shows the count, the warning and the draft preview label", async () => {
    publication = { ...publication, pendingChanges: 3 }
    await renderEditor()

    await waitFor(() => expect(within(bar()).getByText("3 cambios sin publicar")).toBeInTheDocument())
    expect(within(bar()).getByText("Publicado hace 2 h · por Ana Gómez")).toBeInTheDocument()
    expect(within(bar()).getByRole("button", { name: "Publicar 3 cambios a meseros" })).toBeEnabled()
    expect(screen.getByText(/Los meseros siguen viendo el menú anterior hasta que publiques/)).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Así lo ve el mesero" })).getByText("Vista previa (sin publicar)")).toBeInTheDocument()
  })

  it("publishes after the confirmation, says so and the count goes back to 0", async () => {
    publication = { ...publication, pendingChanges: 2 }
    await renderEditor()
    await waitFor(() => expect(within(bar()).getByText("2 cambios sin publicar")).toBeInTheDocument())

    fireEvent.click(within(bar()).getByRole("button", { name: "Publicar 2 cambios a meseros" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("¿Publicar 2 cambios a meseros?")).toBeInTheDocument()
    expect(api.publishMenu).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publicar" }))
    })

    expect(api.publishMenu).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Menú publicado",
          description: "Los meseros verán el nuevo menú al abrir su próximo pedido.",
        }),
      ),
    )
    await waitFor(() => expect(within(bar()).getByText("Publicado hace un momento · por Ana Gómez")).toBeInTheDocument())
    expect(within(bar()).getByRole("button", { name: "Publicar a meseros, sin cambios" })).toBeDisabled()
  })

  it("cancelling the confirmation publishes nothing", async () => {
    publication = { ...publication, pendingChanges: 1 }
    await renderEditor()
    await waitFor(() => expect(within(bar()).getByText("1 cambio sin publicar")).toBeInTheDocument())

    fireEvent.click(within(bar()).getByRole("button", { name: "Publicar 1 cambio a meseros" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }))

    expect(api.publishMenu).not.toHaveBeenCalled()
  })

  it("shows the API 403 message and keeps the pending count", async () => {
    publication = { ...publication, pendingChanges: 2 }
    api.publishMenu.mockRejectedValue(new ApiError(403, "Forbidden", "Solo un administrador puede publicar el menú"))
    await renderEditor()
    await waitFor(() => expect(within(bar()).getByText("2 cambios sin publicar")).toBeInTheDocument())

    fireEvent.click(within(bar()).getByRole("button", { name: "Publicar 2 cambios a meseros" }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Solo un administrador puede publicar el menú" }),
      ),
    )
    expect(within(bar()).getByText("2 cambios sin publicar")).toBeInTheDocument()
  })

  it("without any publication says the waiters see the saved menu", async () => {
    publication = { publishedAt: null, publishedByName: null, pendingChanges: 0 }
    await renderEditor()

    await waitFor(() => expect(within(bar()).getByText("Sin publicar todavía: los meseros ven lo guardado")).toBeInTheDocument())
  })

  it("refreshes the count after a structure edit", async () => {
    await renderEditor()
    await waitFor(() => expect(within(bar()).getByRole("button", { name: "Publicar a meseros, sin cambios" })).toBeInTheDocument())

    publication = { ...publication, pendingChanges: 1 }
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Mover Bebidas, posición 1 de 3" }), { key: "ArrowDown" })
    })

    await waitFor(() => expect(within(bar()).getByText("1 cambio sin publicar")).toBeInTheDocument())
  })

  it("the preview reads the draft, not the saved lists", async () => {
    await renderEditor()
    await waitFor(() => expect(api.getMenuDraft).toHaveBeenCalled())
  })
})

describe("MenuTreeEditor — dish order (T27)", () => {
  const postres = () => screen.getByRole("list", { name: "Platos de Postres" })
  const names = (list: HTMLElement) => within(list).getAllByRole("listitem").map((li) => li.querySelector("[data-dish-name]")?.textContent)

  it("moves a dish with ↓ on its handle and saves the group order", async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Expandir Postres" }))
    expect(names(postres())).toEqual(["Arroz con leche", "Natas"])

    await act(async () => {
      fireEvent.keyDown(within(postres()).getByRole("button", { name: "Mover Arroz con leche, posición 1 de 2" }), { key: "ArrowDown" })
    })

    expect(api.reorderDishes).toHaveBeenCalledWith({ categoryId: "c-pos", subcategoryId: null }, ["d-natas", "d-arroz"])
    expect(names(postres())).toEqual(["Natas", "Arroz con leche"])
    expect(screen.getByRole("status")).toHaveTextContent("Arroz con leche movido a la posición 2 de 2")
  })

  it("moves a dish of a subcategory with Subir", async () => {
    dishes.push({ ...dish("d-mora", "Mora", "c-beb", "s-jug"), sortOrder: 1 })
    await renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Expandir Bebidas" }))

    const jugos = screen.getByRole("list", { name: "Platos de Jugos" })
    expect(within(jugos).getByRole("button", { name: "Subir Lulo" })).toBeDisabled()
    await act(async () => {
      fireEvent.click(within(jugos).getByRole("button", { name: "Subir Mora" }))
    })

    expect(api.reorderDishes).toHaveBeenCalledWith({ categoryId: "c-beb", subcategoryId: "s-jug" }, ["d-mora", "d-lulo"])
  })

  it("shows the API message and goes back to the saved order when refused", async () => {
    api.reorderDishes.mockRejectedValue(new ApiError(422, "Unprocessable Entity", "Unknown dish"))
    await renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Expandir Postres" }))

    await act(async () => {
      fireEvent.click(within(postres()).getByRole("button", { name: "Bajar Arroz con leche" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "No se guardó el orden: Unknown dish" }),
      ),
    )
    expect(names(postres())).toEqual(["Arroz con leche", "Natas"])
  })
})

describe("MenuTreeEditor — tile name hint (T27) and modifier groups in the preview (F7)", () => {
  it("counts a new subcategory name against 22 and warns above it", async () => {
    await renderEditor()
    await select("Bebidas")

    const input = within(inspector()).getByLabelText("Nueva subcategoría")
    fireEvent.change(input, { target: { value: "Jugos" } })
    expect(within(inspector()).getByText("5/22")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "Jugos naturales de temporada" } })
    expect(within(inspector()).getByText("28/22")).toBeInTheDocument()
    expect(within(inspector()).getByText("Más de 22 caracteres: puede cortarse en el botón del mesero.")).toBeInTheDocument()
  })

  it("step 4 of the preview shows the dish with its modifier groups", async () => {
    const opt = (id: string, name: string, price: number, sortOrder: number) => ({ id, groupId: "g-1", name, price, ingredientId: null, ingredientQty: null, sortOrder, isActive: true })
    const groups = [
      { id: "g-1", name: "Término", required: true, minSelect: 1, maxSelect: 1, options: [opt("o-1", "Tibio", 0, 0), opt("o-2", "Con helado", 3000, 1)] },
    ]
    dishes = dishes.map((d) => (d.id === "d-natas" ? { ...d, modifierGroups: groups } : d))
    await renderEditor()
    await select("Postres")
    const preview = () => screen.getByRole("region", { name: "Así lo ve el mesero" })
    await waitFor(() => expect(api.getMenuDraft).toHaveBeenCalled())

    fireEvent.click(within(preview()).getByRole("button", { name: "Platos de Postres" }))
    fireEvent.click(await within(preview()).findByRole("button", { name: /^Natas/ }))

    const group = within(preview()).getByRole("group", { name: "Término" })
    expect(group).toHaveTextContent("Obligatorio · elige 1")
    expect(within(group).getAllByRole("listitem").map((li) => li.textContent)).toEqual([`Tibio${formatCurrency(0)}`, `Con helado+${formatCurrency(3000)}`])
    expect(within(preview()).queryByText(/Notas rápidas/)).not.toBeInTheDocument()
  })
})

describe("MenuTreeEditor — Modificadores section (F7)", () => {
  it("switches between the menu tree and the modifier groups", async () => {
    await renderEditor()
    const sections = screen.getByRole("navigation", { name: "Secciones del menú" })
    expect(within(sections).getByRole("button", { name: "Categorías y platos" })).toHaveAttribute("aria-current", "page")

    fireEvent.click(within(sections).getByRole("button", { name: "Modificadores" }))

    expect(within(sections).getByRole("button", { name: "Modificadores" })).toHaveAttribute("aria-current", "page")
    expect(await screen.findByText("Aún no hay grupos de modificadores")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Categorías" })).not.toBeInTheDocument()
    for (const button of within(sections).getAllByRole("button")) expect(button.className).toMatch(/\bmin-h-11\b/)
  })
})
