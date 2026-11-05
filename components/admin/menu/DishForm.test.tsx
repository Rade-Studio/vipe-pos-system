import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T7b (S4) — the dish form writes through the API with a camelCase body. */

const catalog = vi.hoisted(() => ({ createDish: vi.fn(), updateDish: vi.fn() }))
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

const categories = [{ id: "c-1", name: "Platos", description: null, icon: "Soup", active: true, createdAt: null, updatedAt: null }]
const dish = {
  id: "d-1",
  name: "Sopa",
  description: "Del día",
  price: 9000,
  categoryId: "c-1",
  imageUrl: "https://img/d-1.png",
  active: true,
  allowComments: true,
  createdAt: null,
  updatedAt: null,
}

beforeEach(() => {
  catalog.createDish.mockReset().mockResolvedValue({ id: "d-2" })
  catalog.updateDish.mockReset().mockResolvedValue(dish)
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
