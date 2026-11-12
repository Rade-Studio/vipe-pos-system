import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"
import { inventoryKeys } from "@/lib/inventory/query-keys"

const api = vi.hoisted(() => ({
  producePreparations: vi.fn(),
  createProductionTemplate: vi.fn(),
  listLots: vi.fn(),
}))
vi.mock("@/lib/api/inventory", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

import { ProductionShortageError, useCreateProductionTemplate, useProducePreparations } from "./use-inventory-mutations"
import { productionTemplatesKey, useStockAtLocation } from "./use-inventory-queries"

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const spy = vi.spyOn(client, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, spy }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
})

describe("useProducePreparations", () => {
  it("turns the 422 details into shortages per preparation", async () => {
    const details = JSON.stringify([
      { item_id: "salsa", name: "Salsa", ingredients: [{ ingredient_id: "t", name: "Tomate", unit: "kg", required: 3, available: 1, missing: 2 }] },
    ])
    api.producePreparations.mockRejectedValue(new ApiError(422, "Unprocessable", "produce_preparations: insufficient stock", { code: "P0001", details }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useProducePreparations(), { wrapper })
    let error: unknown
    await act(async () => {
      error = await result.current.mutateAsync({ lines: [{ itemId: "salsa", quantity: 2 }] }).catch((e) => e)
    })
    expect(error).toBeInstanceOf(ProductionShortageError)
    expect((error as ProductionShortageError).prepShortages[0]).toMatchObject({ itemId: "salsa", ingredients: [{ ingredientId: "t", missing: 2 }] })
  })

  it("refreshes items and batches on success", async () => {
    api.producePreparations.mockResolvedValue({ batches: [], totalCost: 0 })
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useProducePreparations(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ lines: [{ itemId: "salsa", quantity: 2 }] })
    })
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey)
    expect(keys).toContainEqual(inventoryKeys.items())
    expect(keys).toContainEqual(inventoryKeys.batches())
  })
})

describe("useCreateProductionTemplate", () => {
  it("maps 409 to the duplicate-name message", async () => {
    api.createProductionTemplate.mockRejectedValue(new ApiError(409, "Conflict", "duplicate"))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateProductionTemplate(), { wrapper })
    let error: unknown
    await act(async () => {
      error = await result.current.mutateAsync({ name: "Lunes", lines: [] }).catch((e) => e)
    })
    expect((error as Error).message).toBe("Ya existe una plantilla con ese nombre")
  })

  it("refreshes the templates on success", async () => {
    api.createProductionTemplate.mockResolvedValue({ id: "t1" })
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useCreateProductionTemplate(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: "Lunes", lines: [{ itemId: "a", quantity: 1 }] })
    })
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(productionTemplatesKey)
  })
})

describe("useStockAtLocation", () => {
  it("sums each ingredient's lots at the location", async () => {
    api.listLots.mockImplementation(async (id: string) =>
      id === "t"
        ? [{ locationId: "a", quantity: 2 }, { locationId: "b", quantity: 7 }]
        : [{ locationId: "a", quantity: 1 }],
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useStockAtLocation(["t", "c"], "a"), { wrapper })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect([...(result.current as Map<string, number>)]).toEqual([["t", 2], ["c", 1]])
  })

  it("is null without a location", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useStockAtLocation(["t"], ""), { wrapper })
    expect(result.current).toBeNull()
  })
})
