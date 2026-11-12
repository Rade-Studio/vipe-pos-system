"use client"

import { useMemo, useState, type FormEvent } from "react"
import { formatMoney, QuantityInput } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useInventoryLocations, useProducePreparation, useStockAtLocation } from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import type { FormulaItem } from "@/lib/inventory/formula"
import type { InventoryShortage } from "@/lib/inventory/errors"
import { expiryFor, localIsoDate, shortDayLabel, withStock } from "@/lib/inventory/production-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import type { Formula, InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { productionPlan } from "./production-plan"

interface ProduceFormProps {
  prep: InventoryItem
  formula: Formula
  itemsById: Map<string, FormulaItem>
  onDone: () => void
}

/**
 * Quick production of one preparation, inline under its row: quantity with
 * ×1/×2/×3 of the yield, bodega, automatic lot, cost and the ingredient check
 * against the stock of the chosen bodega.
 */
export function ProduceForm({ prep, formula, itemsById, onDone }: ProduceFormProps) {
  const { toast } = useToast()
  const locationsQuery = useInventoryLocations()
  const produce = useProducePreparation()
  const locations = (locationsQuery.data ?? []).filter((location) => location.isActive)
  const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0]

  const [quantity, setQuantity] = useState<number>(formula.yieldQuantity)
  const [locationId, setLocationId] = useState<string>("")
  const [lotCode, setLotCode] = useState("")
  const [serverError, setServerError] = useState<{ message: string; shortages?: InventoryShortage[] } | null>(null)

  const effectiveLocationId = locationId || defaultLocation?.id || ""
  const ingredientIds = useMemo(() => formula.lines.map((line) => line.ingredientId), [formula])
  const locationStock = useStockAtLocation(ingredientIds, effectiveLocationId)
  const scoped = useMemo(() => (locationStock ? withStock(itemsById, locationStock) : itemsById), [itemsById, locationStock])
  const plan = useMemo(() => productionPlan(formula, quantity, scoped), [formula, quantity, scoped])
  const expiresOn = expiryFor(localIsoDate(new Date()), prep.shelfLifeDays)
  const fieldId = `produce-${prep.id}`

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setServerError(null)
    try {
      const result = await produce.mutateAsync({
        itemId: prep.id,
        quantity,
        locationId: effectiveLocationId || null,
        ...(lotCode.trim() ? { lotCode: lotCode.trim() } : {}),
      })
      toast({
        title: "Lote producido",
        description: `Lote ${result.lotCode} · ${formatQuantity(quantity, prep.unit)}${result.expiresOn ? ` · vence ${shortDayLabel(result.expiresOn)}` : ""}`,
      })
      onDone()
    } catch (error) {
      const e = error as { message?: string; shortages?: InventoryShortage[] }
      setServerError({ message: e.message ?? "No se pudo producir.", shortages: e.shortages })
    }
  }

  return (
    <form aria-label={`Producir ${prep.name}`} noValidate onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor={`${fieldId}-qty`}>Cantidad</Label>
          <QuantityInput
            id={`${fieldId}-qty`}
            label="Cantidad a producir"
            unit={prep.unit}
            value={quantity}
            onChange={setQuantity}
            showSteppers={false}
            inputClassName="h-11"
          />
        </div>
        <div className="flex gap-1.5" role="group" aria-label={`Lotes de la fórmula (${formatQuantity(formula.yieldQuantity, prep.unit)} cada uno)`}>
          {[1, 2, 3].map((m) => (
            <Button
              key={m}
              type="button"
              variant={quantity === formula.yieldQuantity * m ? "secondary" : "outline"}
              aria-pressed={quantity === formula.yieldQuantity * m}
              className="min-h-11 min-w-11"
              onClick={() => setQuantity(formula.yieldQuantity * m)}
            >
              ×{m}
            </Button>
          ))}
        </div>
        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor={`${fieldId}-location`}>Bodega</Label>
          <NativeSelect
            id={`${fieldId}-location`}
            className="h-11"
            value={effectiveLocationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full space-y-1.5 sm:w-44">
          <Label htmlFor={`${fieldId}-lot`}>Código de lote (opcional)</Label>
          <Input id={`${fieldId}-lot`} className="h-11" value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Automático" />
        </div>
        <div className="grid gap-0.5 text-sm text-muted-foreground">
          <span>
            {lotCode.trim() ? "Lote " : "Lote automático"}
            {lotCode.trim() && <b className="font-mono text-foreground">{lotCode.trim()}</b>}
            {expiresOn && (
              <>
                {" "}· vence <b className="text-foreground">{shortDayLabel(expiresOn)}</b>
              </>
            )}
          </span>
          <span>
            Costo estimado <b className="tabular-nums text-foreground">{formatMoney(plan.totalCost)}</b>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm" aria-label="Requerimiento de insumos">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Insumo</th>
              <th className="px-3 py-1.5 text-right font-medium">Necesario</th>
              <th className="px-3 py-1.5 text-right font-medium">Disponible</th>
              <th className="px-3 py-1.5 text-right font-medium">Falta</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr
                key={row.itemId}
                data-missing={row.missing > 0 || undefined}
                className={cn("border-t", row.missing > 0 && "bg-destructive/5 text-destructive")}
              >
                <td className="px-3 py-1.5">{row.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatQuantity(row.needed, row.unit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatQuantity(row.available, row.unit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.missing > 0 ? formatQuantity(row.missing, row.unit) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-11" disabled={plan.hasMissing || !(quantity > 0) || produce.isPending}>
          {produce.isPending ? "Produciendo…" : `Producir ${quantity > 0 ? formatQuantity(quantity, prep.unit) : ""}`.trim()}
        </Button>
      </div>
    </form>
  )
}
