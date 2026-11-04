import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"
import { queryClient } from "@/lib/queryClient"

/**
 * T9 (S1) — a Configuración sub-tab list.
 *
 * `CategoryList` read `categories` from a `useEffect` on mount, into local
 * state. Radix unmounts an inactive `TabsContent`, so every visit to the Menú
 * tab re-read it and re-rendered "Cargando categorías...". It is now a query
 * keyed on the shared `catalogKeys.categories` slot (the same slot `DishList`
 * reads, which is why the Menú tab used to fetch `categories` twice per visit),
 * and a mutation invalidates exactly that key.
 */

const catalog = vi.hoisted(() => ({
  categories: [] as unknown[],
  fetchCategories: vi.fn(),
  deleteCategory: vi.fn(),
}))

// T7b: the list reads and deletes through the API module, never Supabase.
vi.mock("@/lib/api/catalog", () => ({
  fetchCategories: catalog.fetchCategories,
  deleteCategory: catalog.deleteCategory,
  fetchDishes: vi.fn(async () => []),
  fetchPromotions: vi.fn(async () => []),
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { CategoryList } from "./CategoryList"

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

function categorySelects() {
  return catalog.fetchCategories.mock.calls
}

beforeEach(() => {
  queryClient.clear()
  catalog.fetchCategories.mockReset().mockImplementation(async () => catalog.categories)
  catalog.deleteCategory.mockReset().mockResolvedValue(undefined)
  toastMock.mockClear()
  catalog.categories = [
    { id: "c-1", name: "Entradas", description: "Para empezar", icon: "Coffee", active: true },
    { id: "c-2", name: "Postres", description: null, icon: null, active: false },
  ]
})

describe("CategoryList — cached list, invalidated by its own mutations", () => {
  it("reads categories once and serves a sub-tab revisit from cache, without blanking", async () => {
    const first = render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())
    expect(categorySelects()).toHaveLength(1)

    first.unmount()
    render(wrap(<CategoryList />))

    // Synchronously: rows, not the loading text.
    expect(screen.getByText("Entradas")).toBeInTheDocument()
    expect(screen.queryByText("Cargando categorías...")).not.toBeInTheDocument()
    expect(categorySelects()).toHaveLength(1)
  })

  it("still filters by the search box", async () => {
    render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText("Buscar categorías..."), { target: { value: "post" } })

    expect(screen.queryByText("Entradas")).not.toBeInTheDocument()
    expect(screen.getByText("Postres")).toBeInTheDocument()
  })

  it("still shows the empty state when the list is empty", async () => {
    catalog.categories = []
    render(wrap(<CategoryList />))

    await waitFor(() => expect(screen.getByText("No hay categorías registradas")).toBeInTheDocument())
  })

  it("still shows the search-miss message", async () => {
    render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText("Buscar categorías..."), { target: { value: "zzz" } })

    expect(screen.getByText("No se encontraron categorías con ese término de búsqueda")).toBeInTheDocument()
  })

  it("re-reads the categories after a delete (the key is invalidated, not the whole screen)", async () => {
    render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())

    const row = screen.getByText("Entradas").closest("tr") as HTMLElement
    await act(async () => {
      fireEvent.click(row.querySelectorAll("button")[1])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })

    await waitFor(() => expect(categorySelects()).toHaveLength(2))
    expect(catalog.deleteCategory).toHaveBeenCalledWith("c-1")
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Categoría eliminada" }),
    )
  })

  it("shows the API's 409 message when the category has dishes, and does not invalidate", async () => {
    catalog.deleteCategory.mockRejectedValue(new ApiError(409, "Conflict", "Category has dishes"))
    render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())

    const row = screen.getByText("Entradas").closest("tr") as HTMLElement
    await act(async () => {
      fireEvent.click(row.querySelectorAll("button")[1])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error",
          variant: "destructive",
          description: "No se puede eliminar la categoría porque tiene platos asociados. (Category has dishes)",
        }),
      ),
    )
    expect(catalog.deleteCategory).toHaveBeenCalledWith("c-1")
    expect(categorySelects()).toHaveLength(1)
  })

  it("refreshes the POS and delivery menus after a delete", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    render(wrap(<CategoryList />))
    await waitFor(() => expect(screen.getByText("Entradas")).toBeInTheDocument())

    const row = screen.getByText("Entradas").closest("tr") as HTMLElement
    await act(async () => {
      fireEvent.click(row.querySelectorAll("button")[1])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    })

    await waitFor(() => expect(catalog.deleteCategory).toHaveBeenCalled())
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(
      expect.arrayContaining([
        ["catalog", "menu", "categories"],
        ["menu"],
        ["delivery-menu-categories"],
        ["delivery-menu-dishes"],
      ]),
    )
    spy.mockRestore()
  })
})
