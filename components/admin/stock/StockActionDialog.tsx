"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useAdjustStock, useInventoryLocations, useTransferStock } from "@/hooks/inventory"
import { formatQuantity, parseQuantityInput } from "@/lib/inventory/units"
import type { InventoryItem, Lot } from "@/lib/supabase/inventory/types"
import { cn } from "@/lib/utils"
import { FieldError, NativeSelect } from "./stock-ui"

export type StockAction = "adjust" | "waste" | "transfer"

export const WASTE_REASONS = ["Vencido", "Dañado", "Derrame", "Preparación fallida", "Otro"] as const

const TITLE: Record<StockAction, string> = { adjust: "Ajustar stock", waste: "Registrar merma", transfer: "Trasladar" }

interface StockActionDialogProps {
  action: StockAction | null
  item: InventoryItem
  lots: Lot[]
  onClose: () => void
}

/** Stock on hand per location, summed from the item's lots. */
function stockAt(lots: Lot[], locationId: string) {
  return lots.filter((l) => l.locationId === locationId).reduce((sum, l) => sum + l.quantity, 0)
}

export function StockActionDialog({ action, item, lots, onClose }: StockActionDialogProps) {
  const locations = useInventoryLocations()
  const adjust = useAdjustStock()
  const transfer = useTransferStock()
  const { toast } = useToast()
  const active = useMemo(() => (locations.data ?? []).filter((l) => l.isActive), [locations.data])
  const defaultId = active.find((l) => l.isDefault)?.id ?? active[0]?.id ?? ""

  const [quantity, setQuantity] = useState("")
  const [direction, setDirection] = useState<1 | -1>(1)
  const [reason, setReason] = useState("")
  const [locationId, setLocationId] = useState("")
  const [toLocationId, setToLocationId] = useState("")
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!action) return
    setQuantity("")
    setDirection(action === "adjust" ? 1 : -1)
    setReason(action === "waste" ? WASTE_REASONS[0] : "")
    setLocationId(defaultId)
    setToLocationId(active.find((l) => l.id !== defaultId)?.id ?? "")
    setError(undefined)
  }, [action, defaultId, active])

  const parsed = quantity.trim() ? parseQuantityInput(quantity, item.unit) : null
  const amount = parsed?.ok ? parsed.value : null
  const delta = amount === null ? 0 : action === "adjust" ? direction * amount : -amount
  const here = locationId ? stockAt(lots, locationId) : item.stock
  const sameLocation = action === "transfer" && !!locationId && locationId === toLocationId
  const pending = adjust.isPending || transfer.isPending

  async function confirm() {
    if (!action) return
    if (amount === null) return setError(parsed && !parsed.ok ? parsed.error : "Ingresa una cantidad")
    if (!locationId) return setError("Selecciona una bodega")
    if (action === "transfer" && (!toLocationId || sameLocation)) return setError("Las bodegas de origen y destino deben ser distintas")
    if (action === "adjust" && !reason.trim()) return setError("Indica el motivo del ajuste")
    try {
      if (action === "transfer") {
        await transfer.mutateAsync({ itemId: item.id, fromLocationId: locationId, toLocationId, quantity: amount })
      } else {
        await adjust.mutateAsync({
          itemId: item.id,
          locationId,
          movementType: action === "waste" ? "waste" : "adjustment",
          quantity: action === "waste" ? amount : direction * amount,
          reason: reason.trim(),
        })
      }
      toast({ title: action === "transfer" ? "Traslado registrado" : action === "waste" ? "Merma registrada" : "Ajuste registrado" })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action ? TITLE[action] : ""}</DialogTitle>
          <DialogDescription>
            {item.sku} · {item.name}
          </DialogDescription>
        </DialogHeader>

        <form
          id="stock-action"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <div className={cn("grid gap-3", action === "transfer" && "sm:grid-cols-2")}>
            <div className="space-y-1.5">
              <Label htmlFor="action-location">{action === "transfer" ? "Desde" : "Bodega"}</Label>
              <NativeSelect id="action-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {active.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {action === "transfer" && (
              <div className="space-y-1.5">
                <Label htmlFor="action-to-location">Hacia</Label>
                <NativeSelect id="action-to-location" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {active.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="action-quantity">Cantidad</Label>
            <div className="flex gap-2">
              {action === "adjust" && (
                <div className="flex rounded-md border p-0.5" role="group" aria-label="Dirección">
                  {([1, -1] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={direction === d}
                      className={cn("rounded px-3 text-sm", direction === d ? "bg-secondary font-medium" : "text-muted-foreground")}
                      onClick={() => setDirection(d)}
                    >
                      {d === 1 ? "Sumar" : "Restar"}
                    </button>
                  ))}
                </div>
              )}
              <Input
                id="action-quantity"
                autoFocus
                inputMode="decimal"
                placeholder={`Ej. 2 ${item.unit}`}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setError(undefined)
                }}
              />
            </div>
            {parsed && !parsed.ok ? (
              <FieldError message={parsed.error} />
            ) : (
              <p className="text-xs text-muted-foreground">Acepta unidades, p. ej. «500 g» o «1,5 kg».</p>
            )}
          </div>

          {action === "waste" && (
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Motivo">
                {WASTE_REASONS.map((r) => (
                  <Button key={r} type="button" size="sm" variant={reason === r ? "default" : "outline"} aria-pressed={reason === r} onClick={() => setReason(r)}>
                    {r}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {action === "adjust" && (
            <div className="space-y-1.5">
              <Label htmlFor="action-reason">Motivo</Label>
              <Input id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. corrección de inventario" />
            </div>
          )}

          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="stock-preview">
            <span className="text-muted-foreground">Stock en bodega: </span>
            <span className="tabular-nums">{formatQuantity(here, item.unit)}</span>
            <span className="text-muted-foreground"> → </span>
            <span className={cn("font-medium tabular-nums", here + delta < 0 && "text-destructive")}>{formatQuantity(here + delta, item.unit)}</span>
          </div>
          {sameLocation && <FieldError message="Las bodegas de origen y destino deben ser distintas" />}
          <FieldError message={error} />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="stock-action" disabled={pending || sameLocation}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
