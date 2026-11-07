import type { DesktopDeviceDto, DesktopDevicePrinterDto } from "@/lib/api/desktop"
import type { StationDto } from "@/lib/api/stations"

/**
 * Pure helpers of Ajustes → Estación de impresión (F5a web,
 * design/estacion-impresion-web/01-pagina-secciones.html). Everything shown
 * comes from GET /api/desktop/devices and the stations API.
 */

/** `481207` → `["481", "207"]`. */
export const codeGroups = (code: string): [string, string] => [code.slice(0, 3), code.slice(3)]

/** Milliseconds left → `m:ss`, never negative. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const s = total % 60
  return `${Math.floor(total / 60)}:${s < 10 ? "0" : ""}${s}`
}

/** Time since an ISO instant: `12 s`, `6 min`, `3 h`, `2 días`. */
export function sinceLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86_400) return `${Math.floor(s / 3600)} h`
  const d = Math.floor(s / 86_400)
  return `${d} ${d === 1 ? "día" : "días"}`
}

const CONNECTION: Record<DesktopDevicePrinterDto["connection"], string> = { usb: "USB", network: "Red", bluetooth: "Bluetooth" }
export const connectionLabel = (connection: DesktopDevicePrinterDto["connection"]) => CONNECTION[connection]

/** Revoked computers stay in the API list; the page hides them. */
export const visibleDevices = (devices: DesktopDeviceDto[]) => devices.filter((device) => !device.revokedAt)

/** The first live device whose id was not in the list when the code was generated. */
export const newDevice = (devices: DesktopDeviceDto[], known: ReadonlySet<string>) =>
  visibleDevices(devices).find((device) => !known.has(device.id))

/** Names of the stations a device's printers serve, once each, in station order. */
export function stationNames(device: DesktopDeviceDto, stations: Pick<StationDto, "id" | "name">[]): string[] {
  const served = new Set(device.printers.flatMap((printer) => printer.stationIds))
  return stations.filter((station) => served.has(station.id)).map((station) => station.name)
}

/** `["Cocina"]` → `Cocina`; `["Cocina", "Postres", "Barra"]` → `Cocina, Postres y Barra`. */
export function joinStations(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}
