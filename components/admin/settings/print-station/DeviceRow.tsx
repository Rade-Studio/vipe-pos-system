"use client"

import { AlertTriangle, Pencil, Printer, Unlink, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { connectionLabel, joinStations, sinceLabel, stationNames } from "@/lib/admin/print-station"
import type { DesktopDeviceDto } from "@/lib/api/desktop"
import type { StationDto } from "@/lib/api/stations"
import { cn } from "@/lib/utils"
import { STATION_STYLE } from "../stations/station-style"

const CHIP = "inline-flex h-[26px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-medium"
const OK = "border-status-ok-line bg-status-ok-bg text-status-ok-fg"
const GREY = "border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg"
const WARN = "border-status-warning-line bg-status-warning-bg text-status-warning-fg"
const DANGER = "border-status-danger-line bg-status-danger-bg text-status-danger-fg"

/**
 * Shared grid of the header and the rows (design `.tr.pc`, its ≤ 1200 px
 * variant: the settings column is max-w-4xl). On lg the queue and actions sit
 * under the name in the first column, so a tall printers cell leaves no gap.
 */
export const DEVICE_GRID = "grid grid-cols-1 gap-2 px-[18px] lg:grid-cols-[minmax(0,1fr)_170px_minmax(0,1.6fr)] lg:gap-3"

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })

interface DeviceRowProps {
  device: DesktopDeviceDto
  stations: StationDto[]
  now: number
  onRename: (device: DesktopDeviceDto) => void
  onRevoke: (device: DesktopDeviceDto) => void
}

/** One connected computer: name, state, printers with their stations, queue, actions. */
export function DeviceRow({ device, stations, now, onRename, onRevoke }: DeviceRowProps) {
  const byId = new Map(stations.map((station) => [station.id, station]))
  const served = stationNames(device, stations)
  const pending = device.queue.pending ?? 0
  const failed = device.queue.failed ?? 0
  return (
    <div role="row" className={cn(DEVICE_GRID, "items-start border-b border-line py-3.5 last:border-b-0 lg:grid-rows-[auto_auto_1fr]")}>
      <span role="cell" className="min-w-0 lg:col-start-1 lg:row-start-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="truncate">{device.name}</b>
          <Button variant="ghost" size="icon" className="h-11 w-11 flex-none rounded-full" aria-label={`Cambiar nombre de ${device.name}`} onClick={() => onRename(device)}>
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        </span>
        <span className="block text-[12.5px] text-muted-fg">Windows · VIPE {device.appVersion}</span>
      </span>
      <span role="cell" className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        {device.online ? (
          <span className={cn(CHIP, OK)}>
            <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
            En línea
          </span>
        ) : (
          <span className={cn(CHIP, WARN)}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {device.lastSeenAt ? `Sin señal hace ${sinceLabel(device.lastSeenAt, now)}` : "Sin señal"}
          </span>
        )}
        {device.lastSeenAt && (
          <small className="mt-1 block text-xs text-muted-fg">
            {device.online ? `Última señal hace ${sinceLabel(device.lastSeenAt, now)}` : `No responde desde las ${time(device.lastSeenAt)}`}
          </small>
        )}
      </span>
      <span role="cell" className="min-w-0 lg:col-start-3 lg:row-span-3 lg:row-start-1">
        {device.printers.length === 0 ? (
          <span className="text-[13px] text-muted-fg">Sin impresoras reportadas</span>
        ) : (
          <ul className="grid gap-2">
            {device.printers.map((printer) => (
              <li key={printer.id} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5">
                <Printer className="h-[18px] w-[18px] flex-none text-muted-fg" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px]">{printer.model || printer.name}</b>
                  <small className="block text-[12.5px] text-muted-fg">{`${connectionLabel(printer.connection)} · ${printer.paperMm} mm`}</small>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {printer.hasDrawer && <span className={cn(CHIP, OK)}>Cajón</span>}
                  {printer.stationIds.map((id) => {
                    const station = byId.get(id)
                    return station ? (
                      <span key={id} className={cn(CHIP, STATION_STYLE[station.color]?.chip ?? GREY)}>{station.name}</span>
                    ) : null
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!device.online && served.length > 0 && (
          <p className={cn("mt-2 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]", WARN)}>
            <AlertTriangle className="mt-px h-4 w-4 flex-none" aria-hidden />
            <span className="min-w-0 flex-1">
              {`Si este computador está apagado o sin internet, las comandas de ${joinStations(served)} esperan en su cola hasta que vuelva.`}
            </span>
          </p>
        )}
      </span>
      <span role="cell" className="flex flex-wrap gap-1.5 lg:col-start-1 lg:row-start-2">
        {pending === 0 && failed === 0 ? (
          <span className={cn(CHIP, OK)}>Cola al día</span>
        ) : (
          <>
            {pending > 0 && <span className={cn(CHIP, GREY, "tabular-nums")}>{`${pending} en cola`}</span>}
            {failed > 0 && (
              <span className={cn(CHIP, DANGER, "tabular-nums")}>
                <XCircle className="h-3.5 w-3.5" aria-hidden />
                {`${failed} ${failed === 1 ? "fallida" : "fallidas"}`}
              </span>
            )}
          </>
        )}
      </span>
      <span role="cell" className="flex lg:col-start-1 lg:row-start-3 lg:-ml-3">
        <Button variant="ghost" className="min-h-11 rounded-full px-3 text-[13px]" aria-label={`Desvincular ${device.name}`} onClick={() => onRevoke(device)}>
          <Unlink className="mr-2 h-4 w-4" aria-hidden />
          Desvincular
        </Button>
      </span>
    </div>
  )
}
