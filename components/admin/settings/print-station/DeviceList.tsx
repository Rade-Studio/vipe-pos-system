"use client"

import type { DesktopDeviceDto } from "@/lib/api/desktop"
import type { StationDto } from "@/lib/api/stations"
import { cn } from "@/lib/utils"
import { DEVICE_GRID, DeviceRow } from "./DeviceRow"

interface DeviceListProps {
  devices: DesktopDeviceDto[]
  stations: StationDto[]
  now: number
  onRename: (device: DesktopDeviceDto) => void
  onRevoke: (device: DesktopDeviceDto) => void
}

/** "Computadores conectados": live (not revoked) devices, newest first as the API sends them. */
export function DeviceList({ devices, stations, now, onRename, onRevoke }: DeviceListProps) {
  return (
    <section aria-labelledby="dev-h" className="rounded-card border border-line bg-surface">
      <div className="px-[18px] pb-1 pt-4">
        <h2 id="dev-h" className="text-[15px] font-semibold">
          Computadores conectados <span className="font-normal tabular-nums text-muted-fg">· {devices.length}</span>
        </h2>
      </div>
      <p className="px-[18px] pb-3 text-[12.5px] text-muted-fg">En línea: respondió en los últimos 90 segundos.</p>
      <div role="table" aria-labelledby="dev-h" className="border-t border-line">
        <div
          role="row"
          className={cn(DEVICE_GRID, "hidden border-b border-line py-2.5 text-xs uppercase tracking-[.04em] text-muted-fg lg:grid")}
        >
          <span role="columnheader">Computador</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Impresoras y estaciones</span>
          <span role="columnheader" className="sr-only">Cola</span>
          <span role="columnheader" className="sr-only">Acciones</span>
        </div>
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} stations={stations} now={now} onRename={onRename} onRevoke={onRevoke} />
        ))}
      </div>
    </section>
  )
}
