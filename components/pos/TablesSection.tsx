"use client"

import { useCallback } from "react"
import type { Profile, Table } from "@/types"
import type { FloorZone } from "@/lib/floor/layout"
import { TableGrid } from "@/components/pos/TableGrid"
import { FloorPlan } from "@/components/floor/FloorPlan"
import { Skeleton } from "@/components/ui/skeleton"
import { useTableStore } from "@/store/useTableStore"

interface TablesSectionProps {
  activeTable: string | null
  profile: Profile
  profiles: Profile[] // Asegurarnos de recibir todos los perfiles
  onSelectTable: (tableId: string | null) => void
  onReserveTable: (tableId: string) => void
  onReleaseTable: (tableId: string) => void
  isTableAccessible: (tableId: string) => boolean
  /**
   * T6: the zone floor map instead of the grid. `zones` undefined while they
   * load; the screens without it (kitchen) keep the grid.
   */
  floor?: { zones: FloorZone[] | undefined; currentWaiterId?: string }
}

export function TablesSection({
  activeTable,
  profile,
  profiles, // Recibir todos los perfiles
  onSelectTable,
  onReserveTable,
  onReleaseTable,
  isTableAccessible,
  floor,
}: TablesSectionProps) {
  // The floor map reads the same single owner as the grid (S3, D1).
  const tables = useTableStore((s) => s.tables)
  const waiterNameOf = useCallback(
    (table: Table) => {
      if (!table.waiter) return undefined
      const waiter = profiles.find((p) => p.id === table.waiter)
      return waiter ? waiter.full_name || waiter.name : table.waiter_name
    },
    [profiles],
  )
  // Same as the grid: tapping the selected table again deselects it.
  const selectTable = useCallback(
    (tableId: string) => {
      if (isTableAccessible(tableId)) onSelectTable(tableId === activeTable ? null : tableId)
    },
    [activeTable, isTableAccessible, onSelectTable],
  )

  if (floor) {
    if (!floor.zones) {
      return (
        <div className="mb-4 space-y-3" aria-busy="true">
          <Skeleton className="h-11 w-64 rounded-full" />
          <Skeleton className="aspect-[1.6] w-full rounded-3xl" />
        </div>
      )
    }
    return (
      <FloorPlan
        className="mb-4"
        zones={floor.zones}
        tables={tables}
        selectedTableId={activeTable}
        onSelectTable={selectTable}
        currentWaiterId={floor.currentWaiterId ?? profile.id}
        waiterNameOf={waiterNameOf}
      />
    )
  }

  return (
    <div className="mb-4">
      <TableGrid
        activeTable={activeTable}
        waiterId={profile.id}
        onSelectTable={onSelectTable}
        onReserveTable={onReserveTable}
        onReleaseTable={onReleaseTable}
        isAccessible={isTableAccessible}
        profiles={profiles} // Pasar perfiles a TableGrid
      />
    </div>
  )
}
