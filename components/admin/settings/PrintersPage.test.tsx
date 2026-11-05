import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2) — printer tokens: list, create (token shown once), revoke with confirmation. */

const devices = vi.hoisted(() => ({ listPrinters: vi.fn(), createPrinter: vi.fn(), revokePrinter: vi.fn() }))
vi.mock("@/lib/api/devices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/devices")>()),
  ...devices,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { ApiError } from "@/lib/api/errors"
import { PrintersPage } from "./PrintersPage"

const active = { id: "pr-1", name: "Cocina", createdAt: "2026-11-01T10:00:00.000Z", revokedAt: null, lastSeenAt: null }
const revoked = {
  id: "pr-2",
  name: "Barra",
  createdAt: "2026-10-01T10:00:00.000Z",
  revokedAt: "2026-10-02T10:00:00.000Z",
  lastSeenAt: "2026-10-02T09:00:00.000Z",
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PrintersPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  devices.listPrinters.mockReset().mockResolvedValue([active, revoked])
  devices.createPrinter.mockReset().mockResolvedValue({ ...active, id: "pr-3", name: "Caja", token: "tok-plain-123" })
  devices.revokePrinter.mockReset().mockResolvedValue(undefined)
  toastMock.mockClear()
})

describe("PrintersPage", () => {
  it("lists name, revoked state and never-seen printers", async () => {
    renderPage()
    expect(await screen.findByText("Cocina")).toBeInTheDocument()
    expect(screen.getByText("Barra")).toBeInTheDocument()
    expect(screen.getByText("Revocada")).toBeInTheDocument()
    expect(screen.getByText("Nunca")).toBeInTheDocument()
  })

  it("creates a printer and shows its token once with a copy button and a warning", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderPage()
    await screen.findByText("Cocina")

    fireEvent.click(screen.getByRole("button", { name: "Nueva impresora" }))
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Caja" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    })

    expect(devices.createPrinter).toHaveBeenCalledWith("Caja")
    expect(await screen.findByText("tok-plain-123")).toBeInTheDocument()
    expect(screen.getByText(/no se volverá a mostrar/i)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar token" }))
    })
    expect(writeText).toHaveBeenCalledWith("tok-plain-123")

    fireEvent.click(screen.getByRole("button", { name: "Listo" }))
    await waitFor(() => expect(screen.queryByText("tok-plain-123")).toBeNull())
  })

  it("revokes only after confirmation", async () => {
    renderPage()
    await screen.findByText("Cocina")

    fireEvent.click(screen.getByRole("button", { name: "Revocar Cocina" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(devices.revokePrinter).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Revocar" }))
    })
    expect(devices.revokePrinter).toHaveBeenCalledWith("pr-1")
  })

  it("never shows the token again after Listo and reopening (item 6)", async () => {
    renderPage()
    await screen.findByText("Cocina")
    fireEvent.click(screen.getByRole("button", { name: "Nueva impresora" }))
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Caja" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    })
    await screen.findByText("tok-plain-123")
    fireEvent.click(screen.getByRole("button", { name: "Listo" }))
    await waitFor(() => expect(screen.queryByText("tok-plain-123")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Nueva impresora" }))
    expect(await screen.findByLabelText("Nombre")).toBeInTheDocument()
    expect(screen.queryByText("tok-plain-123")).toBeNull()
  })

  it("shows Spanish text for a refused revoke (item 10)", async () => {
    devices.revokePrinter.mockRejectedValueOnce(new ApiError(404, "Not Found", "Not found"))
    renderPage()
    await screen.findByText("Cocina")
    fireEvent.click(screen.getByRole("button", { name: "Revocar Cocina" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Revocar" }))
    })
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "La impresora no existe", variant: "destructive" }),
      ),
    )
  })
})
