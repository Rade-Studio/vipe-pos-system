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

import { StaffServiceError } from "@/lib/api/staff"
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
})
