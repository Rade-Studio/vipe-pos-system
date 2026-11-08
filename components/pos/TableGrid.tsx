"use client"
import type { ReactNode } from "react"
import type { Profile } from "@/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getStatusColor, getStatusLabel } from "@/utils/helpers"
import { Armchair, LockIcon, UnlockIcon, Users2, Coffee, UtensilsCrossed, CheckCircle2, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTableStore } from "@/store/useTableStore"
import { isFreeTable, reservationLine } from "@/lib/tables/reservation"

interface TableGridProps {
  activeTable: string | null
  waiterId: string
  onSelectTable: (tableId: string | null) => void
  onReserveTable: (tableId: string) => void
  /** Also "Cancelar reserva" on a reserved table. */
  onReleaseTable: (tableId: string) => void
  /** "Sentar clientes" on a reserved table (reservas-mesas S5); hidden without it. */
  onSeatTable?: (tableId: string) => void
  isAccessible: (tableId: string) => boolean
  profiles: Profile[] // Asegurarnos de recibir todos los perfiles
  isAdminView?: boolean
}

// Función para obtener el ícono según el estado de la mesa
const getStatusIcon = (status: string) => {
  switch (status) {
    case "available":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case "reserved":
      return <LockIcon className="h-5 w-5 text-blue-500" />
    case "occupied":
      return <Users2 className="h-5 w-5 text-amber-500" />
    case "kitchen":
      return <UtensilsCrossed className="h-5 w-5 text-red-500" />
    case "delivered":
    case "served": // Añadir "served" como alias de "delivered"
      return <Coffee className="h-5 w-5 text-purple-500" />
    default:
      return <Clock className="h-5 w-5 text-gray-500" />
  }
}

// Función para obtener el color de fondo según el estado
const getBackgroundColor = (status: string) => {
  switch (status) {
    case "available":
      return "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
    case "reserved":
      return "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
    case "occupied":
      return "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
    case "kitchen":
      return "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
    case "delivered":
    case "served": // Añadir "served" como alias de "delivered"
      return "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800"
    default:
      return "bg-slate-50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-800"
  }
}

// Función para obtener las iniciales de un nombre
const getInitials = (name: string): string => {
  if (!name) return "?"
  const parts = name.split(" ")
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export function TableGrid({
  activeTable,
  onSelectTable,
  onReserveTable,
  onReleaseTable,
  onSeatTable,
  isAccessible,
  profiles = [], // Valor por defecto como array vacío
  isAdminView = false,
}: TableGridProps) {
  // Single owner (D1, S3): read table state directly from useTableStore
  // instead of self-fetching/self-subscribing. Hydration and realtime
  // patching are the owning view's responsibility (WaiterView, KitchenView);
  // TableGrid is a pure consumer, so there is no local loading/skeleton
  // state left to own here — see apply-progress for the S3.3 write-up.
  const tables = useTableStore((s) => s.tables)

  // Calcular estadísticas de mesas
  const tableStats = {
    total: tables.length,
    available: tables.filter((t) => t.status === "available").length,
    occupied: tables.filter((t) => t.status !== "available").length,
  }

  // Función para encontrar el nombre del mesero por ID
  const getWaiterName = (waiterId: string | undefined): string | null => {
    if (!waiterId) return null

    // Buscar el mesero en los perfiles
    const waiter = profiles.find((p) => p.id === waiterId)

    // Devolver el nombre completo o el nombre regular
    return waiter ? waiter.full_name || waiter.name : null
  }

  // Asegurar que se muestre correctamente el mesero en el cuadro de mesas
  return (
    <div className="space-y-4">
      {!isAdminView && (
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Distribución de Mesas</h3>
          <div className="flex space-x-2 text-sm">
            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 rounded-md">
              Disponibles: <strong>{tableStats.available}</strong>
            </span>
            <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900/30 rounded-md">
              Ocupadas: <strong>{tableStats.occupied}</strong>
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {/* `tables` is now the store's own array reference (S3, D1) — copy
            before sorting so this render pass never mutates shared state
            in place (Array.prototype.sort mutates its receiver). */}
        {[...tables]
          .sort((a, b) => a.number - b.number)
          .map((table) => {
            const isActive = activeTable === table.id
            const accessible = isAccessible(table.id)
            const isReserved = table.status === "reserved"
            // S1: only a free table can be reserved (the grid has no orders: its status says it).
            const isFree = isFreeTable(table, false)
            const reservation = reservationLine(table)

            // Obtener el nombre del mesero
            const waiterName = getWaiterName(table.waiter)

            return (
              <div
                key={table.id}
                className={cn(
                  "relative rounded-lg border-2 overflow-hidden transition-all h-36",
                  getBackgroundColor(table.status),
                  isActive ? "ring-2 ring-primary" : "",
                  !accessible ? "opacity-70" : "",
                  "cursor-pointer",
                )}
                onClick={() => accessible && onSelectTable(isActive ? null : table.id)}
              >
                <div className="absolute top-0 left-0 right-0 bg-black/5 dark:bg-white/5 py-1.5 px-3 flex justify-between items-center">
                  <div className="text-base font-bold">Mesa {table.number}</div>
                  <div className="flex items-center gap-1">{getStatusIcon(table.status)}</div>
                </div>

                <div className="flex flex-col items-center justify-center h-full pt-8 pb-4 px-3">
                  {/* Mostrar el estado como un badge pequeño */}
                  <Badge variant="outline" className={`${getStatusColor(table.status)} text-xs px-2 py-0.5 mb-2`}>
                    {getStatusLabel(table.status)}
                  </Badge>

                  {reservation && (
                    <span className="line-clamp-2 max-w-full text-center text-xs font-medium [overflow-wrap:anywhere]">{reservation}</span>
                  )}

                  {/* Mostrar el mesero con un avatar de iniciales */}
                  {waiterName && (
                    <div className="flex flex-col items-center mt-1">
                      <div className="h-12 w-12 rounded-full bg-primary/20 text-primary flex items-center justify-center text-lg font-semibold">
                        {getInitials(waiterName)}
                      </div>
                      <span className="text-xs font-medium mt-1 text-center truncate max-w-full">{waiterName}</span>
                    </div>
                  )}
                </div>

                {/* Reservar (free) / Sentar clientes and Cancelar reserva (reserved) */}
                {accessible && !isAdminView && (isFree || isReserved) && (
                  <div className="absolute bottom-1 right-1 flex gap-1">
                    {isReserved && onSeatTable && (
                      <GridAction label="Sentar clientes" onClick={() => onSeatTable(table.id)}>
                        <Armchair className="h-4 w-4" aria-hidden />
                      </GridAction>
                    )}
                    {isReserved ? (
                      <GridAction label="Cancelar reserva" onClick={() => onReleaseTable(table.id)}>
                        <UnlockIcon className="h-4 w-4" aria-hidden />
                      </GridAction>
                    ) : (
                      <GridAction label="Reservar mesa" onClick={() => onReserveTable(table.id)}>
                        <LockIcon className="h-4 w-4" aria-hidden />
                      </GridAction>
                    )}
                  </div>
                )}
              </div>
            )
          })}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 justify-center border-t border-slate-200 dark:border-slate-800 pt-3 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span>Disponible</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
          <span>Reservada</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-amber-500"></div>
          <span>Ocupada</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span>En cocina</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-purple-500"></div>
          <span>Servida</span>
        </div>
      </div>
    </div>
  )
}

/** A 44 px round icon action on a grid card; the card's own click (select) is not triggered. */
function GridAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11 rounded-full bg-white/80 shadow-sm dark:bg-black/50"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}
