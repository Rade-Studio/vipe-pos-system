"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { FieldError } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { useInventoryItems, useReceivePurchaseOrder, useSetPurchaseOrderPaymentStatus } from "@/hooks/inventory"
import { formatQuantity } from "@/lib/inventory/units"
import type { PaymentStatus, PurchaseOrder, PurchaseOrderStatus, ReceiveLineInput } from "@/lib/supabase/inventory/types"
import { PurchaseStatusBadge, poNumber } from "./purchase-ui"

export interface ReceiveRow {
  lineId: string
  itemName: string
  unit: string
  pending: number
  trackLots: boolean
  quantity: string
  unitCost: string
  lotCode: string
  expiresOn: string
}

const parse = (text: string) => Number(text.replace(",", "."))

/** Error per line id, plus a general one under the "" key. */
export function validateReceipt(rows: ReceiveRow[]): Record<string, string> {
  const errors: Record<string, string> = {}
  let any = false
  for (const row of rows) {
    const quantity = parse(row.quantity || "0")
    if (!Number.isFinite(quantity) || quantity < 0) errors[row.lineId] = "Cantidad no válida"
    else if (quantity > row.pending) errors[row.lineId] = "No puedes recibir más de lo pendiente"
    else if (quantity > 0) {
      any = true
      const cost = parse(row.unitCost)
      if (!Number.isFinite(cost) || cost < 0) errors[row.lineId] = "Costo no válido"
      else if (row.trackLots && !row.expiresOn) errors[row.lineId] = "La fecha de vencimiento es obligatoria"
    }
  }
  if (!any && Object.keys(errors).length === 0) errors[""] = "Indica al menos una cantidad a recibir"
  return errors
}

export function toReceiveLines(rows: ReceiveRow[]): ReceiveLineInput[] {
  return rows
    .filter((row) => parse(row.quantity || "0") > 0)
    .map((row) => ({
      lineId: row.lineId,
      quantity: parse(row.quantity),
      unitCost: parse(row.unitCost),
      ...(row.trackLots && row.lotCode.trim() ? { lotCode: row.lotCode.trim() } : {}),
      ...(row.trackLots && row.expiresOn ? { expiresOn: row.expiresOn } : {}),
    }))
}

export function ReceiveDialog({ order, onOpenChange }: { order: PurchaseOrder | null; onOpenChange: (open: boolean) => void }) {
  const items = useInventoryItems()
  const receive = useReceivePurchaseOrder()
  const setPayment = useSetPurchaseOrderPaymentStatus()
  const { toast } = useToast()
  const [rows, setRows] = useState<ReceiveRow[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<PurchaseOrderStatus | null>(null)
  const [payment, setPaymentState] = useState<PaymentStatus>("pending")

  const trackById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i.trackLots])), [items.data])

  useEffect(() => {
    if (!order) return
    setRows(
      order.lines
        .filter((l) => l.pendingQuantity > 0)
        .map((l) => ({
          lineId: l.id,
          itemName: l.itemName ?? l.sku ?? "",
          unit: l.unit ?? "",
          pending: l.pendingQuantity,
          trackLots: trackById.get(l.itemId) ?? false,
          quantity: String(l.pendingQuantity),
          unitCost: String(l.unitCost),
          lotCode: "",
          expiresOn: "",
        })),
    )
    setErrors({})
    setResult(null)
    setPaymentState(order.paymentStatus)
  }, [order, trackById])

  const patch = (lineId: string, change: Partial<ReceiveRow>) =>
    setRows((rs) => rs.map((r) => (r.lineId === lineId ? { ...r, ...change } : r)))

  const total = rows.reduce((sum, r) => {
    const q = parse(r.quantity || "0")
    const c = parse(r.unitCost || "0")
    return Number.isFinite(q * c) && q > 0 ? sum + q * c : sum
  }, 0)

  async function submit() {
    if (!order) return
    const found = validateReceipt(rows)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    try {
      const r = await receive.mutateAsync({ purchaseOrderId: order.id, lines: toReceiveLines(rows) })
      setResult(r?.status ?? "received")
      toast({ title: "Mercancía recibida" })
    } catch (e) {
      setErrors({ "": (e as Error).message })
    }
  }

  async function togglePaid(paid: boolean) {
    if (!order) return
    const next: PaymentStatus = paid ? "paid" : "pending"
    try {
      await setPayment.mutateAsync({ id: order.id, paymentStatus: next })
      setPaymentState(next)
    } catch (e) {
      toast({ title: "No se pudo actualizar el pago", description: (e as Error).message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[100dvh] w-full max-w-full flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Recibir {order ? poNumber(order.number) : ""}</DialogTitle>
          <DialogDescription>
            {order?.supplierName} · {order?.locationName}. Cantidades en la unidad base del artículo.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
              <span>Estado de la orden:</span>
              <PurchaseStatusBadge status={result} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="receive-paid">Orden pagada</Label>
              <Switch
                id="receive-paid"
                checked={payment === "paid"}
                disabled={setPayment.isPending}
                onCheckedChange={(v) => void togglePaid(v)}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => rs.map((r) => ({ ...r, quantity: String(r.pending) })))}
              >
                Recibir todo
              </Button>
            </div>
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.lineId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
                  <div className="sm:col-span-4">
                    <p className="font-medium">{row.itemName}</p>
                    <p className="text-xs text-muted-foreground">Pendiente: {formatQuantity(row.pending, row.unit)}</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rq-${row.lineId}`} className="text-xs">
                      Recibir ({row.unit})
                    </Label>
                    <Input
                      id={`rq-${row.lineId}`}
                      inputMode="decimal"
                      aria-label={`Recibir ${row.itemName}`}
                      value={row.quantity}
                      onChange={(e) => patch(row.lineId, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`rc-${row.lineId}`} className="text-xs">
                      Costo unitario
                    </Label>
                    <Input
                      id={`rc-${row.lineId}`}
                      inputMode="decimal"
                      aria-label={`Costo unitario ${row.itemName}`}
                      value={row.unitCost}
                      onChange={(e) => patch(row.lineId, { unitCost: e.target.value })}
                    />
                  </div>
                  {row.trackLots && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`rl-${row.lineId}`} className="text-xs">
                          Lote
                        </Label>
                        <Input
                          id={`rl-${row.lineId}`}
                          aria-label={`Lote ${row.itemName}`}
                          value={row.lotCode}
                          onChange={(e) => patch(row.lineId, { lotCode: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`re-${row.lineId}`} className="text-xs">
                          Vence
                        </Label>
                        <Input
                          id={`re-${row.lineId}`}
                          type="date"
                          aria-label={`Vencimiento ${row.itemName}`}
                          value={row.expiresOn}
                          onChange={(e) => patch(row.lineId, { expiresOn: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  {errors[row.lineId] && (
                    <div className="sm:col-span-4">
                      <FieldError message={errors[row.lineId]} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <FieldError message={errors[""]} />
          </div>
        )}

        <DialogFooter className="gap-2 sm:items-center sm:justify-between">
          {!result && <span className="text-sm text-muted-foreground tabular-nums">Total a recibir: {formatMoney(total)}</span>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {result ? "Cerrar" : "Cancelar"}
            </Button>
            {!result && (
              <Button disabled={receive.isPending} onClick={() => void submit()}>
                {receive.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar recepción
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
