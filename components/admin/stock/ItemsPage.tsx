"use client"

import { useMemo, useState } from "react"
import { Package, Plus } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useInventoryCategories, useInventoryItemsBy, useSuppliers } from "@/hooks/inventory"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem, ItemKind } from "@/lib/supabase/inventory/types"
import { formatCurrency } from "@/utils/helpers"
import { ItemDetailSheet } from "./ItemDetailSheet"
import { ItemFormSheet } from "./ItemFormSheet"
import { itemStockStatus, KIND_LABEL, NativeSelect, STOCK_STATUS_LABEL, StockStatusBadge, type StockStatus } from "./stock-ui"

export interface ItemFilters {
  kind: ItemKind | ""
  categoryId: string
  status: StockStatus | ""
  active: "active" | "inactive" | "all"
}

export function filterItems(items: InventoryItem[], filters: ItemFilters): InventoryItem[] {
  return items.filter(
    (item) =>
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.categoryId || item.categoryId === filters.categoryId) &&
      (!filters.status || itemStockStatus(item) === filters.status) &&
      (filters.active === "all" || item.isActive === (filters.active === "active")),
  )
}

export function ItemsPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const items = useInventoryItemsBy({ includeInactive: true })
  const categories = useInventoryCategories()
  const suppliers = useSuppliers()
  const [filters, setFilters] = useState<ItemFilters>({ kind: "", categoryId: "", status: "", active: "active" })
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [editing, setEditing] = useState<{ item: InventoryItem | null } | null>(null)

  const supplierName = useMemo(() => new Map((suppliers.data ?? []).map((s) => [s.id, s.name])), [suppliers.data])
  const rows = useMemo(() => filterItems(items.data ?? [], filters), [items.data, filters])
  const set = (patch: Partial<ItemFilters>) => setFilters((f) => ({ ...f, ...patch }))

  const columns: DataTableColumn<InventoryItem>[] = [
    { id: "sku", header: "SKU", cell: (i) => <span className="font-mono text-xs">{i.sku}</span> },
    {
      id: "name",
      header: "Nombre",
      cell: (i) => (
        <div className="flex flex-wrap items-center justify-end gap-2 md:justify-start">
          <span className="font-medium">{i.name}</span>
          <Badge variant="outline" className="font-normal">
            {KIND_LABEL[i.kind]}
          </Badge>
          {!i.isActive && <Badge variant="secondary">Inactivo</Badge>}
        </div>
      ),
    },
    { id: "category", header: "Categoría", cell: (i) => i.categoryName ?? "—" },
    {
      id: "stock",
      header: "Stock",
      cell: (i) => (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <span className="tabular-nums">{formatQuantity(i.stock, i.unit)}</span>
          <StockStatusBadge status={itemStockStatus(i)} />
        </div>
      ),
    },
    {
      id: "minmax",
      header: "Mín/Máx",
      className: "tabular-nums",
      cell: (i) => `${formatQuantity(i.minStock, i.unit)} / ${i.maxStock === null ? "—" : formatQuantity(i.maxStock, i.unit)}`,
    },
    { id: "cost", header: "Costo unitario", className: "text-right tabular-nums", cell: (i) => formatCurrency(i.cost) },
    { id: "value", header: "Valor", className: "text-right tabular-nums", cell: (i) => formatCurrency(Math.max(i.stock, 0) * i.cost) },
    { id: "supplier", header: "Proveedor", cell: (i) => (i.defaultSupplierId ? supplierName.get(i.defaultSupplierId) ?? "—" : "—") },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Artículos"
        description={description}
        actions={
          <Button onClick={() => setEditing({ item: null })}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo artículo
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(i) => i.id}
        isLoading={items.isLoading}
        searchText={(i) => `${i.name} ${i.sku} ${i.barcode ?? ""}`}
        searchPlaceholder="Buscar por nombre, SKU o código"
        onRowClick={setSelected}
        filters={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <NativeSelect aria-label="Tipo" className="sm:w-40" value={filters.kind} onChange={(e) => set({ kind: e.target.value as ItemFilters["kind"] })}>
              <option value="">Todos los tipos</option>
              <option value="raw">{KIND_LABEL.raw}</option>
              <option value="prep">{KIND_LABEL.prep}</option>
            </NativeSelect>
            <NativeSelect aria-label="Categoría" className="sm:w-44" value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">Todas las categorías</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Estado de stock" className="sm:w-40" value={filters.status} onChange={(e) => set({ status: e.target.value as ItemFilters["status"] })}>
              <option value="">Todo el stock</option>
              {(Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STOCK_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Activos" className="sm:w-36" value={filters.active} onChange={(e) => set({ active: e.target.value as ItemFilters["active"] })}>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </NativeSelect>
          </div>
        }
        empty={
          <EmptyState
            icon={Package}
            title="Sin artículos"
            description="Crea tu primer artículo o ajusta los filtros."
            action={
              <Button variant="outline" onClick={() => setEditing({ item: null })}>
                Nuevo artículo
              </Button>
            }
          />
        }
      />

      <ItemDetailSheet item={selected} onOpenChange={(open) => !open && setSelected(null)} onEdit={(item) => setEditing({ item })} />
      <ItemFormSheet
        open={editing !== null}
        item={editing?.item ?? null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(item) => selected && setSelected(item)}
      />
    </div>
  )
}
