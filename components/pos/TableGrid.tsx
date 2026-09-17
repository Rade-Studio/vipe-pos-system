"use client"
import { useEffect, useState } from "react"
import type { Table, Profile } from "@/types"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getStatusColor, getStatusLabel } from "@/utils/helpers"
import { LockIcon, UnlockIcon, Users2, Coffee, UtensilsCrossed, CheckCircle2, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { tableService } from "@/lib/supabase/service"
import { realtimeService } from "@/lib/supabase/realtime-service"

// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"

interface TableGridProps {
  activeTable: string | null
  waiterId: string
  onSelectTable: (tableId: string | null) => void
  onReserveTable: (tableId: string) => void
  onReleaseTable: (tableId: string) => void
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
  waiterId,
  onSelectTable,
  onReserveTable,
  onReleaseTable,
  isAccessible,
  profiles = [], // Valor por defecto como array vacío
  isAdminView = false,
}: TableGridProps) {
  // Estado local para las mesas
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  // Distinguishes first load (skeleton OK) from realtime refetch (never blank).
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // Merge algorithm for realtime postgres_changes payloads.
  // INSERT  → append to array
  // UPDATE  → replace if incoming.updated_at > existing.updated_at
  // DELETE  → filter out row by id
  const mergeTable = (prev: Table[], payload: RealtimePostgresChangesPayload<any>): Table[] => {
    const { eventType, new: newRow, old: oldRow } = payload
    if (eventType === "INSERT") {
      if (!newRow?.id) return prev
      const incoming: Table = {
        id: newRow.id,
        number: newRow.number,
        status: newRow.status,
        waiter: newRow.waiter_id || undefined,
        waiter_name: newRow.waiter_name || undefined,
      }
      return prev.some((t) => t.id === incoming.id) ? prev : [...prev, incoming]
    }
    if (eventType === "UPDATE") {
      if (!newRow?.id) return prev
      const incoming: Table = {
        id: newRow.id,
        number: newRow.number,
        status: newRow.status,
        waiter: newRow.waiter_id || undefined,
        waiter_name: newRow.waiter_name || undefined,
      }
      return prev.map((t) => {
        if (t.id !== incoming.id) return t
        // Only replace if the incoming row is newer — prevents out-of-order events.
        const incomingTime = newRow.updated_at ? new Date(newRow.updated_at).getTime() : 0
        const existingTime = t.updated_at ? new Date(t.updated_at as unknown as string).getTime() : 0
        return incomingTime >= existingTime ? incoming : t
      })
    }
    if (eventType === "DELETE") {
      if (!oldRow?.id) return prev
      return prev.filter((t) => t.id !== oldRow.id)
    }
    return prev
  }

  // Cargar mesas y suscribirse a cambios en tiempo real
  useEffect(() => {
    // Función para cargar mesas
    const loadTables = async () => {
      try {
        setLoading(true)
        const data = await tableService.getAll()

        // Convertir las mesas de la base de datos al formato que espera el componente
        const formattedTables = data.map((table) => ({
          id: table.id,
          number: table.number,
          status: table.status as any,
          waiter: table.waiter_id || undefined,
          waiter_name: table.waiter_name || undefined,
        }))

        setTables(formattedTables)
        setInitialLoadDone(true)
      } catch (error) {
        console.error("Error al cargar mesas:", error)
      } finally {
        setLoading(false)
      }
    }

    // Cargar mesas inicialmente
    loadTables()

    // Suscribirse a cambios en tiempo real — merge on payload, no full reload.
    const unsubscribe = realtimeService.subscribeToTables((payload) => {
      console.log("Cambio en mesa recibido:", payload)
      // Merge into existing array without a re-query — no setLoading(true) here,
      // so the grid stays visible during the update.
      setTables((prev) => mergeTable(prev, payload))
      if (!initialLoadDone) setInitialLoadDone(true)
    })

    // Limpiar suscripción al desmontar
    return () => {
      unsubscribe()
    }
  }, [initialLoadDone])

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

  // Si está cargando, mostrar indicador — pero SOLO en la carga inicial.
  // Las actualizaciones en tiempo real nunca blankear la grilla (HS-23).
  if (!initialLoadDone && loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-4">
          <Skeleton className="h-6 w-40" />
          <div className="flex space-x-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </div>
    )
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
        {tables
          .sort((a, b) => a.number - b.number)
          .map((table) => {
            const isActive = activeTable === table.id
            const accessible = isAccessible(table.id)
            const isReserved = table.status === "reserved"
            const isOwnedByCurrentWaiter = table.waiter === waiterId

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

                {/* Botón de reservar/liberar */}
                {accessible && !isAdminView && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute bottom-2 right-2 h-7 w-7 bg-white/80 dark:bg-black/50 rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      isReserved ? onReleaseTable(table.id) : onReserveTable(table.id)
                    }}
                    title={isReserved ? "Liberar mesa" : "Reservar mesa"}
                  >
                    {isReserved ? <UnlockIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
                  </Button>
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
