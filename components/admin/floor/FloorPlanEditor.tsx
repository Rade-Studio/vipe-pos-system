"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, LayoutGrid, List, Plus, Redo2, Settings2, Undo2 } from "lucide-react"
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
  type LayoutEdit,
} from "@/lib/floor/editor"
import { alignTables, distributeTables, type AlignMode, type DistributeAxis } from "@/lib/admin/floor/align"
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from "@/lib/admin/floor/history"
import { hasDimensions, nudgeBy, SNAP_CM, toCm, yToCm, sizeText } from "@/lib/admin/floor/units"
import { takeEditorZone } from "@/lib/admin/floor/editor-zone"
import { keepActiveFlag } from "@/lib/admin/floor/live"
import { FloorPlan } from "@/components/floor/FloorPlan"
import { UnplacedStrip } from "@/components/floor/UnplacedStrip"
import { TableManagementPanel } from "@/components/admin/tables/TableManagementPanel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useWaiters } from "@/hooks/use-waiters"
import { useIsMobile } from "@/hooks/use-mobile"
import { ZONES_QUERY_KEY } from "@/hooks/use-zones"
import { AlignToolbar } from "./AlignToolbar"
import { EditorCanvas } from "./EditorCanvas"
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

type Edits = Record<string, LayoutEdit>
const EMPTY_HISTORY: History<Edits> = createHistory<Edits>({})

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/**
 * Admin "Mesas": the floor plan editor (T5, S4; design/admin-floor-plan/01).
 * Canvas first with a floating inspector; every layout change stays local
 * until "Guardar cambios" sends them all in ONE `PUT /tables/layout`. The
 * table list (search, status filter, create, edit, delete) stays one tab
 * away. T26: undo/redo of the unsaved session, multi-select with align and
 * distribute, real sizes from the zone's measures, inactive tables, and
 * touch drag (long press) on the phone.
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
  const [history, setHistory] = useState<History<Edits>>(EMPTY_HISTORY)
  const edits = history.present
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [zoneId, setZoneId] = useState<string | null>(() => takeEditorZone())
  const [view, setView] = useState<"plan" | "list">("plan")
  const [preview, setPreview] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  // Height of the sticky save bar while shown: the plan keeps that much space free under its content.
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)

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
      const change = payload as unknown as TableChange
      setBase((prev) => keepActiveFlag(prev, mergeTableList(prev, change), change.new as { id?: string; is_active?: unknown }))
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
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), [])
  const selected = draft.find((table) => table.id === selectedId) ?? null
  const multi = zoneTables.filter((table) => selectedIds.includes(table.id))

  // A table selected elsewhere (list, Sin ubicar, zone change) shows its zone.
  const selectedZoneId = selected && isPlaced(selected, zoneIds) ? selected.zoneId : undefined
  useEffect(() => {
    if (selectedZoneId) setZoneId(selectedZoneId)
  }, [selectedZoneId])

  /** Record the updated tables as one undo step (`gesture`: steps of one drag or field merge). */
  const commit = useCallback((updated: Table[], gesture: string | null = null) => {
    if (updated.length === 0) return
    setHistory((prev) => record(prev, { ...prev.present, ...Object.fromEntries(updated.map((table) => [table.id, layoutOf(table)])) }, gesture))
    setSaveError(null)
  }, [])

  const change = useCallback(
    (tableId: string, next: (table: Table) => Table | null, gesture: string | null = null) => {
      const current = draft.find((table) => table.id === tableId)
      const updated = current && next(current)
      if (updated) commit([updated], gesture)
    },
    [draft, commit],
  )

  const zoneOf = (table: Table) => zones.find((candidate) => candidate.id === table.zoneId) ?? { aspect: aspectOf(table) }

  const onMoveTables = (moves: { id: string; x: number; y: number }[], gesture: string) =>
    commit(
      moves.flatMap(({ id, x, y }) => {
        const table = draft.find((candidate) => candidate.id === id)
        return table ? [moveTo(table, x, y, aspectOf(table), { snap: false })] : []
      }),
      gesture,
    )

  const onNudgeTable = (tableId: string, key: string, big: boolean) => {
    const group = selectedIds.includes(tableId) && selectedIds.length > 1 ? multi : draft.filter((table) => table.id === tableId)
    commit(group.flatMap((table) => nudgeBy(table, key, big, zoneOf(table)) ?? []))
  }

  const onAlign = (mode: AlignMode) => zone && commit(alignTables(multi, mode, zone.aspect))
  const onDistribute = (axis: DistributeAxis) => zone && commit(distributeTables(multi, axis, zone.aspect))

  const onUndo = useCallback(() => setHistory((prev) => undo(prev)), [])
  const onRedo = useCallback(() => setHistory((prev) => redo(prev)), [])
  const planOpen = view === "plan" && !preview
  useEffect(() => {
    if (!planOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || inField(event.target)) return
      event.preventDefault()
      if (event.shiftKey) onRedo()
      else onUndo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [planOpen, onUndo, onRedo])

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
    }, `edit:${tableId}:${Object.keys(edit).sort().join(",")}`)

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
      setHistory(EMPTY_HISTORY)
      setAnnouncement("Plano guardado")
    } catch (error) {
      log.error("Error al guardar el plano:", { error: String(error) })
      setSaveError(error instanceof ApiError && error.status < 500 ? error.message : "No se pudo guardar el plano. Intente nuevamente.")
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setHistory(EMPTY_HISTORY)
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

  const setActive = async (tableId: string, isActive: boolean) => {
    try {
      const updated = tablesApi.toTable(await tablesApi.setTableActive(tableId, isActive))
      setBase((prev) => prev.map((table) => (table.id === tableId ? { ...updated, isActive: updated.isActive ?? isActive } : table)))
      setAnnouncement(`Mesa ${updated.number} ${isActive ? "activa" : "inactiva"}`)
    } catch (error) {
      log.error("Error al cambiar si la mesa está activa:", { error: String(error) })
      toast({ title: "Error", description: conflictMessage(error, "No se pudo cambiar la mesa."), variant: "destructive" })
    }
  }

  const deleteTable = async (tableId: string) => {
    try {
      await tablesApi.delete(tableId)
      setBase((prev) => prev.filter((table) => table.id !== tableId))
      // Its unsaved edits stay in the history: `applyEdits` only reads tables that exist.
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
      onSetActive={(isActive) => setActive(table.id, isActive)}
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

  const barShown = view === "plan" && (dirty.length > 0 || !!saveError)
  useEffect(() => {
    const bar = barRef.current
    if (!barShown || !bar) {
      setBarHeight(0)
      return
    }
    const measure = () => setBarHeight(bar.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [barShown])

  const saveBar = (dirty.length > 0 || saveError) && (
    <div
      ref={barRef}
      className="sticky bottom-3 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card-lg border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lg"
      aria-label="Cambios del plano"
      role="region"
    >
      {dirty.length > 0 && (
        <span className="min-w-0 flex-1 basis-full font-medium sm:basis-auto">
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
          {!preview && (
            <div role="group" aria-label="Historial" className="flex gap-1.5">
              <button
                type="button"
                aria-label={`Deshacer (${isMac() ? "⌘Z" : "Ctrl+Z"})`}
                title={`Deshacer (${isMac() ? "⌘Z" : "Ctrl+Z"})`}
                disabled={!canUndo(history)}
                className={cn(PILL, PILL_OFF, "w-11 justify-center px-0 disabled:opacity-40")}
                onClick={onUndo}
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Rehacer (${isMac() ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}
                title={`Rehacer (${isMac() ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}
                disabled={!canRedo(history)}
                className={cn(PILL, PILL_OFF, "w-11 justify-center px-0 disabled:opacity-40")}
                onClick={onRedo}
              >
                <Redo2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
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
        </div>

        {multi.length > 1 ? (
          <AlignToolbar count={multi.length} onAlign={onAlign} onDistribute={onDistribute} onClear={() => setSelectedIds([])} />
        ) : (
          zone && (
            <p className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
              <span>
                {isPhone ? "Mantén presionada una mesa para moverla" : "Arrastra una mesa o usa las flechas"} · imán de{" "}
                {hasDimensions(zone) ? `${SNAP_CM} cm` : "2,5 % del ancho"}
              </span>
              {!isPhone && <span>Shift + clic o arrastrar en el piso selecciona varias</span>}
              {!hasDimensions(zone) && <span>Sin medidas reales: indícalas en Gestionar zonas</span>}
            </p>
          )
        )}

        <div className="relative min-w-0">
          {zone ? (
            <div className={cn("min-w-0 overflow-auto rounded-card-lg p-3 sm:p-4", selected && "lg:pr-[22rem]")}>
              <EditorCanvas
                zone={zone}
                tables={zoneTables}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onMove={onMoveTables}
                onNudge={onNudgeTable}
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

        {selected && zone && selected.zoneId === zone.id && isPlaced(selected, zoneIds) && (
          <p aria-live="polite" className="text-xs tabular-nums text-fg-2">
            Mesa {selected.number} · {sizeText(selected, zone)}
            {hasDimensions(zone) && ` · x ${toCm(selected.x ?? 0.5, zone)} cm · y ${yToCm(selected.y ?? 0.5, zone)} cm`}
          </p>
        )}
        <UnplacedStrip tables={unplaced} selectedTableId={selectedId} onSelectTable={setSelectedId} waiterNameOf={waiterNameOf} />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {viewTabs}
      {/* The bar sticks 12 px above the bottom: reserve its height plus that offset. */}
      <div className="min-w-0" style={barHeight ? { paddingBottom: barHeight + 12 } : undefined} data-testid="plan-body">
        {body}
      </div>
      {view === "plan" && saveBar}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ZoneSheet open={sheetOpen} onOpenChange={setSheetOpen} zones={zones} onChanged={refreshZones} />
    </div>
  )
}

