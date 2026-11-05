import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Printer tokens of the printing bridge (T8c), managed from Configuración
 * (T12). The plaintext token exists only in the create response.
 */

export type PrinterDevice = components["schemas"]["PrinterDevice"]
export type CreatedPrinterDevice = components["schemas"]["CreatedPrinterDevice"]

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const MESSAGES = {
  forbidden: "No tienes permiso para gestionar las impresoras",
  notFound: "La impresora no existe",
  unknown: "No se pudo completar la operación. Inténtalo de nuevo.",
} as const

/** Spanish UI text for a failed printer call (the API answers in English). */
export function printerErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return MESSAGES.forbidden
    if (error.status === 404) return MESSAGES.notFound
  }
  return MESSAGES.unknown
}

export async function listPrinters(): Promise<PrinterDevice[]> {
  return required((await api.GET("/api/devices/printers")).data)
}

export async function createPrinter(name: string): Promise<CreatedPrinterDevice> {
  return required((await api.POST("/api/devices/printers", { body: { name } })).data)
}

export async function revokePrinter(id: string): Promise<void> {
  await api.DELETE("/api/devices/printers/{id}", { params: { path: { id } } })
}
