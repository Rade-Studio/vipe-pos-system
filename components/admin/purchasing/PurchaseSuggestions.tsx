"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { Button } from "@/components/ui/button"
import { formatQuantity } from "@/lib/inventory/units"
import { emptyDraft, purchaseDraftReducer, toCreateInput, type PurchaseDraft } from "@/lib/inventory/purchase-draft"
import { groupBySupplier, reorderQuantity } from "@/lib/inventory/stock"
import type { InventoryItem, Supplier } from "@/lib/api/inventory/types"

export interface SuggestionGroup {
  supplierId: string | null
  supplierName: string
  lines: { item: InventoryItem; quantity: number }[]
  total: number
}

const suggestedQuantity = (item: InventoryItem) =>
  reorderQuantity({
    stock: item.stock,
    min_stock: item.minStock,
    max_stock: item.maxStock,
    purchase_factor: item.purchaseUnit ? item.purchaseFactor : null,
  })

/** Active items to reorder, grouped by default supplier; unknown or inactive suppliers fall into "Sin proveedor". */
export function buildSuggestions(items: readonly InventoryItem[], suppliers: readonly Supplier[]): SuggestionGroup[] {
  const known = new Map(suppliers.filter((s) => s.isActive).map((s) => [s.id, s]))
  const due = items
    // Preparations are produced in the kitchen, never purchased.
    .filter((i) => i.isActive && i.kind === "raw")
    .map((item) => ({ item, quantity: suggestedQuantity(item), default_supplier_id: item.defaultSupplierId && known.has(item.defaultSupplierId) ? item.defaultSupplierId : null }))
    .filter((row) => row.quantity > 0)
  const groups = [...groupBySupplier(due)].map(([supplierId, rows]) => ({
    supplierId,
    supplierName: supplierId ? known.get(supplierId)!.name : "Sin proveedor",
    lines: rows.map(({ item, quantity }) => ({ item, quantity })),
    total: rows.reduce((sum, { item, quantity }) => sum + item.cost * quantity, 0),
  }))
  return groups.sort((a, b) => (a.supplierId === null ? 1 : b.supplierId === null ? -1 : a.supplierName.localeCompare(b.supplierName)))
}

export function suggestionDraft(group: SuggestionGroup, locationId: string): PurchaseDraft {
  return group.lines.reduce(
    (draft, { item, quantity }) => purchaseDraftReducer(draft, { type: "addItem", item, quantity, unitCost: item.cost }),
    { ...emptyDraft(locationId), supplierId: group.supplierId ?? "" },
  )
}

export function PurchaseSuggestions({
  items,
  suppliers,
  locationId,
  onCreate,
  onOpenDraft,
}: {
  items: readonly InventoryItem[]
  suppliers: readonly Supplier[]
  locationId: string
  /** Creates the order from a complete draft input. */
  onCreate: (input: ReturnType<typeof toCreateInput>) => Promise<void>
  /** Opens the editor prefilled (group without supplier). */
  onOpenDraft: (draft: PurchaseDraft) => void
}) {
  const groups = useMemo(() => buildSuggestions(items, suppliers), [items, suppliers])
  const [pending, setPending] = useState<string | null>(null)
  const [shown, setShown] = useState(true)

  if (groups.length === 0) return null

  const lineCount = groups.reduce((sum, g) => sum + g.lines.length, 0)
  const total = groups.reduce((sum, g) => sum + g.total, 0)

  return (
    <section aria-labelledby="sg-h" className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <h2 id="sg-h" className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden /> Sugerencia de compra
        </h2>
        <p className="flex-1 text-sm text-muted-foreground" aria-live="polite">
          <b className="font-semibold text-foreground">{lineCount} artículos</b> en o bajo el mínimo · {groups.length} proveedores ·{" "}
          <b className="font-semibold tabular-nums text-foreground">{formatMoney(total)}</b> estimado
        </p>
        <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={shown} aria-controls="sg-body" onClick={() => setShown(!shown)}>
          {shown ? "Ocultar" : "Mostrar"}
        </Button>
      </div>
      {shown && (
        <div id="sg-body" className="border-t">
          <table className="block w-full text-sm md:table">
            <caption className="sr-only">
              Artículos en o bajo el mínimo agrupados por proveedor; la cantidad sugerida llena hasta el máximo (o el doble del mínimo).
            </caption>
            <thead className="hidden md:table-header-group">
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="h-10 border-b px-3 text-left font-medium">Proveedor</th>
                <th scope="col" className="h-10 border-b px-3 text-left font-medium">Artículos sugeridos</th>
                <th scope="col" className="h-10 border-b px-3 text-right font-medium">Total estimado</th>
                <th scope="col" className="h-10 w-px border-b px-3">
                  <span className="sr-only">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {groups.map((group) => {
                const key = group.supplierId ?? "none"
                return (
                  <tr key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0 md:table-row md:p-0">
                    <td className="block min-w-0 truncate font-medium md:table-cell md:px-3 md:py-1.5">{group.supplierName}</td>
                    <td className="col-span-2 row-start-2 block text-muted-foreground md:table-cell md:px-3 md:py-1.5">
                      {group.lines.map(({ item, quantity }, i) => (
                        <span key={item.id} className="mr-3 inline-block">
                          <span className="text-foreground">{item.name}</span>{" "}
                          <span className="tabular-nums">
                            {item.purchaseUnit && item.purchaseFactor > 0
                              ? `${formatQuantity(quantity / item.purchaseFactor, item.purchaseUnit)} (${formatQuantity(quantity, item.unit)})`
                              : formatQuantity(quantity, item.unit)}
                          </span>
                          {i < group.lines.length - 1 && <span aria-hidden>,</span>}
                        </span>
                      ))}
                    </td>
                    <td className="col-start-2 row-start-1 block text-right tabular-nums md:table-cell md:px-3 md:py-1.5">{formatMoney(group.total)}</td>
                    <td className="col-span-2 mt-1 block md:mt-0 md:table-cell md:w-px md:whitespace-nowrap md:px-3 md:py-1.5 md:text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9 w-full md:w-auto"
                        disabled={pending !== null || !locationId}
                        onClick={async () => {
                          const draft = suggestionDraft(group, locationId)
                          if (!group.supplierId) return onOpenDraft(draft)
                          setPending(key)
                          try {
                            await onCreate(toCreateInput(draft))
                          } finally {
                            setPending(null)
                          }
                        }}
                      >
                        {pending === key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {group.supplierId ? "Crear borrador" : "Elegir proveedor"}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Hasta el máximo de cada artículo, o el doble del mínimo si no tiene máximo. El borrador se puede editar antes de enviarlo.
          </p>
        </div>
      )}
    </section>
  )
}
