"use client"

import { useEffect, useState } from "react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { useCancelTransfer, useReceiveTransfer } from "@/hooks/admin/use-transfers"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem, InventoryTransfer, ReceiveTransferLineInput } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { TransferStatusBadge, parseQuantity, plural, quantityText, transferActor, trNumber } from "./transfer-ui"

export const SHORTFALL_REASONS = ["Se dañó en el camino", "Se derramó o rompió", "No venía en el envío", "Error al despachar", "Otro"]

interface DialogProps {
  transfer: InventoryTransfer | null
  items: ReadonlyMap<string, InventoryItem>
  onOpenChange: (open: boolean) => void
}

const cost = (items: ReadonlyMap<string, InventoryItem>, itemId: string) => items.get(itemId)?.cost ?? 0

export function ReceiveTransferDialog({ transfer, items, onOpenChange }: DialogProps) {
  const receive = useReceiveTransfer()
  const { toast } = useToast()
  const [received, setReceived] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})

  useEffect(() => {
    setReceived(Object.fromEntries((transfer?.lines ?? []).map((l) => [l.id, quantityText(l.requestedQuantity)])))
    setReasons({})
  }, [transfer])

  const rows = (transfer?.lines ?? []).map((line) => {
    const value = parseQuantity(received[line.id] ?? "")
    const over = !(value >= 0) || value > line.requestedQuantity
    const short = over ? 0 : Math.round((line.requestedQuantity - value) * 10_000) / 10_000
    return { line, value, over, short, missingReason: short > 0 && !reasons[line.id] }
  })
  const bad = rows.filter((r) => r.over || r.missingReason).length
  const shortRows = rows.filter((r) => !r.over && r.short > 0)
  const loss = shortRows.reduce((sum, r) => sum + r.short * cost(items, r.line.itemId), 0)

  async function confirm() {
    if (!transfer) return
    const lines: ReceiveTransferLineInput[] = rows.map((r) =>
      r.short > 0 ? { lineId: r.line.id, receivedQuantity: r.value, shortfallReason: reasons[r.line.id] } : { lineId: r.line.id, receivedQuantity: r.value },
    )
    try {
      await receive.mutateAsync({ id: transfer.id, lines })
      toast({
        title: `${trNumber(transfer.number)} recibida${shortRows.length ? " con faltante" : ""}`,
        description: shortRows.length
          ? `Lo que llegó entró a ${transfer.toLocationName ?? "destino"} y el resto quedó como merma en tránsito.`
          : `El stock salió de tránsito y ya está en ${transfer.toLocationName ?? "destino"}.`,
      })
      onOpenChange(false)
    } catch (e) {
      toast({ title: "No se pudo recibir la transferencia", description: (e as Error).message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {transfer && (
          <>
            <DialogHeader>
              <DialogTitle>
                Recibir {trNumber(transfer.number)} en {transfer.toLocationName}
              </DialogTitle>
              <DialogDescription>
                Enviada por {transferActor(transfer).who}, {transferActor(transfer).when}
              </DialogDescription>
            </DialogHeader>
            <table className="w-full text-sm">
              <caption className="sr-only">Cantidades enviadas y recibidas</caption>
              <thead className="hidden sm:table-header-group">
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="h-9 border-b text-left font-medium">Artículo</th>
                  <th scope="col" className="h-9 border-b px-2 text-right font-medium">Enviado</th>
                  <th scope="col" className="h-9 border-b px-2 text-left font-medium">Llegó</th>
                  <th scope="col" className="h-9 border-b text-left font-medium">Faltante · motivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, over, short }) => {
                  const unit = line.unit ?? ""
                  return (
                    <tr key={line.id} className="grid grid-cols-2 gap-2 border-b py-2 last:border-b-0 sm:table-row">
                      <td className="col-span-2 font-medium sm:py-2">{line.itemName}</td>
                      <td className="tabular-nums sm:px-2 sm:text-right">
                        <span className="text-muted-foreground sm:hidden">Enviado </span>
                        {formatQuantity(line.requestedQuantity, unit)}
                      </td>
                      <td className="sm:px-2">
                        <Input
                          aria-label={`Cantidad que llegó de ${line.itemName}`}
                          inputMode="decimal"
                          className={cn("h-9 w-24", over && "border-destructive")}
                          aria-invalid={over}
                          value={received[line.id] ?? ""}
                          onChange={(e) => setReceived((prev) => ({ ...prev, [line.id]: e.target.value }))}
                        />
                      </td>
                      <td className="col-span-2 text-xs">
                        {over ? (
                          <span className="text-destructive">No puede llegar más de lo enviado ({formatQuantity(line.requestedQuantity, unit)})</span>
                        ) : short > 0 ? (
                          <div className="space-y-1">
                            <span className="text-warning-foreground dark:text-yellow-200">
                              <b>−{formatQuantity(short, unit)}</b> · {formatMoney(short * cost(items, line.itemId))} a merma
                            </span>
                            <NativeSelect
                              aria-label={`Motivo del faltante de ${line.itemName}`}
                              aria-invalid={!reasons[line.id]}
                              className="h-9 w-full"
                              value={reasons[line.id] ?? ""}
                              onChange={(e) => setReasons((prev) => ({ ...prev, [line.id]: e.target.value }))}
                            >
                              <option value="">Motivo del faltante…</option>
                              {SHORTFALL_REASONS.map((reason) => (
                                <option key={reason}>{reason}</option>
                              ))}
                            </NativeSelect>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Completo</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              Entra a {transfer.toLocationName} lo que llegó. Lo que falte sale de tránsito como <b>merma en tránsito</b> con su motivo y la
              transferencia queda <b>Recibida con faltante</b>.
            </p>
            <DialogFooter className="items-center gap-2">
              <p className="mr-auto text-sm" aria-live="polite">
                {bad
                  ? `Revisa ${plural(bad, "línea", "líneas")}`
                  : shortRows.length
                    ? `${shortRows.length} con faltante · ${formatMoney(loss)} a merma en tránsito`
                    : "Llegó todo completo"}
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button disabled={bad > 0 || receive.isPending} onClick={() => void confirm()}>
                Confirmar recepción
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CancelTransferDialog({ transfer, items, onOpenChange }: DialogProps) {
  const cancel = useCancelTransfer()
  const { toast } = useToast()
  const value = (transfer?.lines ?? []).reduce((sum, l) => sum + l.requestedQuantity * cost(items, l.itemId), 0)

  async function confirm() {
    if (!transfer) return
    try {
      await cancel.mutateAsync(transfer.id)
      toast({ title: `${trNumber(transfer.number)} anulada`, description: `El stock volvió a ${transfer.fromLocationName ?? "origen"}.` })
      onOpenChange(false)
    } catch (e) {
      toast({ title: "No se pudo anular la transferencia", description: (e as Error).message, variant: "destructive" })
    }
  }

  return (
    <AlertDialog open={transfer !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {transfer && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Anular {trNumber(transfer.number)}?</AlertDialogTitle>
              <AlertDialogDescription>
                Las {plural(transfer.lines.length, "línea", "líneas")} ({formatMoney(value)}) salen de tránsito y vuelven a{" "}
                {transfer.fromLocationName}. {transfer.toLocationName} ya no podrá recibirla.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <Button variant="destructive" disabled={cancel.isPending} onClick={() => void confirm()}>
                Anular y devolver el stock
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Read-only lines of a received or cancelled transfer. */
export function TransferDetailDialog({ transfer, onOpenChange }: Omit<DialogProps, "items">) {
  return (
    <Dialog open={transfer !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {transfer && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {trNumber(transfer.number)} <TransferStatusBadge status={transfer.status} />
              </DialogTitle>
              <DialogDescription>
                {transfer.fromLocationName} → {transfer.toLocationName}
                {transfer.receivedByName ? ` · Recibió ${transfer.receivedByName}` : ""}
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y text-sm">
              {transfer.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-medium">{line.itemName}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatQuantity(line.requestedQuantity, line.unit ?? "")}
                    {line.receivedQuantity !== null && ` · llegó ${formatQuantity(line.receivedQuantity, line.unit ?? "")}`}
                    {line.shortfallQuantity ? ` · merma ${formatQuantity(line.shortfallQuantity, line.unit ?? "")} (${line.shortfallReason})` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {transfer.notes && <p className="text-sm text-muted-foreground">{transfer.notes}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
