"use client"

import { useCallback, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { FloorPlan } from "@/components/floor/FloorPlan"
import { TablePanel } from "@/components/floor/TablePanel"
import { ReserveSheet } from "@/components/tables/ReserveSheet"
import { WaiterSelectionModal } from "@/components/pos/WaiterSelectionModal"
import { Skeleton } from "@/components/ui/skeleton"
import * as tablesApi from "@/lib/api/tables"
import { conflictMessage } from "@/lib/api/errors"
import { realtimeService } from "@/lib/api/realtime"
import type { TableChange } from "@/lib/realtime/table-merge"
import { useZones } from "@/hooks/use-zones"
import { useToast } from "@/hooks/use-toast"
import type { Table } from "@/types"

/**
 * Caja's "Mesas" (odd/tasks/reservas-mesas.md T3, S4, S5): the waiter's floor
 * map and table panel over the same table store and realtime. Caja reserves,
 * cancels a reservation, frees a table and seats a reservation through the
 * waiter picker; it takes no orders here, so "Agregar productos" is hidden.
 */
export function CashierTablesView() {
  const { toast } = useToast()
  const tables = useTableStore((s) => s.tables)
  const profiles = useProfileStore((s) => s.profiles)
  const zonesQuery = useZones()
  const zones = zonesQuery.data ?? (zonesQuery.isError ? [] : undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reserveTarget, setReserveTarget] = useState<{ id: string; number: number } | null>(null)
  const [seatTarget, setSeatTarget] = useState<string | null>(null)

  // The same ['tables'] query the waiter view hydrates the store from.
  const { data: tablesData } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => (await tablesApi.getAll()).map(tablesApi.toTable),
  })
  useEffect(() => {
    if (tablesData && tablesData.length > 0) useTableStore.getState().setTables(tablesData)
  }, [tablesData])
  useEffect(
    () =>
      realtimeService.subscribeToTables((payload) =>
        useTableStore.getState().applyTableChange(payload as unknown as TableChange),
      ),
    [],
  )

  const selected = tables.find((t) => t.id === selectedId) ?? null
  const waiterNameOf = useCallback(
    (table: Table) => {
      if (!table.waiter) return undefined
      const waiter = profiles.find((p) => p.id === table.waiter)
      return waiter ? waiter.full_name || waiter.name : table.waiter_name
    },
    [profiles],
  )
  const zoneName = selected?.zoneId ? zones?.find((zone) => zone.id === selected.zoneId)?.name : undefined

  const failed = (what: string, err: unknown) =>
    toast({ title: "Error", description: `${what} ${conflictMessage(err, "Intente nuevamente.")}`, variant: "destructive" })

  const reserve = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId)
    if (table) setReserveTarget({ id: table.id, number: table.number })
  }
  const release = async (tableId: string) => {
    try {
      await tablesApi.releaseTable(tableId)
      useTableStore.getState().releaseTable(tableId)
    } catch (err) {
      failed("No se pudo liberar la mesa.", err)
    }
  }
  // "Sentar clientes": caja picks the waiter, then the existing assign path.
  const seat = async (waiterId: string) => {
    const tableId = seatTarget
    setSeatTarget(null)
    if (!tableId) return
    try {
      await tablesApi.assignWaiter(tableId, waiterId)
      useTableStore.getState().assignWaiterToTable(tableId, waiterId)
    } catch (err) {
      failed("No se pudo asignar la mesa.", err)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <section aria-labelledby="cashier-tables-title" className="min-w-0 rounded-card border border-line bg-surface p-3">
        <h2 id="cashier-tables-title" className="mb-2 text-base font-semibold text-fg">
          Mesas
        </h2>
        {zones ? (
          <FloorPlan
            zones={zones}
            tables={tables}
            selectedTableId={selectedId}
            onSelectTable={(id) => setSelectedId(id === selectedId ? null : id)}
            waiterNameOf={waiterNameOf}
          />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-11 w-64 rounded-full" />
            <Skeleton className="aspect-[1.6] w-full rounded-3xl" />
          </div>
        )}
      </section>
      <div className="min-w-0 self-start rounded-card border border-line bg-surface">
        <TablePanel
          table={selected}
          waiterName={selected ? waiterNameOf(selected) : undefined}
          zoneName={zoneName}
          onReserve={reserve}
          onRelease={(id) => void release(id)}
          onSeat={setSeatTarget}
        />
      </div>

      <ReserveSheet
        table={reserveTarget}
        onClose={() => setReserveTarget(null)}
        onReserved={(dto) => {
          useTableStore.getState().updateTable(dto.id, tablesApi.toTable(dto))
          setReserveTarget(null)
        }}
      />
      <WaiterSelectionModal
        open={seatTarget !== null}
        onOpenChange={(open) => !open && setSeatTarget(null)}
        onSelect={(id) => void seat(id)}
      />
    </div>
  )
}
