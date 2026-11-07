import { Monitor, Pencil, Trash2 } from "lucide-react"
import type { StationDto } from "@/lib/api/stations"
import { cn } from "@/lib/utils"
import { platos, STATION_STYLE } from "./station-style"

interface StationStripProps {
  stations: StationDto[]
  dishCounts: Map<string, number>
  onEdit: (station: StationDto) => void
  onDelete: (station: StationDto) => void
}

/**
 * One card per station: colour, name, the dishes it receives (Caja: facturas
 * y precuentas) and its printer. Printers are linked to stations by the VIPE
 * desktop station (F5); until then every station is "Sin impresora · solo
 * pantalla" and reads its comandas on the kitchen screen.
 */
export function StationStrip({ stations, dishCounts, onEdit, onDelete }: StationStripProps) {
  return (
    <ul
      aria-label="Estaciones"
      className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-cols-2 md:overflow-visible"
    >
      {stations.map((station) => {
        const cashier = station.kind === "cashier"
        return (
          <li
            key={station.id}
            className="flex min-w-[232px] snap-start flex-col items-start gap-1.5 rounded-card border border-line bg-surface py-2 pl-3.5 pr-2 md:min-w-0"
          >
            <div className="flex min-h-11 w-full items-center gap-2.5">
              <span aria-hidden className={cn("h-2.5 w-2.5 flex-none rounded-full", STATION_STYLE[station.color].dot)} />
              <b className="min-w-0 flex-1 truncate font-semibold">{station.name}</b>
              {!cashier && (
                <>
                  <button
                    type="button"
                    aria-label={`Editar ${station.name}`}
                    onClick={() => onEdit(station)}
                    className="grid h-11 w-11 flex-none place-items-center rounded-full text-fg-2 hover:bg-surface-2 focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${station.name}`}
                    onClick={() => onDelete(station)}
                    className="grid h-11 w-11 flex-none place-items-center rounded-full text-fg-2 hover:bg-surface-2 focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </>
              )}
            </div>
            <small className="-mt-2 text-[12.5px] text-muted-fg">
              <span>{cashier ? "Facturas y precuentas" : platos(dishCounts.get(station.id) ?? 0)}</span>
              {station.isDefault && <span> · recibe los platos sin estación</span>}
            </small>
            <span className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full border border-status-reserved-line bg-status-reserved-bg px-2.5 text-[12.5px] font-semibold text-status-reserved-fg">
              <Monitor className="h-3.5 w-3.5" aria-hidden />
              Sin impresora · solo pantalla
            </span>
          </li>
        )
      })}
    </ul>
  )
}
