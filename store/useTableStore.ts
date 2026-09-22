import { create } from "zustand"
import type { Table } from "@/types"
import { mergeTableList, type TableChange } from "@/lib/realtime/table-merge"

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
  /**
   * Applies a postgres_changes payload for `public.tables` in place (D1, D10).
   * Delegates all decision logic to the pure `mergeTableList`; this action's
   * only job is translating "same array reference" into "same state object"
   * so Zustand's `Object.is` check (vanilla.mjs) skips notifying subscribers
   * on a no-op, producing zero re-renders.
   */
  applyTableChange: (change: TableChange) => void
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
      const tables: Table[] = state.tables.map((table) =>
        table.id === tableId ? { ...table, status: "available", waiter: undefined } : table,
      )
      return { tables } as Partial<TableState>
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

  applyTableChange: (change) =>
    set((state) => {
      const next = mergeTableList(state.tables, change)
      // Identity preserved on no-op → Object.is short-circuits in vanilla.mjs
      // → no listener notified → zero re-renders.
      return next === state.tables ? state : { tables: next }
    }),
}))
