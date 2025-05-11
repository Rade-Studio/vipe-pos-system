"use client"

import { useState } from "react"
import type { Table, Profile } from "@/types"
import { TableGrid } from "@/components/pos/TableGrid"

interface TablesSectionProps {
  tables: Table[]
  activeTable: string | null
  profile: Profile
  profiles: Profile[] // Asegurarnos de recibir todos los perfiles
  onSelectTable: (tableId: string | null) => void
  onReserveTable: (tableId: string) => void
  onReleaseTable: (tableId: string) => void
  isTableAccessible: (tableId: string) => boolean
}

export function TablesSection({
  tables,
  activeTable,
  profile,
  profiles, // Recibir todos los perfiles
  onSelectTable,
  onReserveTable,
  onReleaseTable,
  isTableAccessible,
}: TablesSectionProps) {
  // Añadir al inicio del componente, justo después de la declaración de la función
  const [searchTerm, setSearchTerm] = useState("")
  const [filterStatus, setFilterStatus] = useState<string | null>(null)

  // Filtrar mesas por término de búsqueda y estado
  const filteredTables = tables.filter((table) => {
    const matchesSearch = searchTerm === "" || table.number.toString().includes(searchTerm)
    const matchesStatus = filterStatus === null || table.status === filterStatus
    return matchesSearch && matchesStatus
  })

  return (
    <div className="mb-4">
      <TableGrid
        tables={tables}
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
