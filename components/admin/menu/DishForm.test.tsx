import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T7b (S4) — the dish form writes through the API with a camelCase body. */

const catalog = vi.hoisted(() => ({
  createDish: vi.fn(),
  updateDish: vi.fn(),
  fetchModifierGroups: vi.fn(),
  fetchDishModifierGroups: vi.fn(),
  setDishModifierGroups: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalog)
const storage = vi.hoisted(() => ({
  isImageAccessible: vi.fn(async () => true),
  getPlaceholderUrl: () => "/placeholder.svg",
  isPlaceholderUrl: (url: string) => url.includes("placeholder.svg"),
  deleteImage: vi.fn(async () => undefined),
}))
vi.mock("@/lib/api/storage", () => storage)
// The uploader stub reports a new public URL when its button is clicked.
vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: ({ onChange }: { onChange: (url: string) => void }) => (
    <button type="button" onClick={() => onChange("http://bucket/r-1/dishes/b.png")}>
      stub-upload
    </button>
  ),
}))
vi.mock("next/image", () => ({ default: () => null }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { DishForm } from "./DishForm"

// Radix measures itself; jsdom does not.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= function () {}

const categories = [
  {
    id: "c-1",
    name: "Platos",
    description: null,
    icon: "Soup",
    active: true,
    sortOrder: 0,
    color: "neutral" as const,
    hasSubcategories: false,
    createdAt: null,
    updatedAt: null,
  },
]
const dish = {
  id: "d-1",
  name: "Sopa",
  description: "Del día",
  price: 9000,
  categoryId: "c-1",
  subcategoryId: null,
  imageUrl: "https://img/d-1.png",
  active: true,
  allowComments: true,
  sortOrder: 0,
  modifierGroups: [],
  createdAt: null,
  updatedAt: null,
}

const modifierGroup = (id: string, name: string, minSelect: number, maxSelect: number | null, options: number) => ({
  id,
  name,
  required: minSelect >= 1,
  minSelect,
  maxSelect,
  sortOrder: 0,
  isActive: true,
  options: Array.from({ length: options }, (_, i) => ({
    id: `${id}-o${i}`,
    groupId: id,
    name: `Opción ${i}`,
    price: i * 1000,
    ingredientId: null,
    ingredientQty: null,
    sortOrder: i,
    isActive: true,
  })),
  createdAt: null,
  updatedAt: null,
})
const modifierGroups = [
  modifierGroup("g-term", "Término", 1, 1, 4),
  modifierGroup("g-adic", "Adiciones", 0, 3, 4),
  modifierGroup("g-sin", "Sin", 0, null, 2),
]

beforeEach(() => {
  catalog.createDish.mockReset().mockResolvedValue({ id: "d-2" })
  catalog.updateDish.mockReset().mockResolvedValue(dish)
  catalog.fetchModifierGroups.mockReset().mockResolvedValue(modifierGroups)
  catalog.fetchDishModifierGroups.mockReset().mockResolvedValue([])
  catalog.setDishModifierGroups.mockReset().mockImplementation(async (_id: string, ids: string[]) => ids)
  toastMock.mockClear()
  storage.deleteImage.mockClear()
  storage.isImageAccessible.mockReset().mockResolvedValue(true)
})

/** "Cambiar imagen" opens the uploader, which then reports a new successful upload. */
async function replaceImage() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Cambiar imagen" }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "stub-upload" }))
  })
}

describe("DishForm", () => {
  it("updates an existing dish with the camelCase body", async () => {
    const onSuccess = vi.fn()
    render(<DishForm dish={dish} categories={categories} onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "9500" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.updateDish).toHaveBeenCalledWith("d-1", {
      name: "Sopa",
      description: "Del día",
      price: 9500,
      categoryId: "c-1",
      subcategoryId: null,
      imageUrl: "https://img/d-1.png",
      active: true,
      allowComments: true,
    })
    expect(catalog.createDish).not.toHaveBeenCalled()
  })

  it("creates a dish without category or image as nulls", async () => {
    const onSuccess = vi.fn()
    render(<DishForm categories={categories} onSuccess={onSuccess} isNewDish />)

    fireEvent.change(screen.getByLabelText("Nombre del plato"), { target: { value: "Jugo" } })
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "4000" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.createDish).toHaveBeenCalledWith({
      name: "Jugo",
      description: null,
      price: 4000,
      categoryId: null,
      subcategoryId: null,
      imageUrl: null,
      active: true,
      allowComments: false,
    })
  })

  it("shows the API message when the save fails", async () => {
    catalog.updateDish.mockRejectedValue(new Error("Unknown category"))
    render(<DishForm dish={dish} categories={categories} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Error al guardar el plato: Unknown category" }),
      ),
    )
  })

  it("deletes a stored image through the storage API, never a placeholder (T12)", async () => {
    render(<DishForm dish={dish} categories={categories} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar imagen" }))
    })
    expect(storage.deleteImage).toHaveBeenCalledWith("https://img/d-1.png")

    storage.deleteImage.mockClear()
    render(<DishForm dish={{ ...dish, id: "d-9", imageUrl: "/placeholder.svg?query=x" }} categories={categories} onSuccess={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Eliminar imagen" }).at(-1)!)
    })
    expect(storage.deleteImage).not.toHaveBeenCalled()
  })

  const bucketDish = { ...dish, imageUrl: "http://bucket/r-1/dishes/a.png" }

  it("keeps an unreachable image and never deletes it on save (item 1)", async () => {
    storage.isImageAccessible.mockResolvedValue(false)
    const onSuccess = vi.fn()
    render(<DishForm dish={bucketDish} categories={categories} onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())
    await waitFor(() => expect(storage.isImageAccessible).toHaveBeenCalled())
    await act(async () => {})

    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "9900" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(storage.deleteImage).not.toHaveBeenCalled()
    expect(catalog.updateDish).toHaveBeenCalledWith(
      "d-1",
      expect.objectContaining({ price: 9900, imageUrl: "http://bucket/r-1/dishes/a.png" }),
    )
  })

  it("deletes the replaced image only after the update succeeds (item 2)", async () => {
    const order: string[] = []
    storage.deleteImage.mockImplementation(async () => {
      order.push("delete")
      return undefined
    })
    catalog.updateDish.mockImplementation(async () => {
      order.push("update")
      return dish
    })
    const onSuccess = vi.fn()
    render(<DishForm dish={bucketDish} categories={categories} onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())
    await replaceImage()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(order).toEqual(["update", "delete"])
    expect(storage.deleteImage).toHaveBeenCalledWith("http://bucket/r-1/dishes/a.png")
    expect(catalog.updateDish).toHaveBeenCalledWith("d-1", expect.objectContaining({ imageUrl: "http://bucket/r-1/dishes/b.png" }))
  })

  it("keeps the old image when the update fails (item 2)", async () => {
    catalog.updateDish.mockRejectedValue(new Error("boom"))
    const onSuccess = vi.fn()
    render(<DishForm dish={bucketDish} categories={categories} onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())
    await replaceImage()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })))
    expect(storage.deleteImage).not.toHaveBeenCalled()
  })
})

// ---- T9 (redesign): the subcategory picker -----------------------------------

const twoCategories = [
  categories[0],
  { ...categories[0], id: "c-2", name: "Bebidas", icon: "Coffee", sortOrder: 1 },
]
const subcategories = [
  { id: "s-1", categoryId: "c-1", name: "Sopas", sortOrder: 0, active: true, createdAt: null, updatedAt: null },
  { id: "s-2", categoryId: "c-1", name: "Cremas", sortOrder: 1, active: true, createdAt: null, updatedAt: null },
  { id: "s-3", categoryId: "c-2", name: "Jugos", sortOrder: 0, active: true, createdAt: null, updatedAt: null },
]

/** Opens a Radix select by keyboard and picks an option (jsdom has no pointer layout). */
async function pick(label: string, option: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  })
  await act(async () => {
    fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
  })
}

describe("DishForm — subcategory", () => {
  it("offers only the subcategories of the dish category, plus none", async () => {
    render(<DishForm dish={dish} categories={twoCategories} subcategories={subcategories} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Subcategoría" }), { key: "Enter" })
    })
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(options).toEqual(["Sin subcategoría", "Sopas", "Cremas"])
  })

  it("sends the picked subcategory", async () => {
    const onSuccess = vi.fn()
    render(<DishForm dish={dish} categories={twoCategories} subcategories={subcategories} onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    await pick("Subcategoría", "Cremas")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.updateDish).toHaveBeenCalledWith("d-1", expect.objectContaining({ categoryId: "c-1", subcategoryId: "s-2" }))
  })

  it("a new dish starts in the given category", async () => {
    const onSuccess = vi.fn()
    render(
      <DishForm categories={twoCategories} subcategories={subcategories} defaultCategoryId="c-2" onSuccess={onSuccess} isNewDish />,
    )
    fireEvent.change(screen.getByLabelText("Nombre del plato"), { target: { value: "Mora" } })
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "5000" } })
    await pick("Subcategoría", "Jugos")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.createDish).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c-2", subcategoryId: "s-3" }))
  })

  it("changing the category clears the subcategory and asks to pick or clear one before saving", async () => {
    const onSuccess = vi.fn()
    render(
      <DishForm dish={{ ...dish, subcategoryId: "s-1" }} categories={twoCategories} subcategories={subcategories} onSuccess={onSuccess} />,
    )
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    await pick("Categoría", "Bebidas")

    expect(
      screen.getByText("Cambiaste la categoría: elige una subcategoría de Bebidas o «Sin subcategoría».", { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actualizar Plato" })).toBeDisabled()

    await pick("Subcategoría", "Sin subcategoría")
    expect(screen.getByRole("button", { name: "Actualizar Plato" })).toBeEnabled()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.updateDish).toHaveBeenCalledWith("d-1", expect.objectContaining({ categoryId: "c-2", subcategoryId: null }))
  })

  it("shows the API 422 message when the subcategory does not fit", async () => {
    catalog.updateDish.mockRejectedValue(new Error("La subcategoría no pertenece a la categoría del plato"))
    render(<DishForm dish={{ ...dish, subcategoryId: "s-1" }} categories={twoCategories} subcategories={subcategories} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByDisplayValue("Sopa")).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Actualizar Plato" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Error al guardar el plato: La subcategoría no pertenece a la categoría del plato",
        }),
      ),
    )
  })
})

describe("DishForm — modifier groups (F7)", () => {
  const block = () => screen.getByRole("region", { name: "Modificadores" })
  const attached = () =>
    within(within(block()).getByRole("list", { name: "Grupos del plato" }))
      .queryAllByRole("listitem")
      .map((li) => li.querySelector("[data-group-name]")?.textContent)
  const renderEdit = async (ids: string[]) => {
    catalog.fetchDishModifierGroups.mockResolvedValue(ids)
    const onSuccess = vi.fn()
    render(<DishForm dish={dish} categories={categories} onSuccess={onSuccess} />)
    await waitFor(() => expect(attached()).toEqual(ids.map((id) => modifierGroups.find((g) => g.id === id)!.name)))
    return onSuccess
  }
  const submit = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }))
    })
  }

  it("lists the dish groups in order with their rule, options and price range", async () => {
    await renderEdit(["g-term", "g-adic"])
    const rows = within(block()).getAllByRole("listitem")
    expect(rows[0]).toHaveTextContent("Obligatorio · elige 1 · 4 opciones")
    expect(rows[1]).toHaveTextContent("Opcional · hasta 3")
    expect(within(block()).getByRole("button", { name: "Subir Término" })).toBeDisabled()
    expect(within(block()).getByRole("button", { name: "Bajar Adiciones" })).toBeDisabled()
  })

  it("attaches, reorders and detaches groups, then saves them in that order", async () => {
    const onSuccess = await renderEdit(["g-term", "g-adic"])
    const picker = within(block()).getByLabelText("Agregar grupo")
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Elige un grupo…", "Sin"])

    fireEvent.change(picker, { target: { value: "g-sin" } })
    expect(attached()).toEqual(["Término", "Adiciones", "Sin"])
    fireEvent.click(within(block()).getByRole("button", { name: "Subir Sin" }))
    expect(attached()).toEqual(["Término", "Sin", "Adiciones"])
    fireEvent.click(within(block()).getByRole("button", { name: "Quitar Término del plato" }))
    expect(attached()).toEqual(["Sin", "Adiciones"])

    await submit("Actualizar Plato")
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.setDishModifierGroups).toHaveBeenCalledWith("d-1", ["g-sin", "g-adic"])
    expect(catalog.updateDish).toHaveBeenCalledWith("d-1", expect.not.objectContaining({ quickNotes: expect.anything() }))
  })

  it("does not rewrite the groups when they did not change", async () => {
    const onSuccess = await renderEdit(["g-term"])
    await submit("Actualizar Plato")
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.updateDish).toHaveBeenCalled()
    expect(catalog.setDishModifierGroups).not.toHaveBeenCalled()
  })

  it("attaches groups to a new dish once it exists", async () => {
    const onSuccess = vi.fn()
    render(<DishForm categories={categories} onSuccess={onSuccess} isNewDish />)
    const picker = await within(block()).findByLabelText("Agregar grupo")
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(4))
    fireEvent.change(picker, { target: { value: "g-adic" } })
    fireEvent.change(screen.getByLabelText("Nombre del plato"), { target: { value: "Combo" } })
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "28000" } })

    await submit("Crear Plato")
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(catalog.fetchDishModifierGroups).not.toHaveBeenCalled()
    expect(catalog.setDishModifierGroups).toHaveBeenCalledWith("d-2", ["g-adic"])
  })

  it("explains the empty block and leaves no quick-notes editor", async () => {
    await renderEdit([])
    expect(within(block()).getByText(/Sin modificadores/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Nueva nota rápida")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Notas rápidas" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Notas rápidas/)).not.toBeInTheDocument()
  })

  it("keeps every new control at least 44 px tall", async () => {
    await renderEdit(["g-term", "g-adic"])
    const controls = [...within(block()).getAllByRole("button"), within(block()).getByLabelText("Agregar grupo")]
    for (const control of controls) expect(control.className).toMatch(/\bmin-h-11\b|\bh-11\b/)
  })
})
