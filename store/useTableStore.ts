import { create } from "zustand"
import type { Table } from "@/types"

interface TableState {
  tables: Table[]
  activeTable: string | null
  setTables: (tables: Table[]) => void
  setActiveTable: (tableId: string | null) => void
  updateTable: (tableId: string, updates: Partial<Table>) => void
  reserveTable: (tableId: string, waiterId: string) => void
  releaseTable: (tableId: string) => void
  updateTableStatus: (tableId: string, status: Table["status"]) => void
  isTableAccessibleByWaiter: (tableId: string, waiterId: string) => boolean
  assignWaiterToTable: (tableId: string, waiterId: string) => void
  getTableWaiter: (tableId: string) => string | undefined
  getTableById: (tableId: string) => Table | undefined
}

export const useTableStore = create<TableState>((set, get) => ({
  tables: [],
  activeTable: null,

  setTables: (tables) => {
    const currentTables = get().tables
    if (
      currentTables.length === tables.length &&
      currentTables.every((currentTable) =>
        tables.some(
          (newTable) =>
            newTable.id === currentTable.id &&
            newTable.status === currentTable.status &&
            newTable.waiter === currentTable.waiter,
        ),
      )
    ) {
      return
    }
    set({ tables })
  },

  setActiveTable: (tableId) => set({ activeTable: tableId }),

  updateTable: (tableId, updates) =>
    set((state) => ({
      tables: state.tables.map((table) =>
        table.id === tableId ? { ...table, ...updates } : table,
      ),
    })),

  reserveTable: (tableId, waiterId) =>
    set((state) => ({
      tables: state.tables.map((table) =>
        table.id === tableId ? { ...table, status: "reserved", waiter: waiterId } : table,
      ),
    })),

  releaseTable: (tableId) => {
    set((state) => {
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.status === "available" && !table.waiter) {
        return state
      }
      const tables = state.tables.map((table) =>
        table.id === tableId ? { ...table, status: "available", waiter: undefined } : table,
      )
      return { tables }
    })
  },

  updateTableStatus: (tableId, status) => {
    set((state) => {
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.status === status) {
        return state
      }
      const tables = state.tables.map((table) => {
        if (table.id === tableId) {
          return { ...table, status: status as Table["status"] }
        }
        return table
      })
      return { tables }
    })
  },

  isTableAccessibleByWaiter: (tableId, waiterId) => {
    const table = get().tables.find((t) => t.id === tableId)
    if (!table) return false
    return table.status === "available" || table.waiter === waiterId
  },

  assignWaiterToTable: (tableId, waiterId) => {
    set((state) => {
      const table = state.tables.find((t) => t.id === tableId)
      if (table && table.waiter === waiterId && table.status === "occupied") {
        return state
      }
      const tables = state.tables.map((table) => {
        if (table.id === tableId) {
          return { ...table, waiter: waiterId, status: "occupied" as Table["status"] }
        }
        return table
      })
      return { tables }
    })
  },

  getTableWaiter: (tableId) => {
    const table = get().tables.find((t) => t.id === tableId)
    return table?.waiter
  },

  getTableById: (tableId) => {
    return get().tables.find((t) => t.id === tableId)
  },
}))
