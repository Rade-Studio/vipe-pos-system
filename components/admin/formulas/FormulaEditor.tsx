"use client"

import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch } from "react"
import { ArrowLeft, Copy, Factory, Scaling, Soup } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { StatCard } from "@/components/admin/common/StatCard"
import {
  ItemCombobox,
  MarginBadge,
  QuantityInput,
  defaultQuantity,
  formatMoney,
  type ItemComboboxHandle,
} from "@/components/admin/inventory-shared"
import {
  formulaCost,
  maxProducible,
  priceMetrics,
  wouldCreateCycle,
  type FormulaItem,
  type FormulaLine,
  type PrepFormula,
} from "@/lib/inventory/formula"
import { isLevelDirty, type EditorAction, type EditorLevel } from "@/lib/inventory/formula-editor"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem } from "@/lib/supabase/inventory/types"
import { FormulaLineRow } from "./FormulaLineRow"

export interface CopySource {
  id: string
  type: "dish" | "prep"
  name: string
  lines: FormulaLine[]
}

interface FormulaEditorProps {
  level: EditorLevel
  /** Names of every open level, root first (breadcrumb). */
  trail: string[]
  /** Ids of every open level: a nested prep cannot use any of them. */
  openIds: string[]
  focusLineId: string | null
  dispatch: Dispatch<EditorAction>
  items: InventoryItem[]
  itemsById: Map<string, FormulaItem>
  prepFormulas: Map<string, PrepFormula>
  /** Dish price; undefined for preparations. */
  price?: number
  priceSuggestion: number
  copySources: CopySource[]
  saving: boolean
  onSave: () => void
  onBack?: () => void
  onCreatePrep: (name: string) => void
  onEditPrep: (item: FormulaItem) => void
  onNavigate?: (sectionId: string) => void
}

const SCALE_PRESETS = [
  { factor: 0.5, label: "×0,5" },
  { factor: 2, label: "×2" },
  { factor: 3, label: "×3" },
]

export function FormulaEditor({
  level,
  trail,
  openIds,
  focusLineId,
  dispatch,
  items,
  itemsById,
  prepFormulas,
  price,
  priceSuggestion,
  copySources,
  saving,
  onSave,
  onBack,
  onCreatePrep,
  onEditPrep,
  onNavigate,
}: FormulaEditorProps) {
  const { target, lines, yieldQuantity } = level
  const isPrep = target.type === "prep"
  const dirty = isLevelDirty(level)
  const prepItem = isPrep ? itemsById.get(target.id) : undefined
  const comboboxRef = useRef<ItemComboboxHandle>(null)
  const quantityRefs = useRef(new Map<string, HTMLInputElement>())
  const [copyOpen, setCopyOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [customFactor, setCustomFactor] = useState("")

  useEffect(() => {
    if (!focusLineId) return
    const input = quantityRefs.current.get(focusLineId)
    if (input) {
      input.focus()
      dispatch({ type: "clearFocus" })
    }
  }, [focusLineId, lines, dispatch])

  const cost = useMemo(() => formulaCost(lines, itemsById, yieldQuantity), [lines, itemsById, yieldQuantity])
  const costByLine = new Map(cost.lines.map((line) => [line.ingredientId, line]))
  const metrics = price !== undefined ? priceMetrics(cost.perUnit, price, priceSuggestion) : null
  const producible = isPrep ? maxProducible({ yieldQuantity, lines }, itemsById) : 0
  const skuById = useMemo(() => new Map(items.map((item) => [item.id, item.sku])), [items])

  const disabledReason = (candidate: InventoryItem): string | null => {
    if (candidate.id === target.id) return "No puede usarse a sí misma"
    if (openIds.includes(candidate.id)) return "Crearía un ciclo"
    if (isPrep && candidate.kind === "prep" && wouldCreateCycle(target.id, candidate.id, prepFormulas)) {
      return "Crearía un ciclo"
    }
    return null
  }

  const applyScale = (factor: number) => {
    dispatch({ type: "scale", factor })
    setScaleOpen(false)
    setCustomFactor("")
  }

  const customValue = Number(customFactor.replace(",", "."))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        {trail.length > 1 && (
          <div className="flex items-center gap-2">
            {onBack && (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onBack}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
                Volver
              </Button>
            )}
            <Breadcrumb>
              <BreadcrumbList>
                {trail.map((name, index) => (
                  <Fragment key={`${name}-${index}`}>
                    {index > 0 && <BreadcrumbSeparator>›</BreadcrumbSeparator>}
                    <BreadcrumbItem>
                      {index === trail.length - 1 ? (
                        <BreadcrumbPage>{name}</BreadcrumbPage>
                      ) : (
                        <span className="text-muted-foreground">{name}</span>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{target.name}</h2>
              <Badge variant={isPrep ? "secondary" : "outline"} className="font-normal">
                {isPrep ? "Preparación" : "Plato"}
              </Badge>
              {dirty && (
                <Badge variant="warning" className="font-normal">
                  Sin guardar
                </Badge>
              )}
            </div>
            {isPrep && prepItem && (
              <p className="text-sm text-muted-foreground">
                Se puede producir:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatQuantity(Math.floor(producible * 1000) / 1000, prepItem.unit)}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={copyOpen} onOpenChange={setCopyOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={copySources.length === 0}>
                  <Copy className="mr-1.5 h-4 w-4" aria-hidden />
                  Copiar de…
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <Command label="Buscar fórmula para copiar">
                  <CommandInput placeholder="Buscar fórmula…" />
                  <CommandList>
                    <CommandEmpty>Sin resultados</CommandEmpty>
                    {(["dish", "prep"] as const).map((type) => {
                      const sources = copySources.filter((source) => source.type === type)
                      if (sources.length === 0) return null
                      return (
                        <CommandGroup key={type} heading={type === "dish" ? "Platos" : "Preparaciones"}>
                          {sources.map((source) => (
                            <CommandItem
                              key={source.id}
                              value={`${source.name} ${source.id}`}
                              onSelect={() => {
                                dispatch({ type: "copy", lines: source.lines })
                                setCopyOpen(false)
                              }}
                            >
                              <span className="flex-1 truncate">{source.name}</span>
                              <span className="text-xs text-muted-foreground">{source.lines.length}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )
                    })}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Popover open={scaleOpen} onOpenChange={setScaleOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={lines.length === 0}>
                  <Scaling className="mr-1.5 h-4 w-4" aria-hidden />
                  Escalar
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 space-y-3" align="end">
                <p className="text-sm font-medium">Escalar todas las cantidades</p>
                <div className="flex gap-1.5">
                  {SCALE_PRESETS.map((preset) => (
                    <Button
                      key={preset.factor}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => applyScale(preset.factor)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <form
                  className="flex gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (customValue > 0) applyScale(customValue)
                  }}
                >
                  <Input
                    value={customFactor}
                    onChange={(event) => setCustomFactor(event.target.value)}
                    placeholder="1,5"
                    inputMode="decimal"
                    aria-label="Factor personalizado"
                    className="h-8"
                  />
                  <Button type="submit" size="sm" disabled={!(customValue > 0)}>
                    Aplicar
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
            {isPrep && (
              <Button type="button" variant="outline" size="sm" onClick={() => onNavigate?.("inventory/production")}>
                <Factory className="mr-1.5 h-4 w-4" aria-hidden />
                Producir
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard title="Costo total" value={formatMoney(cost.total)} hint={`${lines.length} ingredientes`} />
        <StatCard
          title={isPrep ? "Costo por unidad" : "Costo por porción"}
          value={formatMoney(cost.perUnit)}
          hint={isPrep && prepItem ? `por ${prepItem.unit}` : yieldQuantity !== 1 ? `${yieldQuantity} porciones` : undefined}
        />
        {metrics && price !== undefined ? (
          <>
            <StatCard
              title="Precio y margen"
              value={formatMoney(price)}
              hint={
                <span className="inline-flex items-center gap-1.5">
                  Margen {formatMoney(metrics.margin)} <MarginBadge marginPct={metrics.marginPct} />
                </span>
              }
            />
            <StatCard
              title="Precio sugerido"
              value={formatMoney(metrics.suggestedPrice)}
              hint={`Costo × ${priceSuggestion} %`}
            />
          </>
        ) : (
          prepItem && (
            <div className="col-span-2 rounded-lg border bg-card p-4">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Rinde</p>
              <QuantityInput
                value={yieldQuantity}
                unit={prepItem.unit}
                label="Rinde"
                showPresets
                onChange={(value) => dispatch({ type: "setYield", yieldQuantity: value })}
                onCommit={() => comboboxRef.current?.focus()}
              />
            </div>
          )
        )}
      </div>

      <div className="space-y-2">
        <ItemCombobox
          ref={comboboxRef}
          items={items}
          hotkey
          autoFocus={lines.length === 0}
          label="Agregar ingrediente"
          placeholder="Agregar ingrediente o preparación…"
          disabledReason={disabledReason}
          onSelect={(item) =>
            dispatch({ type: "addLine", line: { ingredientId: item.id, quantity: defaultQuantity(item.unit) } })
          }
          onCreate={onCreatePrep}
        />
        {lines.length === 0 ? (
          <EmptyState
            icon={Soup}
            title="Sin ingredientes"
            description="Escribe para buscar, Enter para agregar. Si no existe, crea una preparación desde la búsqueda."
          />
        ) : (
          <ul className="space-y-2" aria-label="Ingredientes de la fórmula">
            {lines.map((line) => {
              const item = itemsById.get(line.ingredientId)
              const lineCost = costByLine.get(line.ingredientId)
              return (
                <FormulaLineRow
                  key={line.ingredientId}
                  ref={(input) => {
                    if (input) quantityRefs.current.set(line.ingredientId, input)
                    else quantityRefs.current.delete(line.ingredientId)
                  }}
                  line={line}
                  item={item}
                  sku={skuById.get(line.ingredientId)}
                  cost={lineCost?.cost ?? 0}
                  share={lineCost?.share ?? 0}
                  itemsById={itemsById}
                  prepFormulas={prepFormulas}
                  onQuantityChange={(quantity) => dispatch({ type: "updateLine", ingredientId: line.ingredientId, quantity })}
                  onQuantityCommit={() => comboboxRef.current?.focus()}
                  onRemove={() => dispatch({ type: "removeLine", ingredientId: line.ingredientId })}
                  onEditPrep={item?.kind === "prep" ? () => onEditPrep(item) : undefined}
                />
              )
            })}
          </ul>
        )}
        <p className="hidden text-xs text-muted-foreground md:block">
          <kbd className="rounded border px-1">/</kbd> buscar · <kbd className="rounded border px-1">Enter</kbd> agregar ·{" "}
          <kbd className="rounded border px-1">↑</kbd>/<kbd className="rounded border px-1">↓</kbd> ajustar cantidad ·{" "}
          <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">S</kbd> guardar
          {trail.length > 1 && (
            <>
              {" "}
              · <kbd className="rounded border px-1">Esc</kbd> volver
            </>
          )}
        </p>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={onSave}
        onDiscard={() => dispatch({ type: "discard" })}
        message={trail.length > 1 ? `Guarda «${target.name}» para volver a «${trail[trail.length - 2]}»` : undefined}
      />
    </div>
  )
}
