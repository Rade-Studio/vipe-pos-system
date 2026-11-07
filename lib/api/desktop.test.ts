import { beforeEach, describe, expect, it, vi } from "vitest"

/** F5a — desktop devices through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { ApiError } from "./errors"
import {
  createDesktopPairingCode,
  listDesktopDevices,
  renameDesktopDevice,
  revokeDesktopDevice,
  type DesktopDeviceDto,
} from "./desktop"

const device: DesktopDeviceDto = {
  id: "d-1",
  name: "Caja PC",
  platform: "windows",
  appVersion: "1.0.0",
  createdAt: "2026-11-07T11:00:00.000Z",
  lastSeenAt: null,
  online: false,
  revokedAt: null,
  queue: { pending: 0, failed: 0 },
  printers: [],
}
const byId = (id: string) => ({ params: { path: { id } } })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: device })
})

describe("desktop device requests", () => {
  it("creates a pairing code", async () => {
    const code = { code: "481207", expiresAt: "2026-11-07T11:10:00.000Z" }
    api.POST.mockResolvedValueOnce({ data: code })
    await expect(createDesktopPairingCode()).resolves.toEqual(code)
    expect(api.POST).toHaveBeenCalledWith("/api/desktop/pairing-codes")
  })

  it("lists, renames and revokes devices", async () => {
    api.GET.mockResolvedValueOnce({ data: [device] })
    await expect(listDesktopDevices()).resolves.toEqual([device])
    expect(api.GET).toHaveBeenCalledWith("/api/desktop/devices")
    await expect(renameDesktopDevice("d-1", "Caja 1")).resolves.toEqual(device)
    expect(api.PATCH).toHaveBeenCalledWith("/api/desktop/devices/{id}", { ...byId("d-1"), body: { name: "Caja 1" } })
    api.DELETE.mockResolvedValueOnce({ data: undefined })
    await expect(revokeDesktopDevice("d-1")).resolves.toBeUndefined()
    expect(api.DELETE).toHaveBeenCalledWith("/api/desktop/devices/{id}", byId("d-1"))
  })

  it("fails on an empty response", async () => {
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(listDesktopDevices()).rejects.toBeInstanceOf(ApiError)
  })
})
