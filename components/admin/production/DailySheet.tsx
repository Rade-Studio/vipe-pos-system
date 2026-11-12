"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { CalendarDays, ChevronDown, Download, X } from "lucide-react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ProductionShortageError,
  useCreateProductionTemplate,
  useInventoryLocations,
  useProducePreparations,
  useProductionBatches,
  useProductionTemplates,
  useStaffMembers,
  useStockAtLocation,
} from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import type { FormulaItem } from "@/lib/inventory/formula"
import { parseProductionCsv, productionTemplateCsv } from "@/lib/inventory/production-csv"
import {
  addDaysIso,
  businessDates,
  dayLabel,
  expiryFor,
  localIsoDate,
  rowMax,
  shortDayLabel,
  sumBatchesByItem,
  summarizeSheet,
  withStock,
  type BulkShortage,
} from "@/lib/inventory/production-sheet"
import { formatQuantity, parseQuantityInput } from "@/lib/inventory/units"
import type { Formula, InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { downloadCsv, matchesPrep, PrepFilters, PrepStatusBadge, quantityText, sortPreps, type StatusFilter } from "./production-ui"
import { SummaryDialog, type SheetWarning } from "./SummaryDialog"

interface DailySheetProps {
  preps: InventoryItem[]
  byPrep: Record<string, Formula | undefined>
  itemsById: Map<string, FormulaItem>
}

const RESPONSIBLE_ROLES = new Set(["kitchen", "admin"])

/** S3–S4: a whole day's production typed (or filled) at once and saved in one transaction. */
export function DailySheet({ preps, byPrep, itemsById }: DailySheetProps) {
  const { toast } = useToast()
  const locationsQuery = useInventoryLocations()
  const staffQuery = useStaffMembers()
  const templatesQuery = useProductionTemplates()
  const bulk = useProducePreparations()
  const createTemplate = useCreateProductionTemplate()

  const today = localIsoDate(new Date())
  const dates = useMemo(() => businessDates(new Date()), [])
  const [producedOn, setProducedOn] = useState(today)
  const [producedBy, setProducedBy] = useState("")
  const [locationId, setLocationId] = useState("")
  const [contextOpen, setContextOpen] = useState(false)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [menuOpen, setMenuOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [serverError, setServerError] = useState<{ message: string; shortages: BulkShortage[] } | null>(null)
  const sheetRef = useRef<HTMLTableSectionElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const locations = (locationsQuery.data ?? []).filter((location) => location.isActive)
  const effectiveLocationId = locationId || (locations.find((l) => l.isDefault) ?? locations[0])?.id || ""
  const locationName = locations.find((l) => l.id === effectiveLocationId)?.name ?? "—"
  const staff = (staffQuery.data ?? [])
    .filter((member) => member.active && RESPONSIBLE_ROLES.has(member.role))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"))
  const responsibleName = staff.find((member) => member.id === producedBy)?.fullName ?? "Tú"
  const dateLabel = (dates.find((d) => d.value === producedOn)?.label ?? dayLabel(producedOn)).replace(" (reporte tardío)", "")

  const previousDay = addDaysIso(producedOn, -1)
  const previousQuery = useProductionBatches({ from: previousDay, to: previousDay, limit: 500 })

  // Max producible at the chosen bodega: the stock of each ingredient there, from its lots.
  const ingredientIds = useMemo(
    () => [...new Set(preps.flatMap((prep) => byPrep[prep.id]?.lines.map((line) => line.ingredientId) ?? []))],
    [preps, byPrep],
  )
  const locationStock = useStockAtLocation(ingredientIds, effectiveLocationId)
  const scoped = useMemo(() => (locationStock ? withStock(itemsById, locationStock) : itemsById), [itemsById, locationStock])

  const sorted = useMemo(() => sortPreps(preps), [preps])
  const prepsById = useMemo(() => new Map(preps.map((prep) => [prep.id, prep])), [preps])
  const hasFormula = (prep: InventoryItem) => Boolean(byPrep[prep.id]?.lines.length)

  const parsed = useMemo(() => {
    const quantities: Record<string, number> = {}
    const invalid: string[] = []
    for (const prep of sorted) {
      const text = (texts[prep.id] ?? "").trim()
      if (!text) continue
      const result = parseQuantityInput(text, prep.unit)
      if (result.ok) quantities[prep.id] = Math.round(result.value * 10_000) / 10_000
      else invalid.push(prep.id)
    }
    return { quantities, invalid }
  }, [sorted, texts])
  const summary = useMemo(() => summarizeSheet(parsed.quantities, byPrep, scoped), [parsed.quantities, byPrep, scoped])
  const rowsById = new Map(summary.rows.map((row) => [row.itemId, row]))
  const insufficient = summary.insufficientIds.length
  const entered = summary.count + parsed.invalid.length
  const blocked = summary.exceedCount > 0 || parsed.invalid.length > 0

  const list = sorted.filter((prep) => matchesPrep(prep, query, status))

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [menuOpen])

  const maxHint = (prep: InventoryItem) => {
    const max = rowMax(byPrep[prep.id], scoped)
    return max > 0 ? `máx. ${formatQuantity(max, prep.unit)}` : `Sin insumos · máx. 0 ${prep.unit}`
  }
  const exceedText = (prep: InventoryItem) => {
    const max = rowMax(byPrep[prep.id], scoped)
    return max > 0 ? `No alcanzan los insumos: máx. ${formatQuantity(max, prep.unit)}.` : "Sin insumos para producir: máx. 0."
  }
  const lotPreview = (prep: InventoryItem) => {
    const expiresOn = expiryFor(producedOn, prep.shelfLifeDays)
    return `Lote automático${expiresOn ? ` · vence ${shortDayLabel(expiresOn)}` : ""}`
  }

  const fill = (quantities: Record<string, number>, label: string) => {
    const known = Object.entries(quantities).filter(([id, q]) => prepsById.has(id) && q > 0)
    setTexts((current) => ({ ...current, ...Object.fromEntries(known.map(([id, q]) => [id, quantityText(q)])) }))
    setQuery("")
    setStatus("all")
    toast({ title: label, description: `${known.length} cantidades cargadas. Revisa y ajusta antes de registrar.` })
  }

  const focusInput = (index: number) => {
    const inputs = [...(sheetRef.current?.querySelectorAll<HTMLInputElement>("input[data-sheet-qty]:not(:disabled)") ?? [])]
    return { inputs, target: inputs[index] }
  }

  const onQtyKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const { inputs } = focusInput(0)
    const next = inputs[inputs.indexOf(event.currentTarget) + (event.key === "ArrowUp" ? -1 : 1)]
    if (next) {
      next.focus()
      next.select()
    } else if (event.key !== "ArrowUp") reviewRef.current?.focus()
  }

  const fixFirst = () => {
    setReviewOpen(false)
    const firstBad = [...summary.rows.filter((r) => r.exceeds).map((r) => r.itemId), ...parsed.invalid][0]
    setQuery("")
    setStatus("all")
    setTimeout(() => document.getElementById(`sheet-qty-${firstBad}`)?.focus(), 0)
  }

  const register = async () => {
    setServerError(null)
    try {
      const result = await bulk.mutateAsync({
        lines: summary.rows.map((row) => ({ itemId: row.itemId, quantity: row.quantity })),
        locationId: effectiveLocationId || null,
        producedOn,
        ...(producedBy ? { producedBy } : {}),
      })
      const n = summary.count
      toast({
        title: n === 1 ? "1 lote registrado" : `${n} lotes registrados`,
        description: `Costo ${formatMoney(result.totalCost)} · ${dayLabel(producedOn)}. Los ves en la pestaña Lotes.`,
      })
      setTexts({})
      setReviewOpen(false)
    } catch (error) {
      setServerError({
        message: (error as Error).message ?? "No se pudo registrar la producción.",
        shortages: error instanceof ProductionShortageError ? error.prepShortages : [],
      })
    }
  }

  const warnings: SheetWarning[] = [
    ...summary.rows.filter((r) => r.exceeds).map((r) => {
      const prep = prepsById.get(r.itemId) as InventoryItem
      return { tone: "danger" as const, text: `${prep.name}: ${exceedText(prep)}` }
    }),
    ...parsed.invalid.map((id) => ({ tone: "danger" as const, text: `${prepsById.get(id)?.name}: cantidad no válida.` })),
    ...summary.netShortages
      .filter((s) => s.itemIds.length > 1)
      .map((s) => ({
        tone: "danger" as const,
        text: `${s.name}: juntas necesitan ${formatQuantity(s.required, s.unit)} y hay ${formatQuantity(s.available, s.unit)} (${s.itemIds
          .map((id) => prepsById.get(id)?.name)
          .join(", ")}). Si registras, el sistema lo rechazará completo.`,
      })),
    ...(producedOn !== today
      ? [
          {
            tone: "warning" as const,
            text: `Registras con fecha ${producedOn === addDaysIso(today, -1) ? "de ayer" : "del"} (${dayLabel(producedOn)}); los lotes vencen contando desde ese día.`,
          },
        ]
      : []),
  ]

  const templates = templatesQuery.data ?? []
  const csvPreps = sorted.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))

  const importFile = async (file: File) => {
    const result = parseProductionCsv(await file.text(), csvPreps)
    if (!result.ok) {
      setImportMessage(result.error)
      return
    }
    const loaded = Object.keys(result.quantities).length
    setTexts((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(result.quantities).map(([id, q]) => [id, quantityText(q)])),
    }))
    setImportMessage(
      `Se cargaron ${loaded} cantidades del reporte` +
        (result.unknown.length ? ` · no reconocimos: ${result.unknown.join(", ")}` : "") +
        (result.invalid.length ? ` · cantidad no válida en: ${result.invalid.join(", ")}` : "") +
        ".",
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-2 pl-4">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" aria-live="polite">
            <b className="font-semibold text-foreground">{dateLabel}</b> · {responsibleName} · {locationName}
          </p>
          <Button
            variant="ghost"
            className="min-h-11"
            aria-expanded={contextOpen}
            aria-controls="sheet-context"
            onClick={() => setContextOpen((open) => !open)}
          >
            {contextOpen ? "Listo" : "Cambiar"}
          </Button>
          <div className="relative w-full sm:w-auto" ref={menuRef}>
            <Button
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              aria-expanded={menuOpen}
              aria-controls="sheet-fill-menu"
              onClick={() => setMenuOpen((open) => !open)}
              onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
            >
              Llenar cantidades <ChevronDown aria-hidden />
            </Button>
            {menuOpen && (
              <div
                id="sheet-fill-menu"
                role="group"
                aria-label="Llenar cantidades"
                onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                className="absolute left-0 top-full z-30 mt-1.5 grid min-w-64 gap-0.5 rounded-xl border bg-popover p-1.5 shadow-lg sm:left-auto sm:right-0"
              >
                <MenuItem
                  title="Repetir producción de ayer"
                  hint={`Copia las cantidades del ${dayLabel(previousDay)}`}
                  onClick={() => {
                    setMenuOpen(false)
                    fill(sumBatchesByItem(previousQuery.data ?? []), `Producción del ${dayLabel(previousDay)}`)
                  }}
                />
                <p className="mx-3 mb-0.5 mt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plantillas</p>
                {templates.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Aún no tienes plantillas.</p>}
                {templates.map((template) => (
                  <MenuItem
                    key={template.id}
                    title={template.name}
                    hint={`${template.lines.length} ${template.lines.length === 1 ? "preparación" : "preparaciones"}`}
                    onClick={() => {
                      setMenuOpen(false)
                      fill(Object.fromEntries(template.lines.map((l) => [l.itemId, l.quantity])), `Plantilla “${template.name}”`)
                    }}
                  />
                ))}
                <MenuItem
                  title="Guardar como plantilla"
                  hint="Guarda las cantidades de la tabla con un nombre"
                  disabled={summary.count === 0}
                  onClick={() => {
                    setMenuOpen(false)
                    setSaveOpen(true)
                  }}
                />
                <div aria-hidden className="mx-1.5 my-1 h-px bg-border" />
                <MenuItem
                  title="Importar desde reporte (CSV)"
                  hint="Sube el archivo que te pasa cocina"
                  onClick={() => {
                    setMenuOpen(false)
                    setImportOpen(true)
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {contextOpen && (
          <div id="sheet-context" className="mt-2 grid gap-3 border-t py-2 pr-2 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sheet-date">Fecha</Label>
              <NativeSelect id="sheet-date" className="h-11" value={producedOn} onChange={(e) => setProducedOn(e.target.value)}>
                {dates.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sheet-responsible">Responsable</Label>
              <NativeSelect id="sheet-responsible" className="h-11" value={producedBy} onChange={(e) => setProducedBy(e.target.value)}>
                <option value="">Tú (quien registra)</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sheet-location">Bodega</Label>
              <NativeSelect id="sheet-location" className="h-11" value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}

        {importOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
            <ol className="basis-full list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                <b className="text-foreground">Descarga la plantilla</b>: trae todas tus preparaciones con su código y unidad.
              </li>
              <li>
                <b className="text-foreground">Llena la columna cantidad</b> en Excel o Google Sheets; deja vacío lo que no se produjo.
              </li>
              <li>
                <b className="text-foreground">Súbela aquí</b>: las cantidades se cargan en la tabla para que las revises antes de registrar.
              </li>
            </ol>
            <div className="grid basis-full gap-0.5 overflow-x-auto rounded-md border bg-card px-3 py-2 font-mono text-xs" aria-label="Así se ve la plantilla">
              <code>codigo;preparacion;unidad;cantidad</code>
              {csvPreps.slice(0, 2).map((p, i) => (
                <code key={p.id}>
                  {p.sku};{p.name};{p.unit};{i === 0 ? "4,5" : ""}
                </code>
              ))}
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => downloadCsv("plantilla-produccion.csv", productionTemplateCsv(csvPreps))}
            >
              <Download aria-hidden />
              Descargar plantilla (CSV)
            </Button>
            <span className="relative inline-flex min-h-11 items-center rounded-md border bg-background px-4 font-medium focus-within:ring-2 focus-within:ring-ring">
              Elegir archivo CSV
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Elegir archivo CSV del reporte"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) return importFile(file)
                }}
              />
            </span>
            <Button variant="ghost" size="icon" className="ml-auto h-11 w-11" aria-label="Cerrar importación" onClick={() => setImportOpen(false)}>
              <X aria-hidden />
            </Button>
            {importMessage && (
              <p role="status" className="basis-full">
                {importMessage}
              </p>
            )}
          </div>
        )}
      </div>

      <PrepFilters preps={preps} query={query} status={status} onQuery={setQuery} onStatus={setStatus} label="Filtrar la hoja por estado">
        <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
          <kbd className="rounded border px-1.5 font-mono">Enter</kbd> o <kbd className="rounded border px-1.5 font-mono">↓</kbd> pasa a la siguiente
        </span>
      </PrepFilters>

      <div className="rounded-lg border bg-card">
        <table className="block w-full text-sm md:table" aria-label="Producción del día: escribe la cantidad producida de cada preparación">
          <thead className="hidden md:table-header-group">
            <tr className="text-xs text-muted-foreground">
              {["Preparación", "Estado", "Stock actual", "Cantidad producida", "Lote · vence", "Costo"].map((label, i) => (
                <th
                  key={label}
                  scope="col"
                  className={cn("sticky top-0 z-10 h-10 border-b bg-card px-3 text-left font-medium", (i === 2 || i === 5) && "text-right")}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={sheetRef} className="block md:table-row-group">
            {list.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={6} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                  Ninguna preparación coincide.
                </td>
              </tr>
            )}
            {list.map((prep) => {
              const row = rowsById.get(prep.id)
              const invalid = parsed.invalid.includes(prep.id)
              const bad = invalid || Boolean(row?.exceeds)
              const short = summary.insufficientIds.includes(prep.id)
              const withFormula = hasFormula(prep)
              const inputId = `sheet-qty-${prep.id}`
              return (
                <tr
                  key={prep.id}
                  data-state={bad ? "bad" : row ? "has" : undefined}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 md:table-row md:p-0",
                    row && !bad && "bg-primary/5",
                    bad && "bg-destructive/10",
                  )}
                >
                  <td className="block min-w-0 md:table-cell md:px-3 md:py-1.5">
                    <span className="block truncate font-medium">{prep.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{prep.sku}</span>
                  </td>
                  <td className="block justify-self-end md:table-cell md:px-3 md:py-1.5">
                    <PrepStatusBadge item={prep} />
                  </td>
                  <td className="hidden tabular-nums md:table-cell md:px-3 md:py-1.5 md:text-right">{formatQuantity(prep.stock, prep.unit)}</td>
                  <td className="col-span-2 mt-1 block md:mt-0 md:table-cell md:w-56 md:px-3 md:py-1.5">
                    <div className="relative">
                      <Input
                        id={inputId}
                        data-sheet-qty
                        aria-label={`Cantidad producida de ${prep.name} en ${prep.unit}`}
                        aria-invalid={bad || undefined}
                        aria-describedby={`${inputId}-hint`}
                        inputMode="decimal"
                        autoComplete="off"
                        enterKeyHint="next"
                        placeholder="—"
                        disabled={!withFormula}
                        value={texts[prep.id] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value
                          setTexts((current) => ({ ...current, [prep.id]: value }))
                        }}
                        onKeyDown={onQtyKey}
                        className={cn("h-11 pr-16 tabular-nums", bad && "border-destructive ring-1 ring-destructive")}
                      />
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                        {prep.unit}
                      </span>
                    </div>
                    <span
                      id={`${inputId}-hint`}
                      className={cn("mt-1 block text-xs text-muted-foreground", bad && "font-medium text-destructive", short && !bad && "text-yellow-700 dark:text-yellow-400")}
                    >
                      {!withFormula ? "Sin fórmula" : invalid ? "Cantidad no válida." : row?.exceeds ? exceedText(prep) : maxHint(prep)}
                    </span>
                  </td>
                  <td className="block text-xs text-muted-foreground md:table-cell md:px-3 md:py-1.5">{row && !bad ? lotPreview(prep) : ""}</td>
                  <td className="block justify-self-end tabular-nums md:table-cell md:px-3 md:py-1.5 md:text-right">
                    {row && !bad ? <b>{formatMoney(row.cost)}</b> : ""}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div
        role="region"
        aria-label="Resumen de la producción del día"
        className="sticky bottom-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-background/95 p-3 pl-4 shadow-lg backdrop-blur"
      >
        <p className="min-w-0 flex-1 basis-72 text-sm" aria-live="polite">
          {entered === 0 ? (
            <>Escribe lo que produjo cocina; deja vacío lo que no se produjo.</>
          ) : (
            <>
              <b>
                {entered} {entered === 1 ? "preparación" : "preparaciones"}
              </b>{" "}
              · costo total <b className="tabular-nums">{formatMoney(summary.totalCost)}</b>
              {insufficient > 0 && <span className="font-semibold text-destructive"> · {insufficient} con ingredientes insuficientes</span>}
              {parsed.invalid.length > 0 && (
                <span className="font-semibold text-destructive"> · {parsed.invalid.length} con cantidad por corregir</span>
              )}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" className="min-h-11" disabled={entered === 0} onClick={() => setTexts({})}>
            Limpiar
          </Button>
          <Button
            ref={reviewRef}
            className="min-h-11"
            aria-haspopup="dialog"
            disabled={entered === 0}
            onClick={() => {
              setServerError(null)
              setReviewOpen(true)
            }}
          >
            Revisar y registrar
          </Button>
        </div>
      </div>

      <SummaryDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={`Revisar producción del ${dayLabel(producedOn)}`}
        description={`${responsibleName} · ${locationName} · ${summary.count} ${summary.count === 1 ? "lote" : "lotes"} por crear`}
        summary={summary}
        prepsById={prepsById}
        lotPreview={lotPreview}
        warnings={warnings}
        blocked={blocked}
        pending={bulk.isPending}
        serverError={serverError}
        onFix={fixFirst}
        onConfirm={register}
      />

      <SaveTemplateDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        pending={createTemplate.isPending}
        onSave={async (name) => {
          await createTemplate.mutateAsync({
            name,
            lines: summary.rows.map((row) => ({ itemId: row.itemId, quantity: row.quantity })),
          })
          toast({ title: "Plantilla guardada", description: `“${name}” con ${summary.count} preparaciones.` })
        }}
      />
    </div>
  )
}

function MenuItem({ title, hint, onClick, disabled }: { title: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-11 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span>{title}</span>
      <small className="text-xs text-muted-foreground">{hint}</small>
    </button>
  )
}

function SaveTemplateDialog({
  open,
  onOpenChange,
  pending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    try {
      await onSave(name.trim())
      setName("")
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar la plantilla.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar como plantilla</DialogTitle>
          <DialogDescription>Guarda las cantidades de la tabla para llenarlas otro día con un clic.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Nombre de la plantilla</Label>
            <Input
              id="template-name"
              className="h-11"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              placeholder="Lunes habitual"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" className="min-h-11" disabled={!name.trim() || pending}>
              Guardar plantilla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
