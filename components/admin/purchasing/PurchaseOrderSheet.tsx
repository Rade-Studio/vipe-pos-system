"use client"

import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Loader2, Send, Trash2, X } from "lucide-react"
import { ItemCombobox, QuantityInput, formatMoney, type ItemComboboxHandle } from "@/components/admin/inventory-shared"
import { FieldError, NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  useAddPurchaseOrderLine,
  useCreatePurchaseOrder,
  useDeletePurchaseOrder,
  useInventoryItems,
  useInventoryLocations,
  usePurchaseOrder,
  useRemovePurchaseOrderLine,
  useSetPurchaseOrderStatus,
  useSuppliers,
  useUpdatePurchaseOrder,
  useUpdatePurchaseOrderLine,
} from "@/hooks/inventory"
import { formatQuantity } from "@/lib/inventory/units"
import {
  diffDraftLines,
  draftFromOrder,
  draftTotal,
  emptyDraft,
  entryUnit,
  hasDraftErrors,
  lineEntryCost,
  lineEntryQuantity,
  lineTotal,
  purchaseDraftReducer,
  toCreateInput,
  usesPurchaseUnit,
  validateDraft,
  type DraftErrors,
  type DraftLine,
  type PurchaseDraft,
} from "@/lib/inventory/purchase-draft"
import type { PurchaseOrder } from "@/lib/supabase/inventory/types"
import { PurchaseStatusBadge, poNumber } from "./purchase-ui"
import { SupplierDialog } from "./SuppliersView"

const NEW_SUPPLIER = "__new__"

function LineRow({
  line,
  error,
  editable,
  onQuantity,
  onCost,
  onRemove,
  quantityRef,
}: {
  line: DraftLine
  error?: string
  editable: boolean
  onQuantity: (value: number) => void
  onCost: (value: number) => void
  onRemove: () => void
  quantityRef: (el: HTMLInputElement | null) => void
}) {
  const unit = entryUnit(line)
  return (
    <li className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_6rem_2rem] sm:items-start">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="truncate font-medium">{line.itemName}</p>
        <p className="truncate text-xs text-muted-foreground">{line.sku}</p>
      </div>
      <div>
        {editable ? (
          <QuantityInput
            ref={quantityRef}
            value={lineEntryQuantity(line)}
            unit={unit}
            onChange={onQuantity}
            label={`Cantidad ${line.itemName}`}
          />
        ) : (
          <p className="tabular-nums">{formatQuantity(lineEntryQuantity(line), unit)}</p>
        )}
        {usesPurchaseUnit(line) && (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {unit} · = {formatQuantity(line.quantity, line.unit)}
          </p>
        )}
      </div>
      <div>
        {editable ? (
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            aria-label={`Costo unitario ${line.itemName}`}
            defaultValue={lineEntryCost(line)}
            key={`${line.key}-${lineEntryCost(line)}`}
            onBlur={(e) => {
              const value = Number(e.target.value)
              if (Number.isFinite(value)) onCost(value)
            }}
          />
        ) : (
          <p className="tabular-nums">{formatMoney(lineEntryCost(line))}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">por {unit}</p>
      </div>
      <p className="self-center text-right font-medium tabular-nums sm:pt-2">{formatMoney(lineTotal(line))}</p>
      {editable && (
        <Button variant="ghost" size="icon" className="h-8 w-8 justify-self-end" aria-label={`Quitar ${line.itemName}`} onClick={onRemove}>
          <X className="h-4 w-4" />
        </Button>
      )}
      {error && (
        <div className="col-span-2 sm:col-span-5">
          <FieldError message={error} />
        </div>
      )}
    </li>
  )
}

/** Create or edit a purchase order; only drafts are editable. */
export function PurchaseOrderSheet({
  orderId,
  open,
  onOpenChange,
  onReceive,
  initialDraft,
}: {
  /** null creates a new order. */
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReceive?: (order: PurchaseOrder) => void
  /** Prefill for a new order (purchase suggestion without supplier). */
  initialDraft?: PurchaseDraft
}) {
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const suppliers = useSuppliers()
  const order = usePurchaseOrder(open ? orderId : null)
  const create = useCreatePurchaseOrder()
  const update = useUpdatePurchaseOrder()
  const addLine = useAddPurchaseOrderLine()
  const updateLine = useUpdatePurchaseOrderLine()
  const removeLine = useRemovePurchaseOrderLine()
  const setStatus = useSetPurchaseOrderStatus()
  const remove = useDeletePurchaseOrder()
  const { toast } = useToast()

  const defaultLocationId = useMemo(
    () => (locations.data ?? []).find((l) => l.isDefault && l.isActive)?.id ?? (locations.data ?? [])[0]?.id ?? "",
    [locations.data],
  )
  const [draft, dispatch] = useReducer(purchaseDraftReducer, emptyDraft(""))
  const [errors, setErrors] = useState<DraftErrors | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [supplierDialog, setSupplierDialog] = useState(false)
  const loadedRef = useRef<string | null>(null)
  const comboRef = useRef<ItemComboboxHandle>(null)
  const quantityRefs = useRef(new Map<string, HTMLInputElement>())
  const [focusItemId, setFocusItemId] = useState<string | null>(null)

  const current = orderId ? order.data : undefined
  const editable = !orderId || current?.status === "draft"

  useEffect(() => {
    if (!open) {
      loadedRef.current = null
      return
    }
    const key = orderId ?? "new"
    if (loadedRef.current === key) return
    if (orderId) {
      if (!order.data || !items.data) return
      dispatch({ type: "reset", draft: draftFromOrder(order.data, items.data) })
    } else {
      dispatch({ type: "reset", draft: initialDraft ?? emptyDraft(defaultLocationId) })
    }
    loadedRef.current = key
    setErrors(null)
    setConfirmDelete(false)
  }, [open, orderId, order.data, items.data, defaultLocationId, initialDraft])

  useEffect(() => {
    if (!orderId && open && !draft.locationId && defaultLocationId) {
      dispatch({ type: "setField", field: "locationId", value: defaultLocationId })
    }
  }, [orderId, open, draft.locationId, defaultLocationId])

  useEffect(() => {
    if (!focusItemId) return
    const line = draft.lines.find((l) => l.itemId === focusItemId)
    if (line) quantityRefs.current.get(line.key)?.focus()
    setFocusItemId(null)
  }, [focusItemId, draft.lines])

  const purchasable = useMemo(() => (items.data ?? []).filter((i) => i.isActive), [items.data])
  const activeSuppliers = (suppliers.data ?? []).filter((s) => s.isActive || s.id === draft.supplierId)
  const activeLocations = (locations.data ?? []).filter((l) => l.isActive || l.id === draft.locationId)
  const shownErrors = errors ?? { lineErrors: {} }

  /** Persists the draft; returns the order id or null when invalid / failed. */
  async function persist(): Promise<string | null> {
    const found = validateDraft(draft)
    setErrors(found)
    if (hasDraftErrors(found)) return null
    if (!orderId) {
      const created = await create.mutateAsync(toCreateInput(draft))
      return created.id
    }
    if (!current) return null
    const input = toCreateInput(draft)
    await update.mutateAsync({
      id: orderId,
      patch: { supplierId: input.supplierId, locationId: input.locationId, expectedOn: input.expectedOn, notes: input.notes },
    })
    const diff = diffDraftLines(current, draft)
    for (const lineId of diff.remove) await removeLine.mutateAsync(lineId)
    for (const line of diff.update) await updateLine.mutateAsync(line)
    for (const line of diff.add) await addLine.mutateAsync({ purchaseOrderId: orderId, line })
    return orderId
  }

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    try {
      const done = await action()
      if (done) {
        toast({ title: done })
        onOpenChange(false)
      }
    } catch (e) {
      toast({ title: "No se pudo completar la acción", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = () => run(async () => ((await persist()) ? "Borrador guardado" : undefined))
  const send = () =>
    run(async () => {
      const id = await persist()
      if (!id) return
      await setStatus.mutateAsync({ id, status: "ordered" })
      return "Orden enviada al proveedor"
    })
  const cancelOrder = () =>
    run(async () => {
      if (!orderId) return
      await setStatus.mutateAsync({ id: orderId, status: "cancelled" })
      return "Orden cancelada"
    })
  const deleteOrder = () =>
    run(async () => {
      if (!orderId) return
      await remove.mutateAsync(orderId)
      return "Borrador eliminado"
    })

  const title = orderId ? (current ? `Orden ${poNumber(current.number)}` : "Orden de compra") : "Nueva orden de compra"
  const loading = Boolean(orderId) && (order.isLoading || !current)
  const cancellable = current && (current.status === "draft" || current.status === "ordered")

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b px-4 py-4 sm:px-6">
          <SheetTitle className="flex items-center gap-2">
            {title}
            {current && <PurchaseStatusBadge status={current.status} />}
          </SheetTitle>
          <SheetDescription>Cantidades en la unidad de compra del artículo cuando la tiene.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
            <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="po-supplier">Proveedor</Label>
                <NativeSelect
                  id="po-supplier"
                  value={draft.supplierId}
                  onChange={(e) => {
                    if (e.target.value === NEW_SUPPLIER) setSupplierDialog(true)
                    else dispatch({ type: "setField", field: "supplierId", value: e.target.value })
                  }}
                >
                  <option value="">Selecciona…</option>
                  {activeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={NEW_SUPPLIER}>+ Nuevo proveedor…</option>
                </NativeSelect>
                <FieldError message={shownErrors.supplierId} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-location">Bodega de destino</Label>
                <NativeSelect
                  id="po-location"
                  value={draft.locationId}
                  onChange={(e) => dispatch({ type: "setField", field: "locationId", value: e.target.value })}
                >
                  <option value="">Selecciona…</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError message={shownErrors.locationId} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-expected">Fecha esperada</Label>
                <Input
                  id="po-expected"
                  type="date"
                  value={draft.expectedOn}
                  onChange={(e) => dispatch({ type: "setField", field: "expectedOn", value: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:row-span-2">
                <Label htmlFor="po-notes">Notas</Label>
                <Textarea
                  id="po-notes"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => dispatch({ type: "setField", field: "notes", value: e.target.value })}
                />
              </div>
            </fieldset>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Artículos</h3>
                <span className="text-xs text-muted-foreground">{draft.lines.length} líneas</span>
              </div>
              {editable && (
                <ItemCombobox
                  ref={comboRef}
                  items={purchasable}
                  label="Agregar artículo"
                  placeholder="Agregar artículo…"
                  hotkey
                  onSelect={(item) => {
                    dispatch({ type: "addItem", item })
                    setFocusItemId(item.id)
                  }}
                />
              )}
              <FieldError message={shownErrors.lines} />
              {draft.lines.length > 0 && (
                <ul className="space-y-2">
                  {draft.lines.map((line) => (
                    <LineRow
                      key={line.key}
                      line={line}
                      editable={editable}
                      error={shownErrors.lineErrors[line.key]}
                      quantityRef={(el) => {
                        if (el) quantityRefs.current.set(line.key, el)
                        else quantityRefs.current.delete(line.key)
                      }}
                      onQuantity={(value) => dispatch({ type: "setEntryQuantity", key: line.key, value })}
                      onCost={(value) => dispatch({ type: "setEntryCost", key: line.key, value })}
                      onRemove={() => dispatch({ type: "removeLine", key: line.key })}
                    />
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-lg font-semibold tabular-nums" aria-label="Total de la orden">
                  {formatMoney(draftTotal(draft))}
                </span>
              </div>
            </section>
          </div>
        )}

        <SheetFooter className="flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-between sm:space-x-0 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            {current?.status === "draft" &&
              (confirmDelete ? (
                <Button variant="destructive" disabled={busy} onClick={() => void deleteOrder()}>
                  Confirmar eliminación
                </Button>
              ) : (
                <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                </Button>
              ))}
            {cancellable && (
              <Button variant="outline" disabled={busy} onClick={() => void cancelOrder()}>
                Cancelar orden
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {current && onReceive && (current.status === "ordered" || current.status === "partially_received") && (
              <Button onClick={() => onReceive(current)}>Recibir</Button>
            )}
            {editable && (
              <>
                <Button variant="outline" disabled={busy || loading} onClick={() => void saveDraft()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar borrador
                </Button>
                <Button disabled={busy || loading} onClick={() => void send()}>
                  <Send className="mr-2 h-4 w-4" /> Enviar
                </Button>
              </>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
      <SupplierDialog
        supplier={null}
        open={supplierDialog}
        onOpenChange={setSupplierDialog}
        onSaved={(s) => dispatch({ type: "setField", field: "supplierId", value: s.id })}
      />
    </Sheet>
  )
}
