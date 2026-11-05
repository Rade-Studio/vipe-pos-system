import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8b (S3, S4) — the admin tables panel reads and writes through the API
 * (`GET/POST/PATCH/DELETE /tables`) and merges the enriched `tables` events in
 * place: the event already carries `waiter_name`, so there is no per-event
 * read any more.
 */

const env = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; init?: any }[],
  deleteError: null as unknown,
}))

const tableDto = {
  id: "t-1",
  number: 1,
  status: "occupied",
  waiterId: "w-1",
  waiterName: "Ana",
  createdAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
}

vi.mock("@/lib/api/client", () => {
  const record = (method: string) => async (path: string, init?: any) => {
    env.calls.push({ method, path, init })
    if (method === "GET" && path === "/api/tables") return { data: [tableDto] }
    if (method === "DELETE" && env.deleteError) throw env.deleteError
    return { data: method === "DELETE" ? undefined : tableDto }
  }
  return {
    api: { GET: record("GET"), POST: record("POST"), PATCH: record("PATCH"), DELETE: record("DELETE") },
    onSessionRefreshed: () => () => {},
  }
})

// A stable `toast` reference matters here: the component's data-loading
// effect depends on `[toast]`, so a mock that returns a fresh function on
// every call would re-trigger the effect (and its setLoading(true)) forever.
const toastMock = vi.fn()
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}))

let capturedCallback: ((payload: unknown) => void) | null = null
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToTables: vi.fn((cb: (payload: unknown) => void) => {
      capturedCallback = cb
      return () => {}
    }),
  },
}))

import { ApiError } from "@/lib/api/errors"

// Radix Select needs layout APIs jsdom lacks.
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.releasePointerCapture = vi.fn()
import { TableManagementPanel } from "./TableManagementPanel"

beforeEach(() => {
  env.calls.length = 0
  env.deleteError = null
  toastMock.mockReset()
  capturedCallback = null
})

describe("TableManagementPanel — enriched events, no per-event read", () => {
  it("shows the new waiter's name from the event itself, without any request or reload", async () => {
    const { container } = render(<TableManagementPanel />)

    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument())
    expect(env.calls).toEqual([{ method: "GET", path: "/api/tables", init: undefined }])

    const rootBefore = container.firstElementChild
    expect(capturedCallback).not.toBeNull()

    // The API listener attaches `waiter_name` to every `tables` event.
    await act(async () => {
      capturedCallback?.({
        eventType: "UPDATE",
        new: {
          id: "t-1",
          number: 1,
          status: "occupied",
          waiter_id: "w-2",
          waiter_name: "Nueva Mesera",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
        old: { id: "t-1" },
      })
    })

    expect(screen.getByText("Nueva Mesera")).toBeInTheDocument()
    expect(screen.queryByText("Ana")).not.toBeInTheDocument()
    // No `GET` per event.
    expect(env.calls).toHaveLength(1)
    // The loading spinner never toggled: the same root node is on screen.
    expect(container.firstElementChild).toBe(rootBefore)
  })
})

describe("TableManagementPanel — writes through the API", () => {
  it("updates a table with PATCH /tables/:id, without client timestamps", async () => {
    render(<TableManagementPanel />)
    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Editar/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    })

    expect(env.calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        method: "PATCH",
        path: "/api/tables/{id}",
        init: { params: { path: { id: "t-1" } }, body: { number: 1, status: "occupied" } },
      },
    ])
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Mesa actualizada" }))
  })

  it("deletes with DELETE /tables/:id and shows the API's 409 message", async () => {
    env.deleteError = new ApiError(409, "Conflict", "Table has open orders")
    render(<TableManagementPanel />)
    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Eliminar/ }))
    })
    const confirm = screen.getAllByRole("button", { name: "Eliminar" }).at(-1)!
    await act(async () => {
      fireEvent.click(confirm)
    })

    expect(env.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/tables/{id}", init: { params: { path: { id: "t-1" } } } },
    ])
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No se puede eliminar", description: "Table has open orders" }),
    )
  })
})

describe("TableManagementPanel — edit dialog statuses", () => {
  it("sends served (a table status) when Servida is chosen", async () => {
    render(<TableManagementPanel />)
    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Editar/ }))
    })
    const native = document.querySelector("select") as HTMLSelectElement | null
    if (native) {
      await act(async () => {
        fireEvent.change(native, { target: { value: "served" } })
      })
    } else {
      await act(async () => {
        fireEvent.click(screen.getByRole("combobox"))
      })
      await act(async () => {
        fireEvent.click(await screen.findByRole("option", { name: "Servida" }))
      })
    }
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    })

    const patch = env.calls.find((call) => call.method === "PATCH")
    expect(patch?.init.body).toEqual({ number: 1, status: "served" })
  })
})
