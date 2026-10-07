"use client"

import type { Profile } from "@/types"
import { TableGrid } from "@/components/pos/TableGrid"

interface TablesSectionProps {
  activeTable: string | null
  profile: Profile
  profiles: Profile[] // Asegurarnos de recibir todos los perfiles
  onSelectTable: (tableId: string | null) => void
  onReserveTable: (tableId: string) => void
  onReleaseTable: (tableId: string) => void
  isTableAccessible: (tableId: string) => boolean
}

export function TablesSection({
  activeTable,
  profile,
  profiles, // Recibir todos los perfiles
  onSelectTable,
  onReserveTable,
  onReleaseTable,
  isTableAccessible,
}: TablesSectionProps) {
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
