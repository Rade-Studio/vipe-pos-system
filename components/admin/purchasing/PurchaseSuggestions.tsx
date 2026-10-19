"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Panel } from "@/components/admin/common/Panel"
import { formatMoney } from "@/components/admin/inventory-shared"
import { Button } from "@/components/ui/button"
import { formatQuantity } from "@/lib/inventory/units"
import { emptyDraft, purchaseDraftReducer, toCreateInput, type PurchaseDraft } from "@/lib/inventory/purchase-draft"
import { groupBySupplier, reorderQuantity } from "@/lib/inventory/stock"
import type { InventoryItem, Supplier } from "@/lib/supabase/inventory/types"

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
    .filter((i) => i.isActive)
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

  if (groups.length === 0) return null

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden /> Sugerencia de compra
        </span>
      }
      description="Artículos en o bajo el mínimo, hasta el máximo (o el doble del mínimo)."
      contentClassName="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {groups.map((group) => {
        const key = group.supplierId ?? "none"
        return (
          <section key={key} aria-label={`Sugerencia ${group.supplierName}`} className="flex flex-col rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-medium">{group.supplierName}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(group.total)}</span>
            </div>
            <ul className="mb-3 flex-1 space-y-1 text-sm">
              {group.lines.map(({ item, quantity }) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.purchaseUnit && item.purchaseFactor > 0
                      ? `${formatQuantity(quantity / item.purchaseFactor, item.purchaseUnit)} (${formatQuantity(quantity, item.unit)})`
                      : formatQuantity(quantity, item.unit)}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="outline"
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
          </section>
        )
      })}
    </Panel>
  )
}
