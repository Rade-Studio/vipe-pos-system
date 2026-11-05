import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2, S4) — the staff list reads and deletes through `/api/staff`. */

const staff = vi.hoisted(() => ({ listStaff: vi.fn(), deleteStaff: vi.fn() }))
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  ...staff,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

// The Overview "Meseros activos" panel reads the shell's waiter directory.
const tables = vi.hoisted(() => ({ getWaiters: vi.fn() }))
vi.mock("@/lib/api/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/tables")>()),
  ...tables,
}))
// The form posts on its own (WaiterForm.test.tsx); here it only reports a save.
vi.mock("./WaiterForm", () => ({
  WaiterForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Guardar
    </button>
  ),
}))

import { StaffServiceError } from "@/lib/api/staff"
import { useProfileStore } from "@/store/useProfileStore"
import { WaiterList } from "./WaiterList"

const member = (id: string, role: string, fullName: string) => ({
  id,
  userId: `u-${id}`,
  fullName,
  username: fullName.toLowerCase(),
  email: `${id}@vipe.local`,
  role,
  active: true,
  createdAt: "2026-11-04T00:00:00.000Z",
})

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WaiterList />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  staff.listStaff.mockReset().mockResolvedValue([member("p-0", "admin", "Jefa"), member("p-1", "waiter", "Ana")])
  staff.deleteStaff.mockReset().mockResolvedValue(undefined)
  toastMock.mockClear()
  tables.getWaiters.mockReset().mockResolvedValue([])
  useProfileStore.setState({ profiles: [{ id: "p-1", name: "Ana", role: "waiter" }] })
})

async function deleteAna() {
  await waitFor(() => expect(screen.getAllByText("Ana").length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }))
  })
}

describe("WaiterList", () => {
  it("lists the managed roles only (admins are not shown)", async () => {
    renderList()
    await waitFor(() => expect(screen.getAllByText("Ana").length).toBeGreaterThan(0))
    expect(screen.queryByText("Jefa")).toBeNull()
  })

  it("deletes through DELETE /staff/:id", async () => {
    renderList()
    await deleteAna()
    expect(staff.deleteStaff).toHaveBeenCalledWith("p-1")
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Integrante eliminado" }))
  })

  it("shows the 422 text when the member still has tables", async () => {
    staff.deleteStaff.mockRejectedValueOnce(new StaffServiceError("invalid", "El integrante tiene mesas asignadas"))
    renderList()
    await deleteAna()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: "El integrante tiene mesas asignadas", variant: "destructive" }),
    )
  })

  it("refreshes the shell waiter directory after a delete (S3)", async () => {
    renderList()
    await deleteAna()
    await waitFor(() => expect(useProfileStore.getState().profiles).toEqual([]))
  })

  it("refreshes the shell waiter directory after a create or (de)activation (S3)", async () => {
    tables.getWaiters.mockResolvedValue([{ id: "p-2", name: "Luis", username: "luis" }])
    renderList()
    fireEvent.click(await screen.findByRole("button", { name: /Agregar personal/ }))
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Guardar" }))
    })
    await waitFor(() =>
      expect(useProfileStore.getState().profiles).toEqual([
        expect.objectContaining({ id: "p-2", name: "Luis", role: "waiter" }),
      ]),
    )
  })

  it("keeps the directory when the refresh fails (previous behaviour)", async () => {
    tables.getWaiters.mockRejectedValue(new Error("offline"))
    renderList()
    await deleteAna()
    expect(staff.deleteStaff).toHaveBeenCalledWith("p-1")
    expect(useProfileStore.getState().profiles).toEqual([{ id: "p-1", name: "Ana", role: "waiter" }])
  })
})
