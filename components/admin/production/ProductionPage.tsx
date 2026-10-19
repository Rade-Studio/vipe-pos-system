"use client"

import { useMemo, useState } from "react"
import { CookingPot, FlaskConical } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Panel } from "@/components/admin/common/Panel"
import { formatMoney, QuantityInput } from "@/components/admin/inventory-shared"
import { ExpiryBadge, itemStockStatus, NativeSelect, StockStatusBadge } from "@/components/admin/stock/stock-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  useFormulas,
  useInventoryItems,
  useInventoryLocations,
  useProducePreparation,
  useProductionBatches,
} from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import { formulaCost, maxProducible, type FormulaItem } from "@/lib/inventory/formula"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryShortage } from "@/lib/inventory/errors"
import type { Formula, InventoryItem, ProductionBatch } from "@/lib/supabase/inventory/types"
import { cn } from "@/lib/utils"
import { productionPlan, toFormulaItem } from "./production-plan"

interface ProductionPageProps {
  description: string
  onNavigate?: (sectionId: string) => void
}

const formatDate = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })

export function ProductionPage({ description, onNavigate }: ProductionPageProps) {
  const itemsQuery = useInventoryItems()
  const formulasQuery = useFormulas()
  const batchesQuery = useProductionBatches()
  const [selected, setSelected] = useState<InventoryItem | null>(null)

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, toFormulaItem(item)])), [items])
  const byPrep = formulasQuery.data?.byPrep ?? {}
  const preps = items.filter((item) => item.kind === "prep" && item.isActive)

  const batchColumns: DataTableColumn<ProductionBatch>[] = [
    { id: "date", header: "Fecha", cell: (b) => <span className="tabular-nums">{formatDate(b.createdAt)}</span> },
    { id: "item", header: "Preparación", cell: (b) => b.itemName ?? "—" },
    { id: "qty", header: "Cantidad", cell: (b) => formatQuantity(b.quantity, b.unit ?? "") },
    { id: "lot", header: "Lote", cell: (b) => <span className="font-mono text-xs">{b.lotCode ?? "—"}</span> },
    { id: "expiry", header: "Vence", cell: (b) => <ExpiryBadge expiresOn={b.expiresOn} /> },
    { id: "unitCost", header: "Costo unitario", className: "text-right", cell: (b) => formatMoney(b.unitCost) },
    { id: "total", header: "Total", className: "text-right", cell: (b) => formatMoney(b.totalCost) },
  ]

  const loading = itemsQuery.isLoading || formulasQuery.isLoading

  return (
    <div className="space-y-6">
      <PageHeader title="Producción" description={description} />

      <Panel title="Preparaciones" description="Produce lotes con stock propio a partir de su fórmula.">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : preps.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="Sin preparaciones"
            description="Crea una preparación (salsa, pico de gallo…) desde Fórmulas para producirla por lotes."
            action={
              onNavigate && (
                <Button variant="outline" size="sm" onClick={() => onNavigate("formulas")}>
                  Ir a Fórmulas
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {preps.map((prep) => (
              <PrepCard
                key={prep.id}
                prep={prep}
                formula={byPrep[prep.id]}
                itemsById={itemsById}
                onProduce={() => setSelected(prep)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Lotes recientes">
        <DataTable
          rows={batchesQuery.data ?? []}
          columns={batchColumns}
          getRowId={(b) => b.id}
          isLoading={batchesQuery.isLoading}
          searchText={(b) => `${b.itemName ?? ""} ${b.lotCode ?? ""}`}
          searchPlaceholder="Buscar lote o preparación…"
          empty={<EmptyState icon={CookingPot} title="Aún no hay lotes producidos" />}
        />
      </Panel>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && byPrep[selected.id] && (
            <ProduceForm
              key={selected.id}
              prep={selected}
              formula={byPrep[selected.id]}
              itemsById={itemsById}
              onDone={() => setSelected(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface PrepCardProps {
  prep: InventoryItem
  formula: Formula | undefined
  itemsById: Map<string, FormulaItem>
  onProduce: () => void
  onNavigate?: (sectionId: string) => void
}

function PrepCard({ prep, formula, itemsById, onProduce, onNavigate }: PrepCardProps) {
  const hasFormula = Boolean(formula && formula.lines.length > 0)
  const producible = formula ? maxProducible(formula, itemsById) : 0
  const unitCost = formula ? formulaCost(formula.lines, itemsById, formula.yieldQuantity).perUnit : 0

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4" aria-label={prep.name}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{prep.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{prep.sku}</p>
        </div>
        <StockStatusBadge status={itemStockStatus(prep)} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Stock</dt>
        <dd className="text-right tabular-nums">{formatQuantity(prep.stock, prep.unit)}</dd>
        {hasFormula && (
          <>
            <dt className="text-muted-foreground">Se puede producir</dt>
            <dd className="text-right tabular-nums">{formatQuantity(Math.floor(producible * 1000) / 1000, prep.unit)}</dd>
            <dt className="text-muted-foreground">Costo por {prep.unit}</dt>
            <dd className="text-right tabular-nums">{formatMoney(unitCost)}</dd>
          </>
        )}
      </dl>
      <div className="mt-auto">
        {hasFormula ? (
          <Button size="sm" className="w-full" onClick={onProduce}>
            Producir
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline">Sin fórmula</Badge>
            {onNavigate && (
              <Button size="sm" variant="outline" onClick={() => onNavigate("formulas")}>
                Crear fórmula
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

interface ProduceFormProps {
  prep: InventoryItem
  formula: Formula
  itemsById: Map<string, FormulaItem>
  onDone: () => void
}

function ProduceForm({ prep, formula, itemsById, onDone }: ProduceFormProps) {
  const { toast } = useToast()
  const locationsQuery = useInventoryLocations()
  const produce = useProducePreparation()
  const locations = (locationsQuery.data ?? []).filter((location) => location.isActive)
  const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0]

  const [quantity, setQuantity] = useState<number>(formula.yieldQuantity)
  const [locationId, setLocationId] = useState<string>("")
  const [lotCode, setLotCode] = useState("")
  const [notes, setNotes] = useState("")
  const [serverError, setServerError] = useState<{ message: string; shortages?: InventoryShortage[] } | null>(null)

  const effectiveLocationId = locationId || defaultLocation?.id || ""
  const plan = useMemo(() => productionPlan(formula, quantity, itemsById), [formula, quantity, itemsById])
  const multipliers = [1, 2, 3]

  const submit = async () => {
    setServerError(null)
    try {
      const result = await produce.mutateAsync({
        itemId: prep.id,
        quantity,
        locationId: effectiveLocationId || null,
        ...(lotCode.trim() ? { lotCode: lotCode.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast({
        title: "Lote producido",
        description: `Lote ${result.lotCode}${result.expiresOn ? ` · vence ${result.expiresOn}` : ""}`,
      })
      onDone()
    } catch (error) {
      const e = error as { message?: string; shortages?: InventoryShortage[] }
      setServerError({ message: e.message ?? "No se pudo producir.", shortages: e.shortages })
    }
  }

  return (
    <div className="space-y-5">
      <SheetHeader>
        <SheetTitle>Producir {prep.name}</SheetTitle>
        <SheetDescription>
          Rendimiento de la fórmula: {formatQuantity(formula.yieldQuantity, prep.unit)} por lote.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-2">
        <Label htmlFor="produce-quantity">Cantidad a producir</Label>
        <QuantityInput
          id="produce-quantity"
          label="Cantidad a producir"
          unit={prep.unit}
          value={quantity}
          onChange={setQuantity}
          showPresets
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Lotes">
          {multipliers.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={quantity === formula.yieldQuantity * m ? "secondary" : "outline"}
              onClick={() => setQuantity(formula.yieldQuantity * m)}
            >
              ×{m} {m === 1 ? "lote" : "lotes"}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" aria-label="Requerimiento de insumos">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Insumo</th>
              <th className="px-3 py-2 text-right font-medium">Necesario</th>
              <th className="px-3 py-2 text-right font-medium">Disponible</th>
              <th className="px-3 py-2 text-right font-medium">Falta</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr
                key={row.itemId}
                data-missing={row.missing > 0 || undefined}
                className={cn("border-t", row.missing > 0 && "bg-destructive/5 text-destructive")}
              >
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(row.needed, row.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(row.available, row.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.missing > 0 ? formatQuantity(row.missing, row.unit) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Costo estimado</dt>
        <dd className="text-right font-medium tabular-nums">{formatMoney(plan.totalCost)}</dd>
        <dt className="text-muted-foreground">Costo por {prep.unit}</dt>
        <dd className="text-right tabular-nums">{formatMoney(plan.unitCost)}</dd>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="produce-location">Bodega</Label>
          <NativeSelect id="produce-location" value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="produce-lot">Código de lote (opcional)</Label>
          <Input id="produce-lot" value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Automático" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="produce-notes">Notas (opcional)</Label>
        <Textarea id="produce-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {plan.hasMissing && (
        <p className="text-sm text-destructive">No hay stock suficiente de los insumos marcados para esta cantidad.</p>
      )}
      {serverError && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          <p>{serverError.message}</p>
          {serverError.shortages && (
            <ul className="list-disc pl-5">
              {serverError.shortages.map((s) => (
                <li key={s.itemId}>
                  {s.name ?? s.itemId}: faltan {formatQuantity(s.missing, s.unit ?? "")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SheetFooter>
        <Button onClick={submit} disabled={plan.hasMissing || !(quantity > 0) || produce.isPending}>
          {produce.isPending ? "Produciendo…" : "Producir"}
        </Button>
      </SheetFooter>
    </div>
  )
}
