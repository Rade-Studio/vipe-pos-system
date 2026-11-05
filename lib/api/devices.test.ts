import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2) — printer tokens of the T8c bridge, managed by the admin. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { ApiError } from "./errors"
import { createPrinter, listPrinters, printerErrorMessage, revokePrinter } from "./devices"

const printer = { id: "pr-1", name: "Cocina", createdAt: "2026-11-04T00:00:00.000Z", revokedAt: null, lastSeenAt: null }

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: undefined })
})

describe("printer devices", () => {
  it("lists, creates with the plaintext token once and revokes by id", async () => {
    api.GET.mockResolvedValueOnce({ data: [printer] })
    await expect(listPrinters()).resolves.toEqual([printer])
    expect(api.GET).toHaveBeenCalledWith("/api/devices/printers")

    api.POST.mockResolvedValueOnce({ data: { ...printer, token: "plain-token" } })
    await expect(createPrinter("Cocina")).resolves.toEqual({ ...printer, token: "plain-token" })
    expect(api.POST).toHaveBeenCalledWith("/api/devices/printers", { body: { name: "Cocina" } })

    await revokePrinter("pr-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/devices/printers/{id}", { params: { path: { id: "pr-1" } } })
  })

describe("printerErrorMessage (item 10)", () => {
  it("maps the English API errors by status to Spanish", () => {
    expect(printerErrorMessage(new ApiError(403, "Forbidden", "Insufficient role"))).toBe(
      "No tienes permiso para gestionar las impresoras",
    )
    expect(printerErrorMessage(new ApiError(404, "Not Found", "Not found"))).toBe("La impresora no existe")
    expect(printerErrorMessage(new ApiError(500, "Internal Server Error", "boom"))).toBe(
      "No se pudo completar la operación. Inténtalo de nuevo.",
    )
    expect(printerErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "No se pudo completar la operación. Inténtalo de nuevo.",
    )
  })
})
})
