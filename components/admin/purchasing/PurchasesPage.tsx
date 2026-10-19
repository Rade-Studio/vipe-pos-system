"use client"

import { useMemo, useState } from "react"
import { ClipboardList, Plus } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { formatMoney } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import {
  useCreatePurchaseOrder,
  useInventoryItems,
  useInventoryLocations,
  usePurchaseOrders,
  useSuppliers,
} from "@/hooks/inventory"
import type { PurchaseDraft } from "@/lib/inventory/purchase-draft"
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/supabase/inventory/types"
import { PurchaseOrderSheet } from "./PurchaseOrderSheet"
import { PurchaseSuggestions } from "./PurchaseSuggestions"
import { PO_STATUSES, PO_STATUS_LABEL, PaymentBadge, PurchaseStatusBadge, canReceive, poNumber } from "./purchase-ui"
import { ReceiveDialog } from "./ReceiveDialog"
import { SuppliersView } from "./SuppliersView"

type View = "orders" | "suppliers"

interface EditorState {
  orderId: string | null
  initialDraft?: PurchaseDraft
}

export function PurchasesPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const [view, setView] = useState<View>("orders")
  const [status, setStatus] = useState<PurchaseOrderStatus | "">("")
  const [supplierId, setSupplierId] = useState("")
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  const filters = useMemo(
    () => ({ ...(status ? { status: [status] } : {}), ...(supplierId ? { supplierId } : {}) }),
    [status, supplierId],
  )
  const orders = usePurchaseOrders(filters)
  const items = useInventoryItems()
  const suppliers = useSuppliers()
  const locations = useInventoryLocations()
  const create = useCreatePurchaseOrder()
  const { toast } = useToast()

  const defaultLocationId =
    (locations.data ?? []).find((l) => l.isDefault && l.isActive)?.id ?? (locations.data ?? [])[0]?.id ?? ""

  async function createFromSuggestion(input: Parameters<typeof create.mutateAsync>[0]) {
    try {
      const order = await create.mutateAsync(input)
      toast({ title: "Borrador creado", description: order ? poNumber(order.number) : undefined })
      if (order) setEditor({ orderId: order.id })
    } catch (e) {
      toast({ title: "No se pudo crear el borrador", description: (e as Error).message, variant: "destructive" })
    }
  }

  const columns: DataTableColumn<PurchaseOrder>[] = [
    { id: "number", header: "N.º", cell: (o) => <span className="font-mono text-xs">{poNumber(o.number)}</span> },
    { id: "supplier", header: "Proveedor", cell: (o) => <span className="font-medium">{o.supplierName ?? "—"}</span> },
    { id: "location", header: "Bodega", cell: (o) => o.locationName ?? "—" },
    { id: "status", header: "Estado", cell: (o) => <PurchaseStatusBadge status={o.status} /> },
    {
      id: "expected",
      header: "Fecha esperada",
      className: "tabular-nums",
      cell: (o) => o.expectedOn ?? <span className="text-muted-foreground">—</span>,
    },
    { id: "total", header: "Total", className: "text-right tabular-nums", cell: (o) => formatMoney(o.total) },
    { id: "payment", header: "Pago", cell: (o) => <PaymentBadge status={o.paymentStatus} /> },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (o) =>
        canReceive(o.status) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              setReceiving(o)
            }}
          >
            Recibir
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description={description}
        actions={
          view === "orders" ? (
            <Button onClick={() => setEditor({ orderId: null })}>
              <Plus className="mr-2 h-4 w-4" /> Nueva orden
            </Button>
          ) : undefined
        }
      />

      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="space-y-4">
        <TabsList className={segmentedListClass}>
          <TabsTrigger value="orders" className={segmentedTriggerClass}>
            Órdenes de compra
          </TabsTrigger>
          <TabsTrigger value="suppliers" className={segmentedTriggerClass}>
            Proveedores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <PurchaseSuggestions
            items={items.data ?? []}
            suppliers={suppliers.data ?? []}
            locationId={defaultLocationId}
            onCreate={createFromSuggestion}
            onOpenDraft={(draft) => setEditor({ orderId: null, initialDraft: draft })}
          />
          <DataTable
            rows={orders.data ?? []}
            columns={columns}
            getRowId={(o) => o.id}
            isLoading={orders.isLoading}
            onRowClick={(o) => setEditor({ orderId: o.id })}
            searchText={(o) => `${poNumber(o.number)} ${o.supplierName ?? ""} ${o.notes ?? ""}`}
            searchPlaceholder="Buscar orden…"
            filters={
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <NativeSelect
                  aria-label="Estado"
                  className="sm:w-44"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | "")}
                >
                  <option value="">Todos los estados</option>
                  {PO_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PO_STATUS_LABEL[s]}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Proveedor"
                  className="sm:w-48"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Todos los proveedores</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            }
            empty={
              <EmptyState
                icon={ClipboardList}
                title="Sin órdenes de compra"
                description="Crea una orden o parte de la sugerencia de compra."
              />
            }
          />
        </TabsContent>

        <TabsContent value="suppliers">
          <SuppliersView />
        </TabsContent>
      </Tabs>

      <PurchaseOrderSheet
        orderId={editor?.orderId ?? null}
        initialDraft={editor?.initialDraft}
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        onReceive={(order) => {
          setEditor(null)
          setReceiving(order)
        }}
      />
      <ReceiveDialog order={receiving} onOpenChange={(open) => !open && setReceiving(null)} />
    </div>
  )
}
