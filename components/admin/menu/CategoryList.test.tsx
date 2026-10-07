import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

const state = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const calls: { table: string; method: string; args: unknown[] }[] = []
  const results: Record<string, Result> = {}
  const deleted: { table: string; args: unknown[] }[] = []

  const makeChain = (table: string): any => {
    const chain: any = {}
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
    for (const method of ["select", "in", "eq", "order", "limit", "not"]) {
      chain[method] = record(method)
    }
    chain.delete = (...args: unknown[]) => {
      calls.push({ table, method: "delete", args })
      return chain
    }
    chain.insert = (...args: unknown[]) => {
      calls.push({ table, method: "insert", args })
      return chain
    }
    chain.update = (...args: unknown[]) => {
      calls.push({ table, method: "update", args })
      return chain
    }
    chain.then = (resolve: (value: Result) => unknown) => {
      if (table === "categories" && chain.__delete) {
        deleted.push({ table, args: [] })
      }
      return Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
    }
    return chain
  }

  return { calls, results, deleted, makeChain }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: (table: string) => state.makeChain(table) },
  createSupabaseClient: () => ({ from: (table: string) => state.makeChain(table) }),
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { CategoryList } from "./CategoryList"

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

function categorySelects() {
  return state.calls.filter((call) => call.table === "categories" && call.method === "select")
}

beforeEach(() => {
  queryClient.clear()
  state.calls.length = 0
  state.deleted.length = 0
  for (const key of Object.keys(state.results)) delete state.results[key]
  state.results.categories = {
    data: [
      { id: "c-1", name: "Entradas", description: "Para empezar", icon: "Coffee", active: true },
      { id: "c-2", name: "Postres", description: null, icon: null, active: false },
    ],
    error: null,
  }
  state.results.dishes = { data: [], error: null }
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
    state.results.categories = { data: [], error: null }
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
    expect(state.calls.some((call) => call.table === "categories" && call.method === "delete")).toBe(true)
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Categoría eliminada" }),
    )
  })

  it("still refuses to delete a category that has dishes, and does not invalidate", async () => {
    state.results.dishes = { data: [{ id: "d-1" }], error: null }
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
        expect.objectContaining({ title: "Error", variant: "destructive" }),
      ),
    )
    expect(categorySelects()).toHaveLength(1)
  })
})