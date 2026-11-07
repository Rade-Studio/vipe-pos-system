import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * VIPE desktop app devices through the API (F5a, odd/tasks/fase3-operacion.md
 * L34), for Ajustes → Estación de impresión: the admin generates a 6-digit
 * pairing code (valid 10 minutes, single use), lists the paired computers
 * with their printers and queue, renames and revokes them. A revoked device
 * stays in the list (`revokedAt`). Refusals carry `code` and a Spanish
 * message in `ApiError` (404 `device_not_found`).
 */

type Schemas = components["schemas"]
export type DesktopPairingCodeDto = Schemas["PairingCode"]
export type DesktopDeviceDto = Schemas["DesktopDevice"]
export type DesktopDevicePrinterDto = Schemas["AdminDesktopPrinter"]

export const DESKTOP_DEVICES_QUERY_KEY = ["desktop", "devices"] as const

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

export async function createDesktopPairingCode(): Promise<DesktopPairingCodeDto> {
  const { data } = await api.POST("/api/desktop/pairing-codes")
  return required(data)
}

/** Newest first, revoked devices included. */
export async function listDesktopDevices(): Promise<DesktopDeviceDto[]> {
  const { data } = await api.GET("/api/desktop/devices")
  return required(data)
}

export async function renameDesktopDevice(id: string, name: string): Promise<DesktopDeviceDto> {
  const { data } = await api.PATCH("/api/desktop/devices/{id}", { ...byId(id), body: { name } })
  return required(data)
}

/** Idempotent; the computer answers 401 device_revoked from its next call. */
export async function revokeDesktopDevice(id: string): Promise<void> {
  await api.DELETE("/api/desktop/devices/{id}", byId(id))
}
