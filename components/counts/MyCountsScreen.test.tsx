import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  const count = {
    id: "c1", number: 15, locationId: "loc1", locationName: "Bodega principal", stage: "counting", notes: null,
    createdAt: "2026-11-12T10:00:00Z", submittedAt: null, linesCount: 3, countedLines: 1, recountLines: 0,
  }
  // Extra fields a buggy server could leak: the screen must never show them.
  const line = (id: string, name: string, counted: number | null) => ({
    id, itemId: `i-${id}`, itemName: name, sku: `MP-${id}`, unit: "kg", countedQuantity: counted, recount: false, expectedQuantity: 987,
  })
  return {
    setCounted: mutation(),
    submit: mutation(),
    counts: [count],
    detail: { ...count, lines: [line("l1", "Tomate", 8), line("l2", "Cebolla", null), line("l3", "Papa", null)] },
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/hooks/counts/use-counts", () => ({
  useMyCounts: () => ({ data: h.counts, isLoading: false }),
  useMyCount: (id: string | null) => ({ data: id ? h.detail : undefined, isLoading: false }),
  useSetMyCountedQuantity: () => h.setCounted,
  useSubmitMyCount: () => h.submit,
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { AssignedCountsEntry } from "./AssignedCountsEntry"

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
import { MyCountsScreen } from "./MyCountsScreen"

beforeEach(() => {
  h.setCounted.mutateAsync.mockReset().mockResolvedValue(undefined)
  h.submit.mutateAsync.mockReset().mockResolvedValue(undefined)
})

const openCount = () => {
  render(<MyCountsScreen />)
  fireEvent.click(screen.getByRole("button", { name: /Conteo #15/ }))
}

describe("MyCountsScreen", () => {
  it("never renders the expected stock", () => {
    openCount()
    expect(screen.getByText("Tomate")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("987")
    expect(document.body).not.toHaveTextContent(/esperado|sistema dice/i)
  })

  it("shows the progress, saves a count and 'No hay (0)'", async () => {
    openCount()
    expect(screen.getByText("1 de 3")).toBeInTheDocument()
    const onion = screen.getByLabelText("Cantidad contada de Cebolla en kg")
    fireEvent.change(onion, { target: { value: "4,5" } })
    await act(async () => {
      fireEvent.blur(onion)
    })
    expect(h.setCounted.mutateAsync).toHaveBeenCalledWith({ countId: "c1", lineId: "l2", countedQuantity: 4.5 })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "No hay (0) Papa" }))
    })
    expect(h.setCounted.mutateAsync).toHaveBeenCalledWith({ countId: "c1", lineId: "l3", countedQuantity: 0 })
    expect(screen.getByText("3 de 3")).toBeInTheDocument()
  })

  it("'Enviar a revisión' waits for every line and then submits", async () => {
    openCount()
    const send = screen.getByRole("button", { name: "Enviar a revisión" })
    expect(send).toBeDisabled()
    for (const name of ["Cebolla", "Papa"]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `No hay (0) ${name}` }))
      })
    }
    expect(send).toBeEnabled()
    await act(async () => {
      fireEvent.click(send)
    })
    expect(h.submit.mutateAsync).toHaveBeenCalledWith("c1")
  })
})

describe("AssignedCountsEntry", () => {
  it("shows 'Conteos asignados (N)' only with counts assigned", () => {
    const { unmount } = render(<AssignedCountsEntry />, { wrapper })
    expect(screen.getByRole("button", { name: "Conteos asignados (1)" })).toBeInTheDocument()
    unmount()
    h.counts.splice(0)
    render(<AssignedCountsEntry />, { wrapper })
    expect(screen.queryByRole("button", { name: /Conteos asignados/ })).toBeNull()
  })
})
