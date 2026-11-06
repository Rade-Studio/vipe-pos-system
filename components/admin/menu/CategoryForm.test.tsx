import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T7b (S4) — the API requires an icon name. The form must ask the user for
 * one instead of silently sending a default.
 */

const catalog = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalog)
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { CategoryForm } from "./CategoryForm"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  catalog.createCategory.mockReset()
  catalog.updateCategory.mockReset()
  toastMock.mockClear()
})

describe("CategoryForm", () => {
  it("requires an icon and sends nothing when none is selected", async () => {
    render(<CategoryForm onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText("Nombre de la categoría"), { target: { value: "Bebidas" } })

    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Crear" }).closest("form") as HTMLFormElement)
    })

    await waitFor(() => expect(screen.getByText("Selecciona un icono")).toBeInTheDocument())
    expect(catalog.createCategory).not.toHaveBeenCalled()
  })

  it("sends the chosen icon as is when editing", async () => {
    catalog.updateCategory.mockResolvedValue({})
    const category = {
      id: "c-1",
      name: "Bebidas",
      description: null,
      icon: "Coffee",
      active: true,
      sortOrder: 0,
      color: "neutral" as const,
      hasSubcategories: false,
      createdAt: null,
      updatedAt: null,
    }
    render(<CategoryForm category={category} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText("Nombre de la categoría")).toHaveValue("Bebidas"))

    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Actualizar" }).closest("form") as HTMLFormElement)
    })

    await waitFor(() => expect(catalog.updateCategory).toHaveBeenCalledTimes(1))
    expect(catalog.updateCategory).toHaveBeenCalledWith("c-1", {
      name: "Bebidas",
      description: null,
      icon: "Coffee",
      active: true,
      color: "neutral",
    })
  })

  it("offers the closed colour set as labelled swatches and sends the pick (T9 redesign)", async () => {
    catalog.updateCategory.mockResolvedValue({})
    const category = {
      id: "c-1",
      name: "Bebidas",
      description: null,
      icon: "Coffee",
      active: true,
      sortOrder: 0,
      color: "sky" as const,
      hasSubcategories: false,
      createdAt: null,
      updatedAt: null,
    }
    render(<CategoryForm category={category} onSuccess={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole("radio", { name: "Cielo" })).toBeChecked())

    const group = screen.getByRole("radiogroup", { name: "Color" })
    expect(Array.from(group.querySelectorAll("[role=radio]")).map((r) => r.getAttribute("aria-label"))).toEqual([
      "Neutro",
      "Amarillo",
      "Naranja",
      "Cielo",
      "Violeta",
      "Esmeralda",
      "Rosa",
    ])

    fireEvent.click(screen.getByRole("radio", { name: "Esmeralda" }))
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Actualizar" }).closest("form") as HTMLFormElement)
    })

    await waitFor(() => expect(catalog.updateCategory).toHaveBeenCalledWith("c-1", expect.objectContaining({ color: "emerald" })))
  })
})

describe("CategoryForm — tile name hint (T27, L19 e)", () => {
  it("shows a live n/22 count and a soft warning above 22, without blocking the save", async () => {
    catalog.createCategory.mockResolvedValue({})
    render(<CategoryForm onSuccess={vi.fn()} />)
    const name = screen.getByPlaceholderText("Nombre de la categoría")

    expect(screen.getByText("0/22")).toBeInTheDocument()
    fireEvent.change(name, { target: { value: "Bebidas" } })
    expect(screen.getByText("7/22")).toBeInTheDocument()
    expect(screen.queryByText(/puede cortarse/)).not.toBeInTheDocument()

    fireEvent.change(name, { target: { value: "Bebidas calientes y frías" } })
    expect(screen.getByText("25/22")).toBeInTheDocument()
    expect(screen.getByText("Más de 22 caracteres: puede cortarse en el botón del mesero.")).toBeInTheDocument()
    expect(name).not.toHaveAttribute("maxLength")
  })
})
