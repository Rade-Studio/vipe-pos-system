import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T7b (S4) — the dish form writes through the API with a camelCase body. */

const catalog = vi.hoisted(() => ({ createDish: vi.fn(), updateDish: vi.fn() }))
vi.mock("@/lib/api/catalog", () => catalog)
vi.mock("@/lib/supabase/storage-service", () => ({
  storageService: {
    isImageAccessible: vi.fn(async () => true),
    getPlaceholderUrl: () => "/placeholder.svg",
    deleteImage: vi.fn(async () => undefined),
  },
}))
vi.mock("@/components/ui/image-upload", () => ({ ImageUpload: () => null }))
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
})

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
})
