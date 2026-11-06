"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, LayoutGrid, List, Plus, Settings2 } from "lucide-react"
import type { Table, TableShape } from "@/types"
import { cn } from "@/lib/utils"
import * as tablesApi from "@/lib/api/tables"
import * as zonesApi from "@/lib/api/zones"
import type { ZoneDto } from "@/lib/api/zones"
import { ApiError, conflictMessage } from "@/lib/api/errors"
import { realtimeService } from "@/lib/api/realtime"
import { mergeTableList, type TableChange } from "@/lib/realtime/table-merge"
import { log } from "@/lib/log"
import { isPlaced } from "@/lib/floor/layout"
import {
  SHAPE_DEFAULTS,
  SHAPE_LABELS,
  applyEdits,
  changedRows,
  editTable,
  freeSpot,
  moveTo,
  nextTableNumber,
  nudge,
  type LayoutEdit,
} from "@/lib/floor/editor"
import { FloorMap } from "@/components/floor/FloorMap"
import { FloorPlan } from "@/components/floor/FloorPlan"
import { UnplacedStrip } from "@/components/floor/UnplacedStrip"
import { StatusChip } from "@/components/floor/StatusChip"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useWaiters } from "@/hooks/use-waiters"
import { useIsMobile } from "@/hooks/use-mobile"
import { ZONES_QUERY_KEY } from "@/hooks/use-zones"
import { ShapeIcon } from "./ShapeIcon"
import { TableInspector, type TableData } from "./TableInspector"
import { ZoneSheet } from "./ZoneSheet"

/** Every zone, inactive ones too (admin). Under `['zones']`, so a zone event refreshes it with the waiter's. */
const ADMIN_ZONES_KEY = [...ZONES_QUERY_KEY, "admin"] as const
const SHAPES: TableShape[] = ["round", "square", "rect", "bar"]
const DEFAULT_ASPECT = 1.6

const PILL =
  "inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-pill border px-4 text-sm font-medium focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
const PILL_OFF = "border-line bg-surface-2 text-fg-2"
const PILL_ON = "border-brand-line bg-brand-tint text-fg"

const layoutOf = (table: Table): LayoutEdit => ({
  zoneId: table.zoneId,
  x: table.x,
  y: table.y,
  w: table.w,
  h: table.h,
  shape: table.shape,
  rotation: table.rotation,
  seats: table.seats,
})

const changesText = (count: number) => `${count} ${count === 1 ? "cambio" : "cambios"} sin guardar`

/**
 * Admin "Mesas": the floor plan editor (T5, S4; design/admin-floor-plan/01).
 * Canvas first with a floating inspector; every layout change stays local
 * until "Guardar cambios" sends them all in ONE `PUT /tables/layout`. The
 * table list (search, status filter, create, edit, delete) stays one tab
 * away. On a phone the plan is read only and tables are edited from a list.
 */
export function FloorPlanEditor() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isPhone = useIsMobile()
  const { data: waiters = [] } = useWaiters()

  const { data: zones = [] } = useQuery<ZoneDto[]>({
    queryKey: ADMIN_ZONES_KEY,
    queryFn: () => zonesApi.getAll({ includeInactive: true }),
  })
  const refreshZones = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [...ZONES_QUERY_KEY] }).catch(() => undefined),
    [queryClient],
  )
  useEffect(() => realtimeService.subscribeToZones(() => void refreshZones()), [refreshZones])

  const [base, setBase] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<Record<string, LayoutEdit>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [view, setView] = useState<"plan" | "list">("plan")
  const [preview, setPreview] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    let cancelled = false
    tablesApi
      .getAll()
      .then((data) => {
        if (!cancelled) setBase(data.map(tablesApi.toTable))
      })
      .catch((error) => {
        log.error("Error al cargar mesas:", { error: String(error) })
        toast({ title: "Error", description: "No se pudieron cargar las mesas. Intente nuevamente.", variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const unsubscribe = realtimeService.subscribeToTables((payload) => {
      setBase((prev) => mergeTableList(prev, payload as unknown as TableChange))
    }, "admin")
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [toast])

  const draft = useMemo(() => applyEdits(base, edits), [base, edits])
  const dirty = useMemo(() => changedRows(base, draft), [base, draft])
  const zoneIds = useMemo(() => new Set(zones.map((zone) => zone.id)), [zones])
  const zone = zones.find((candidate) => candidate.id === zoneId) ?? zones[0]
  const aspectOf = useCallback(
    (table: Table) => zones.find((candidate) => candidate.id === table.zoneId)?.aspect ?? DEFAULT_ASPECT,
    [zones],
  )
  const sorted = useMemo(() => [...draft].sort((a, b) => a.number - b.number), [draft])
  const zoneTables = zone ? sorted.filter((table) => table.zoneId === zone.id && isPlaced(table, zoneIds)) : []
  const unplaced = sorted.filter((table) => !isPlaced(table, zoneIds))
  const selected = draft.find((table) => table.id === selectedId) ?? null

  // A table selected elsewhere (list, Sin ubicar, zone change) shows its zone.
  const selectedZoneId = selected && isPlaced(selected, zoneIds) ? selected.zoneId : undefined
  useEffect(() => {
    if (selectedZoneId) setZoneId(selectedZoneId)
  }, [selectedZoneId])

  const change = useCallback(
    (tableId: string, next: (table: Table) => Table | null) => {
      const current = draft.find((table) => table.id === tableId)
      const updated = current && next(current)
      if (!updated) return
      setEdits((prev) => ({ ...prev, [tableId]: layoutOf(updated) }))
      setSaveError(null)
    },
    [draft],
  )

  const onMoveTable = (tableId: string, x: number, y: number) => change(tableId, (table) => moveTo(table, x, y, aspectOf(table)))
  const onNudgeTable = (tableId: string, key: string, big: boolean) =>
    change(tableId, (table) => nudge(table, key, big, aspectOf(table)))

  const onEdit = (tableId: string, edit: LayoutEdit) =>
    change(tableId, (table) => {
      const target = edit.zoneId ?? table.zoneId
      const aspect = zones.find((candidate) => candidate.id === target)?.aspect ?? DEFAULT_ASPECT
      const next = editTable(table, edit, aspect)
      // Into another zone, or onto the plan for the first time: the first free spot there.
      if (edit.zoneId && (edit.zoneId !== table.zoneId || !isPlaced(table, zoneIds))) {
        const size = { ...SHAPE_DEFAULTS[next.shape ?? "square"], ...(next.w ? { w: next.w, h: next.h ?? next.w } : {}) }
        const others = draft.filter((other) => other.id !== table.id && other.zoneId === edit.zoneId)
        return { ...next, ...size, ...freeSpot(others, { ...size, shape: next.shape }, aspect) }
      }
      return next
    })

  const placeSelected = () => {
    if (!selected || !zone) return
    onEdit(selected.id, { zoneId: zone.id })
  }

  const addTable = async (shape: TableShape) => {
    if (!zone) return
    const size = SHAPE_DEFAULTS[shape]
    const spot = freeSpot(zoneTables, { ...size, shape }, zone.aspect)
    const number = nextTableNumber(draft)
    try {
      const created = tablesApi.toTable(
        await tablesApi.create({ number, status: "available", zoneId: zone.id, ...spot, ...size, shape, rotation: 0, seats: null }),
      )
      setBase((prev) => (prev.some((table) => table.id === created.id) ? prev : [...prev, created]))
      setSelectedId(created.id)
      setAnnouncement(`Mesa ${number} ${SHAPE_LABELS[shape].toLowerCase()} agregada en ${zone.name}`)
    } catch (error) {
      log.error("Error al crear mesa:", { error: String(error) })
      toast({ title: "Error", description: conflictMessage(error, "No se pudo crear la mesa."), variant: "destructive" })
    }
  }

  const save = async () => {
    if (dirty.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await tablesApi.saveLayout(dirty)
      setBase(saved.map(tablesApi.toTable))
      setEdits({})
      setAnnouncement("Plano guardado")
    } catch (error) {
      log.error("Error al guardar el plano:", { error: String(error) })
      setSaveError(error instanceof ApiError && error.status < 500 ? error.message : "No se pudo guardar el plano. Intente nuevamente.")
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setEdits({})
    setSaveError(null)
  }

  const saveData = async (tableId: string, data: TableData) => {
    try {
      const updated = tablesApi.toTable(await tablesApi.update(tableId, data))
      setBase((prev) => prev.map((table) => (table.id === tableId ? updated : table)))
      toast({ title: "Mesa actualizada", description: `La mesa ${updated.number} ha sido actualizada.` })
    } catch (error) {
      log.error("Error al actualizar mesa:", { error: String(error) })
      toast({ title: "Error", description: conflictMessage(error, "No se pudo actualizar la mesa."), variant: "destructive" })
    }
  }

  const deleteTable = async (tableId: string) => {
    try {
      await tablesApi.delete(tableId)
      setBase((prev) => prev.filter((table) => table.id !== tableId))
      setEdits(({ [tableId]: _removed, ...rest }) => rest)
      setSelectedId(null)
      toast({ title: "Mesa eliminada", description: "La mesa ha sido eliminada." })
    } catch (error) {
      log.error("Error al eliminar mesa:", { error: String(error) })
      toast({
        title: error instanceof ApiError && error.status === 409 ? "No se puede eliminar" : "Error",
        description: conflictMessage(error, "No se pudo eliminar la mesa. Intente nuevamente."),
        variant: "destructive",
      })
    }
  }

  const inspector = (table: Table, className?: string, onClose?: () => void) => (
    <TableInspector
      key={table.id}
      table={table}
      zones={zones}
      placed={isPlaced(table, zoneIds)}
      waiters={waiters}
      onEdit={(edit) => onEdit(table.id, edit)}
      onPlace={placeSelected}
      onSaveData={(data) => saveData(table.id, data)}
      onDelete={() => deleteTable(table.id)}
      onClose={onClose}
      className={className}
    />
  )

  const waiterNameOf = (table: Table) => table.waiter_name

  const zoneTabs = (
    <div className="flex min-w-0 items-center gap-2">
      <div role="tablist" aria-label="Zonas" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {zones.map((candidate) => {
          const active = candidate.id === zone?.id
          const count = draft.filter((table) => table.zoneId === candidate.id && isPlaced(table, zoneIds)).length
          return (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setZoneId(candidate.id)}
              className={cn(PILL, active ? PILL_ON : PILL_OFF, !candidate.active && "border-dashed")}
            >
              {candidate.name}
              {!candidate.active && <span className="text-xs text-muted-fg">inactiva</span>}
              <span className="text-xs tabular-nums text-muted-fg">
                {count}
                <span className="sr-only"> mesas</span>
              </span>
            </button>
          )
        })}
        <button type="button" aria-label="Agregar zona" className={cn(PILL, PILL_OFF, "border-dashed")} onClick={() => setSheetOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Zona
        </button>
      </div>
    </div>
  )

  const saveBar = (dirty.length > 0 || saveError) && (
    <div
      className="sticky bottom-3 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card-lg border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lg"
      aria-label="Cambios del plano"
      role="region"
    >
      {dirty.length > 0 && (
        <span className="min-w-0 flex-1 font-medium">
          <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full bg-brand" />
          {changesText(dirty.length)}
        </span>
      )}
      {saveError && (
        <p role="alert" className="w-full rounded-card border border-status-danger-line bg-status-danger-bg px-3 py-2 text-status-danger-fg sm:order-last">
          {saveError}
        </p>
      )}
      {dirty.length > 0 && (
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="h-11" disabled={saving} onClick={discard}>
            Descartar
          </Button>
          <Button className="h-11" disabled={saving} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      )}
    </div>
  )

  const viewTabs = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Vista" className="flex gap-1.5">
        <button type="button" role="tab" aria-selected={view === "plan"} className={cn(PILL, view === "plan" ? PILL_ON : PILL_OFF)} onClick={() => setView("plan")}>
          <LayoutGrid className="h-4 w-4" aria-hidden />
          Plano
        </button>
        <button type="button" role="tab" aria-selected={view === "list"} className={cn(PILL, view === "list" ? PILL_ON : PILL_OFF)} onClick={() => setView("list")}>
          <List className="h-4 w-4" aria-hidden />
          Lista
        </button>
      </div>
      {view === "plan" && (
        <div className="ml-auto flex flex-wrap gap-2">
          {!isPhone && (
            <button type="button" aria-pressed={preview} className={cn(PILL, preview ? PILL_ON : PILL_OFF)} onClick={() => setPreview((on) => !on)}>
              <Eye className="h-4 w-4" aria-hidden />
              Vista previa mesero
            </button>
          )}
          <button type="button" className={cn(PILL, PILL_OFF)} onClick={() => setSheetOpen(true)}>
            <Settings2 className="h-4 w-4" aria-hidden />
            Gestionar zonas
          </button>
        </div>
      )}
    </div>
  )

  let body: ReactNode
  if (view === "list") {
    body = <TableManagementPanel />
  } else if (loading) {
    body = <Skeleton className="aspect-[1.6] w-full rounded-card-lg" data-testid="floor-loading" />
  } else if (isPhone) {
    body = (
      <div className="flex min-w-0 flex-col gap-4">
        <p className="rounded-card border border-line bg-surface-2 px-3 py-2 text-sm text-fg-2">
          En el teléfono el plano es de solo lectura: arrastrar y alinear mesas está disponible en tablet y computador. Aquí puedes editar
          los datos de cada mesa desde la lista.
        </p>
        <FloorPlan zones={zones} tables={draft} selectedTableId={selectedId} onSelectTable={setSelectedId} waiterNameOf={waiterNameOf} />
        <ul aria-label="Mesas" className="flex flex-col gap-2">
          {sorted.map((table) => {
            const open = table.id === selectedId
            return (
              <li key={table.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setSelectedId(open ? null : table.id)}
                  className={cn(
                    "flex min-h-[52px] items-center justify-between gap-3 rounded-card border bg-surface px-4 text-left text-sm",
                    "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus",
                    open ? "border-brand" : "border-line",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">Mesa {table.number}</span>
                    <span className="block truncate text-xs text-muted-fg">
                      {SHAPE_LABELS[table.shape ?? "square"]} · {zones.find((z) => z.id === table.zoneId)?.name ?? "Sin ubicar"}
                    </span>
                  </span>
                  <StatusChip status={table.status} />
                </button>
                {open && inspector(table, "shadow-none")}
              </li>
            )
          })}
        </ul>
      </div>
    )
  } else if (preview) {
    body = <FloorPlan zones={zones.filter((z) => z.active)} tables={draft} selectedTableId={selectedId} onSelectTable={setSelectedId} waiterNameOf={waiterNameOf} />
  } else {
    body = (
      <div className="flex min-w-0 flex-col gap-3">
        {zoneTabs}
        <div role="toolbar" aria-label="Agregar mesa" className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-fg">Agregar</span>
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-label={`Agregar mesa ${SHAPE_LABELS[shape]}`}
              disabled={!zone}
              className={cn(PILL, PILL_OFF, "px-3 disabled:opacity-50")}
              onClick={() => void addTable(shape)}
            >
              <ShapeIcon shape={shape} />
              {SHAPE_LABELS[shape]}
            </button>
          ))}
          <span className="ml-auto hidden text-xs text-muted-fg xl:inline">Arrastra una mesa o usa las flechas (Shift: pasos grandes).</span>
        </div>

        <div className="relative min-w-0">
          {zone ? (
            <div className={cn("min-w-0 overflow-auto rounded-card-lg p-3 sm:p-4", selected && "lg:pr-[22rem]")}>
              <FloorMap
                zone={zone}
                tables={zoneTables}
                selectedTableId={selectedId}
                onSelectTable={setSelectedId}
                mode="edit"
                onMoveTable={onMoveTable}
                onNudgeTable={onNudgeTable}
                className="mx-auto max-w-[960px]"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-card-lg border border-dashed border-line p-8 text-center text-sm text-muted-fg">
              <p>Todavía no hay zonas. Crea una para empezar el plano.</p>
              <Button className="h-11" onClick={() => setSheetOpen(true)}>
                Crear zona
              </Button>
            </div>
          )}
          {selected &&
            inspector(
              selected,
              "mt-3 lg:absolute lg:right-3 lg:top-3 lg:mt-0 lg:max-h-[calc(100%-1.5rem)] lg:w-80 lg:overflow-y-auto",
              () => setSelectedId(null),
            )}
        </div>

        <UnplacedStrip tables={unplaced} selectedTableId={selectedId} onSelectTable={setSelectedId} waiterNameOf={waiterNameOf} />
        {!selected && zone && <p className="text-xs text-muted-fg xl:hidden">Toca una mesa para editarla; arrástrala o usa las flechas para moverla.</p>}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {viewTabs}
      {body}
      {view === "plan" && saveBar}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ZoneSheet open={sheetOpen} onOpenChange={setSheetOpen} zones={zones} onChanged={refreshZones} />
    </div>
  )
}

