"use client"

import { useMemo, useState } from "react"
import { ArrowLeftRight, Pencil, SlidersHorizontal, Trash2 } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { StatCard } from "@/components/admin/common/StatCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useInventoryItem, useInventoryMovements, useItemLots } from "@/hooks/inventory"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem, Lot, Movement } from "@/lib/supabase/inventory/types"
import { formatCurrency } from "@/utils/helpers"
import { ExpiryBadge, itemStockStatus, KIND_LABEL, MOVEMENT_LABEL, signedClass, StockStatusBadge } from "./stock-ui"
import { StockActionDialog, type StockAction } from "./StockActionDialog"
import { MovementPager } from "./MovementsPage"

const COVERAGE_DAYS = 30
const PAGE_SIZE = 20

const isoDaysAgo = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

interface ItemDetailSheetProps {
  item: InventoryItem | null
  onOpenChange: (open: boolean) => void
  onEdit: (item: InventoryItem) => void
}

export function ItemDetailSheet({ item, onOpenChange, onEdit }: ItemDetailSheetProps) {
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {item && <ItemDetailBody key={item.id} initial={item} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  )
}

/** Mounted only for a selected item, so its queries never run unscoped. */
function ItemDetailBody({ initial, onEdit }: { initial: InventoryItem; onEdit: (item: InventoryItem) => void }) {
  const fresh = useInventoryItem(initial.id)
  const item = fresh.data ?? initial
  const lots = useItemLots(initial.id)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState<StockAction | null>(null)
  const movements = useInventoryMovements({ itemId: initial.id, page, pageSize: PAGE_SIZE })
  const consumption = useInventoryMovements({
    itemId: initial.id,
    types: ["sale", "production_consume"],
    from: isoDaysAgo(COVERAGE_DAYS),
    pageSize: 1000,
  })

  const coverage = useMemo(() => {
    if (!consumption.data) return null
    const used = consumption.data.rows.reduce((sum, m) => sum - m.quantity, 0)
    if (used <= 0) return null
    return Math.floor(Math.max(item.stock, 0) / (used / COVERAGE_DAYS))
  }, [item, consumption.data])

  const lotColumns: DataTableColumn<Lot>[] = [
    { id: "location", header: "Bodega", cell: (l) => l.locationName ?? "—" },
    { id: "lot", header: "Lote", cell: (l) => <span className="font-mono text-xs">{l.lotCode ?? "General"}</span> },
    { id: "expires", header: "Vence", cell: (l) => <ExpiryBadge expiresOn={l.expiresOn} /> },
    { id: "qty", header: "Cantidad", className: "text-right tabular-nums", cell: (l) => formatQuantity(l.quantity, item.unit) },
    { id: "cost", header: "Costo", className: "text-right tabular-nums", cell: (l) => formatCurrency(l.unitCost) },
  ]

  const movementColumns: DataTableColumn<Movement>[] = [
    { id: "date", header: "Fecha", cell: (m) => new Date(m.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) },
    { id: "type", header: "Tipo", cell: (m) => MOVEMENT_LABEL[m.movementType] },
    { id: "location", header: "Bodega", cell: (m) => m.locationName ?? "—" },
    {
      id: "qty",
      header: "Cantidad",
      className: "text-right tabular-nums",
      cell: (m) => (
        <span className={signedClass(m.quantity)}>
          {m.quantity > 0 ? "+" : ""}
          {formatQuantity(m.quantity, item.unit)}
        </span>
      ),
    },
    { id: "reason", header: "Motivo", cell: (m) => m.reason ?? "—" },
  ]

  return (
    <div className="space-y-5">
      <SheetHeader className="space-y-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{item.sku}</span>
          <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
          <StockStatusBadge status={itemStockStatus(item)} />
          {!item.isActive && <Badge variant="secondary">Inactivo</Badge>}
        </div>
        <SheetTitle>{item.name}</SheetTitle>
        <SheetDescription>{item.categoryName ?? "Sin categoría"}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setAction("adjust")}>
          <SlidersHorizontal className="mr-2 h-4 w-4" /> Ajustar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAction("waste")}>
          <Trash2 className="mr-2 h-4 w-4" /> Registrar merma
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAction("transfer")}>
          <ArrowLeftRight className="mr-2 h-4 w-4" /> Trasladar
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
          <Pencil className="mr-2 h-4 w-4" /> Editar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Stock total" value={formatQuantity(item.stock, item.unit)} />
        <StatCard title="Valor" value={formatCurrency(item.stock * item.cost)} />
        <StatCard title="Costo promedio" value={formatCurrency(item.cost)} hint={`por ${item.unit}`} />
        <StatCard title="Cobertura" value={coverage === null ? "—" : `${coverage} d`} hint={`consumo de ${COVERAGE_DAYS} días`} />
      </div>

      <Tabs defaultValue="lots">
        <TabsList>
          <TabsTrigger value="lots">Lotes</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
        </TabsList>
        <TabsContent value="lots" className="pt-2">
          <DataTable
            rows={lots.data ?? []}
            columns={lotColumns}
            getRowId={(l) => l.id}
            isLoading={lots.isLoading}
            empty={<EmptyState title="Sin existencias" description="Registra stock con un ajuste o una compra." />}
          />
        </TabsContent>
        <TabsContent value="movements" className="space-y-3 pt-2">
          <DataTable
            rows={movements.data?.rows ?? []}
            columns={movementColumns}
            getRowId={(m) => m.id}
            isLoading={movements.isLoading}
            pageSize={PAGE_SIZE}
            empty={<EmptyState title="Sin movimientos" />}
          />
          <MovementPager page={page} pageSize={PAGE_SIZE} total={movements.data?.total ?? 0} onPage={setPage} />
        </TabsContent>
      </Tabs>

      <StockActionDialog action={action} item={item} lots={lots.data ?? []} onClose={() => setAction(null)} />
    </div>
  )
}
