"use client"

import { useMemo, useRef, useState } from "react"
import { ArrowLeft, ClipboardList, Plus, Search } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Panel } from "@/components/admin/common/Panel"
import { formatMoney, QuantityInput } from "@/components/admin/inventory-shared"
import { NativeSelect, signedClass } from "@/components/admin/stock/stock-ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  useApplyCount,
  useCancelCount,
  useInventoryCategories,
  useInventoryCount,
  useInventoryCounts,
  useInventoryItems,
  useInventoryLocations,
  useOpenCount,
  useSetCountedQuantity,
} from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import {
  buildCountRows,
  countApplySummary,
  countProgress,
  filterCountRows,
  type CountRowFilter,
  type CountSheetRow,
} from "@/lib/inventory/count-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import type { CountStatus, InventoryCount } from "@/lib/supabase/inventory/types"
import { cn } from "@/lib/utils"

interface CountsPageProps {
  description: string
  onNavigate?: (sectionId: string) => void
}

const STATUS_LABEL: Record<CountStatus, string> = { open: "Abierto", applied: "Aplicado", cancelled: "Cancelado" }
const STATUS_VARIANT = { open: "warning", applied: "default", cancelled: "outline" } as const

const FILTER_LABEL: Record<CountRowFilter, string> = { pending: "Pendientes", diff: "Con diferencia", all: "Todos" }

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium" })

const errorMessage = (error: unknown) => (error as { message?: string })?.message ?? "Ocurrió un error."

/** Item cost by id, used to value count differences. */
function useCostById() {
  const items = useInventoryItems()
  return useMemo(() => new Map((items.data ?? []).map((item) => [item.id, item.cost])), [items.data])
}

export function CountsPage({ description, onNavigate }: CountsPageProps) {
  const counts = useInventoryCounts()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  if (selectedId) return <CountSheet countId={selectedId} onBack={() => setSelectedId(null)} />

  const columns: DataTableColumn<InventoryCount>[] = [
    { id: "number", header: "N.º", cell: (c) => <span className="tabular-nums">#{c.number}</span> },
    { id: "location", header: "Bodega", cell: (c) => c.locationName ?? "—" },
    {
      id: "status",
      header: "Estado",
      cell: (c) => <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>,
    },
    { id: "progress", header: "Líneas contadas", cell: (c) => <CountStats countId={c.id} show="progress" /> },
    { id: "delta", header: "Diferencia valorizada", className: "text-right", cell: (c) => <CountStats countId={c.id} show="delta" /> },
    { id: "date", header: "Fecha", cell: (c) => formatDate(c.appliedAt ?? c.createdAt) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conteos físicos"
        description={description}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nuevo conteo
          </Button>
        }
      />

      <div className="flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          Las mermas (daño, vencimiento, desperdicio) se registran desde el detalle de cada artículo.
        </p>
        {onNavigate && (
          <Button variant="outline" size="sm" onClick={() => onNavigate("inventory/items")}>
            Registrar merma en Artículos
          </Button>
        )}
      </div>

      <Panel>
        <DataTable
          rows={counts.data ?? []}
          columns={columns}
          getRowId={(c) => c.id}
          isLoading={counts.isLoading}
          onRowClick={(c) => setSelectedId(c.id)}
          searchText={(c) => `${c.number} ${c.locationName ?? ""} ${c.notes ?? ""}`}
          searchPlaceholder="Buscar conteo…"
          empty={
            <EmptyState
              icon={ClipboardList}
              title="Sin conteos"
              description="Abre un conteo para comparar el stock del sistema con lo que hay en la bodega."
            />
          }
        />
      </Panel>

      <NewCountDialog
        open={creating}
        onOpenChange={setCreating}
        onOpened={(countId) => {
          setCreating(false)
          setSelectedId(countId)
        }}
      />
    </div>
  )
}

/** Per-count progress or valued difference; the detail query is shared by both cells. */
function CountStats({ countId, show }: { countId: string; show: "progress" | "delta" }) {
  const detail = useInventoryCount(countId)
  const costById = useCostById()
  if (!detail.data) return <span className="text-muted-foreground">…</span>
  const rows = buildCountRows(detail.data.lines, costById)
  if (show === "progress") {
    const { counted, total } = countProgress(rows)
    return (
      <span className="tabular-nums">
        {counted}/{total}
      </span>
    )
  }
  const { valueDelta } = countApplySummary(rows)
  return <span className={cn("tabular-nums", signedClass(valueDelta))}>{formatMoney(valueDelta)}</span>
}

interface NewCountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpened: (countId: string) => void
}

function NewCountDialog({ open, onOpenChange, onOpened }: NewCountDialogProps) {
  const { toast } = useToast()
  const locations = (useInventoryLocations().data ?? []).filter((l) => l.isActive)
  const categories = useInventoryCategories().data ?? []
  const items = useInventoryItems().data ?? []
  const openCount = useOpenCount()
  const [locationId, setLocationId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)

  const effectiveLocationId = locationId || locations.find((l) => l.isDefault)?.id || locations[0]?.id || ""
  const categoryItemIds = categoryId
    ? items.filter((item) => item.isActive && item.categoryId === categoryId).map((item) => item.id)
    : null

  const submit = async () => {
    setError(null)
    if (categoryItemIds && categoryItemIds.length === 0) {
      setError("La categoría no tiene artículos activos.")
      return
    }
    try {
      const result = await openCount.mutateAsync({
        locationId: effectiveLocationId || null,
        itemIds: categoryItemIds,
        notes: notes.trim() || null,
      })
      toast({ title: `Conteo #${result.number} abierto`, description: `${result.linesCount} artículos por contar` })
      setCategoryId("")
      setNotes("")
      onOpened(result.countId)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo conteo</DialogTitle>
          <DialogDescription>Se toma una foto del stock esperado al abrir el conteo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="count-location">Bodega</Label>
            <NativeSelect id="count-location" value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count-category">Artículos</Label>
            <NativeSelect id="count-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todos los artículos</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  Categoría: {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count-notes">Notas (opcional)</Label>
            <Textarea id="count-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={openCount.isPending}>
            {openCount.isPending ? "Abriendo…" : "Abrir conteo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CountSheet({ countId, onBack }: { countId: string; onBack: () => void }) {
  const { toast } = useToast()
  const detail = useInventoryCount(countId)
  const costById = useCostById()
  const setCounted = useSetCountedQuantity()
  const applyCount = useApplyCount()
  const cancelCount = useCancelCount()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<CountRowFilter>("all")
  const [showExpected, setShowExpected] = useState(false)
  const [confirm, setConfirm] = useState<"apply" | "cancel" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const rows = useMemo(() => buildCountRows(detail.data?.lines ?? [], costById), [detail.data, costById])
  const visible = useMemo(() => filterCountRows(rows, filter, query), [rows, filter, query])
  const progress = countProgress(rows)
  const summary = countApplySummary(rows)
  const count = detail.data
  const isOpen = count?.status === "open"

  const save = async (row: CountSheetRow, value: number | null, moveNext: boolean) => {
    const index = visible.findIndex((r) => r.lineId === row.lineId)
    const nextId = moveNext ? visible[index + 1]?.lineId : undefined
    setError(null)
    try {
      await setCounted.mutateAsync({ countId, lineId: row.lineId, countedQuantity: value })
      if (nextId) inputs.current.get(nextId)?.focus()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const runConfirm = async () => {
    const action = confirm
    setConfirm(null)
    try {
      if (action === "apply") {
        const result = await applyCount.mutateAsync(countId)
        toast({
          title: "Conteo aplicado",
          description: `${result.adjustedLines} líneas ajustadas · ${formatMoney(result.valueDelta)}`,
        })
      } else if (action === "cancel") {
        await cancelCount.mutateAsync(countId)
        toast({ title: "Conteo cancelado" })
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (detail.isLoading || !count) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Conteo #${count.number}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {count.locationName}
            <Badge variant={STATUS_VARIANT[count.status]}>{STATUS_LABEL[count.status]}</Badge>
            {count.notes && <span>· {count.notes}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Conteos
            </Button>
            {isOpen && (
              <>
                <Button variant="outline" onClick={() => setConfirm("cancel")}>
                  Cancelar conteo
                </Button>
                <Button onClick={() => setConfirm("apply")} disabled={progress.counted === 0}>
                  Aplicar conteo
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progreso</span>
          <span className="tabular-nums">
            {progress.counted}/{progress.total} contados · {progress.percent} %
          </span>
        </div>
        <Progress value={progress.percent} aria-label="Progreso del conteo" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            aria-label="Buscar por nombre o SKU"
            className="pl-8"
          />
        </div>
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Filtro de líneas">
          {(Object.keys(FILTER_LABEL) as CountRowFilter[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "secondary" : "ghost"}
              aria-pressed={filter === key}
              className="h-7 flex-1"
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm sm:ml-auto">
          <Switch checked={showExpected} onCheckedChange={setShowExpected} aria-label="Mostrar esperado" />
          Mostrar esperado
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin líneas para este filtro</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Hoja de conteo">
          {visible.map((row) => (
            <li
              key={row.lineId}
              data-testid={`count-row-${row.lineId}`}
              className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(0,1fr)_7rem_13rem_9rem] md:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.sku} · {row.unit}
                </p>
              </div>
              <div className="text-sm tabular-nums md:text-right">
                {showExpected ? (
                  <span>
                    <span className="text-muted-foreground md:hidden">Esperado: </span>
                    {formatQuantity(row.expected, row.unit)}
                  </span>
                ) : null}
              </div>
              <div>
                {isOpen ? (
                  <div className="flex items-start gap-1">
                    <QuantityInput
                      ref={(el) => {
                        if (el) inputs.current.set(row.lineId, el)
                        else inputs.current.delete(row.lineId)
                      }}
                      label={`Contado ${row.name}`}
                      unit={row.unit}
                      value={row.counted}
                      showSteppers={false}
                      className="flex-1"
                      onChange={() => {}}
                      onCommit={(value) => save(row, value, true)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-2"
                      title="Contado en cero"
                      onClick={() => save(row, 0, false)}
                    >
                      0
                    </Button>
                  </div>
                ) : (
                  <span className="tabular-nums">{row.counted === null ? "Sin contar" : formatQuantity(row.counted, row.unit)}</span>
                )}
              </div>
              <div className="text-sm tabular-nums md:text-right">
                {row.difference === null ? (
                  <span className="text-muted-foreground">Pendiente</span>
                ) : showExpected || !isOpen ? (
                  <span className={signedClass(row.difference)}>
                    {row.difference > 0 ? "+" : ""}
                    {formatQuantity(row.difference, row.unit)}
                    <span className="block text-xs">{formatMoney(row.differenceValue ?? 0)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Contado</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "apply" ? "¿Aplicar conteo?" : "¿Cancelar conteo?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {confirm === "apply" ? (
                <div className="space-y-1 text-sm" data-testid="apply-summary">
                  <p>Líneas con diferencia: {summary.linesWithDifference}</p>
                  <p>Diferencia valorizada total: {formatMoney(summary.valueDelta)}</p>
                  <p>
                    El stock de la bodega quedará igual a lo contado. Las {summary.uncounted} líneas sin contar se
                    dejan sin cambios.
                  </p>
                </div>
              ) : (
                <p>El conteo se cerrará sin modificar el stock.</p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm}>{confirm === "apply" ? "Aplicar" : "Cancelar conteo"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
