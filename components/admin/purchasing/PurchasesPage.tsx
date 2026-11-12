"use client"

import { useState } from "react"
import { ClipboardList, Plus } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { formatMoney } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { SearchField } from "@/components/admin/production/production-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import {
  useCreatePurchaseOrder,
  useInventoryItems,
  useInventoryLocations,
  usePurchaseOrders,
  useSetPurchaseOrderStatus,
  useSuppliers,
} from "@/hooks/inventory"
import type { PurchaseDraft } from "@/lib/inventory/purchase-draft"
import type { PurchaseOrder } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { PurchaseOrderSheet } from "./PurchaseOrderSheet"
import { PurchaseSuggestions } from "./PurchaseSuggestions"
import {
  ORDER_FILTERS,
  PaymentBadge,
  PurchaseStatusBadge,
  canReceive,
  lateDays,
  poNumber,
  sortOrders,
  type OrderFilter,
} from "./purchase-ui"
import { ReceiveDialog } from "./ReceiveDialog"
import { SuppliersView } from "./SuppliersView"

type View = "orders" | "suppliers"

interface EditorState {
  orderId: string | null
  initialDraft?: PurchaseDraft
}

export function PurchasesPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const [view, setView] = useState<View>("orders")
  const [filter, setFilter] = useState<OrderFilter>("open")
  const [query, setQuery] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  // Estado and proveedor filter client side: the chips need every order's count.
  const orders = usePurchaseOrders()
  const items = useInventoryItems()
  const suppliers = useSuppliers()
  const locations = useInventoryLocations()
  const create = useCreatePurchaseOrder()
  const setStatus = useSetPurchaseOrderStatus()
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

  async function send(order: PurchaseOrder) {
    try {
      await setStatus.mutateAsync({ id: order.id, status: "ordered" })
      toast({ title: `${poNumber(order.number)} enviada`, description: order.supplierName ?? undefined })
    } catch (e) {
      toast({ title: "No se pudo enviar la orden", description: (e as Error).message, variant: "destructive" })
    }
  }

  const all = orders.data ?? []
  const text = query.trim().toLowerCase()
  const match = ORDER_FILTERS.find((f) => f.value === filter)!.match
  const rows = sortOrders(
    all.filter(
      (o) =>
        match(o.status) &&
        (!supplierId || o.supplierId === supplierId) &&
        (!text || `${poNumber(o.number)} ${o.supplierName ?? ""} ${o.notes ?? ""}`.toLowerCase().includes(text)),
    ),
  )
  const cell = "block md:table-cell md:px-3 md:py-1.5"

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description={description}
        actions={
          view === "orders" ? (
            <Button className="min-h-11" onClick={() => setEditor({ orderId: null })}>
              <Plus className="mr-2 h-4 w-4" /> Nueva orden
            </Button>
          ) : undefined
        }
      />

      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="space-y-4">
        <TabsList className={segmentedListClass}>
          <TabsTrigger value="orders" className={segmentedTriggerClass}>
            Órdenes de compra <span className="ml-1 tabular-nums text-muted-foreground">({all.length})</span>
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
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label="Buscar orden por número o proveedor" placeholder="Buscar orden…" value={query} onChange={setQuery} />
            <div className="flex w-full gap-1.5 overflow-x-auto sm:w-auto sm:flex-wrap" role="group" aria-label="Filtrar por estado">
              {ORDER_FILTERS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={filter === chip.value}
                  onClick={() => setFilter(chip.value)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    filter === chip.value && "border-primary/50 bg-primary/10 text-foreground",
                  )}
                >
                  {chip.label} <span className="tabular-nums">{all.filter((o) => chip.match(o.status)).length}</span>
                </button>
              ))}
            </div>
            <NativeSelect
              aria-label="Proveedor"
              className="h-11 w-full sm:ml-auto sm:w-56"
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
          {orders.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : all.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Sin órdenes de compra" description="Crea una orden o parte de la sugerencia de compra." />
          ) : (
            <div className="rounded-2xl border bg-card">
              <table className="block w-full text-sm md:table">
                <caption className="sr-only">Órdenes de compra: pendientes de recibir primero</caption>
                <thead className="hidden md:table-header-group">
                  <tr className="text-xs text-muted-foreground">
                    {["N.º", "Proveedor", "Bodega", "Estado", "Esperada", "Total", "Pago"].map((label) => (
                      <th key={label} scope="col" className={cn("h-10 border-b px-3 text-left font-medium", label === "Total" && "text-right")}>
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="h-10 w-px border-b px-3">
                      <span className="sr-only">Acción</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {rows.length === 0 ? (
                    <tr className="block md:table-row">
                      <td colSpan={8} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                        No hay órdenes con estos filtros.
                      </td>
                    </tr>
                  ) : (
                    rows.map((o) => {
                      const late = lateDays(o)
                      return (
                        <tr
                          key={o.id}
                          onClick={() => setEditor({ orderId: o.id })}
                          className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40 md:table-row md:p-0"
                        >
                          <td className={cn(cell, "font-mono text-xs")}>{poNumber(o.number)}</td>
                          <td className={cn(cell, "col-start-1 min-w-0 truncate font-medium")}>{o.supplierName ?? "—"}</td>
                          <td className={cn(cell, "col-start-1 text-muted-foreground md:text-foreground")}>{o.locationName ?? "—"}</td>
                          <td className={cn(cell, "col-start-2 row-start-1")}>
                            <PurchaseStatusBadge status={o.status} />
                          </td>
                          <td className={cn(cell, "col-start-1 tabular-nums")}>
                            <span className="text-muted-foreground md:hidden">Esperada </span>
                            {o.expectedOn ?? <span className="text-muted-foreground">—</span>}
                            {late > 0 && (
                              <span className="ml-2 text-xs font-medium text-destructive">
                                Atrasada {late} {late === 1 ? "día" : "días"}
                              </span>
                            )}
                          </td>
                          <td className={cn(cell, "col-start-2 row-start-2 text-right tabular-nums")}>{formatMoney(o.total)}</td>
                          <td className={cn(cell, "col-start-2 row-start-3 justify-self-end")}>
                            <PaymentBadge status={o.paymentStatus} />
                          </td>
                          <td className={cn(cell, "col-span-2 mt-1 md:mt-0 md:w-px md:whitespace-nowrap md:text-right")}>
                            {canReceive(o.status) ? (
                              <Button
                                size="sm"
                                className="min-h-9 w-full md:w-auto"
                                aria-haspopup="dialog"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setReceiving(o)
                                }}
                              >
                                Recibir
                              </Button>
                            ) : o.status === "draft" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-9 w-full md:w-auto"
                                disabled={setStatus.isPending}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void send(o)
                                }}
                              >
                                Enviar
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="min-h-9 w-full md:w-auto" aria-label={`Ver ${poNumber(o.number)}`}>
                                Ver
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {rows.length} de {all.length} órdenes
          </p>
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
