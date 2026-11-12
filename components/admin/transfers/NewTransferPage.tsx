"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeftRight, ChevronLeft, Snowflake, X } from "lucide-react"
import { ItemCombobox, formatMoney, type ItemComboboxHandle } from "@/components/admin/inventory-shared"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useInventoryItems, useInventoryLocations, useStockAtLocation } from "@/hooks/inventory"
import { useCreateTransfer, useSendTransfer, useUpdateTransfer } from "@/hooks/admin/use-transfers"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem, InventoryTransfer, TransferInput } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { parseQuantity, plural, quantityText, trNumber } from "./transfer-ui"

interface Line {
  itemId: string
  quantity: string
}

/**
 * A transfer of several items, as a full page inside the admin shell (user
 * comment ypn4kjxz): nothing outside it discards the progress, and leaving
 * with unsaved changes asks first.
 */
export function NewTransferPage({ transfer, onClose }: { transfer: InventoryTransfer | null; onClose: () => void }) {
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const create = useCreateTransfer()
  const update = useUpdateTransfer()
  const send = useSendTransfer()
  const { toast } = useToast()
  const comboRef = useRef<ItemComboboxHandle>(null)

  const active = (locations.data ?? []).filter((l) => l.isActive)
  const defaultFrom = active.find((l) => l.isDefault)?.id ?? active[0]?.id ?? ""
  const [id, setId] = useState(transfer?.id ?? null)
  const [from, setFrom] = useState(transfer?.fromLocationId ?? defaultFrom)
  const [to, setTo] = useState(transfer?.toLocationId ?? active.find((l) => l.id !== defaultFrom)?.id ?? "")
  const [notes, setNotes] = useState(transfer?.notes ?? "")
  const [lines, setLines] = useState<Line[]>(
    (transfer?.lines ?? []).map((l) => ({ itemId: l.itemId, quantity: quantityText(l.requestedQuantity) })),
  )
  const [dirty, setDirty] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Locations may load after the page opens.
  useEffect(() => {
    if (from || !defaultFrom) return
    setFrom(defaultFrom)
    setTo(active.find((l) => l.id !== defaultFrom)?.id ?? "")
  }, [from, defaultFrom, active])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]))
  const stock = useStockAtLocation(
    lines.map((l) => l.itemId),
    from,
  )
  const nameOf = (locationId: string) => active.find((l) => l.id === locationId)?.name ?? ""
  const edit = () => setDirty(true)
  const setQuantity = (itemId: string, quantity: string) => {
    edit()
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)))
  }

  const rows = lines.map((line) => {
    const item = itemById.get(line.itemId)
    const available = stock?.get(line.itemId) ?? null
    const quantity = parseQuantity(line.quantity)
    const over = available !== null && quantity > available
    const valid = quantity > 0 && available !== null && !over
    return { line, item, available, quantity, over, valid }
  })
  const bad = rows.filter((r) => r.over).length
  const ready = rows.filter((r) => r.valid)
  const total = ready.reduce((sum, r) => sum + r.quantity * (r.item?.cost ?? 0), 0)
  const same = Boolean(from) && from === to
  const busy = create.isPending || update.isPending || send.isPending

  async function save(): Promise<InventoryTransfer | null> {
    const input: TransferInput = {
      fromLocationId: from,
      toLocationId: to,
      notes: notes.trim() || null,
      lines: ready.map((r) => ({ itemId: r.line.itemId, quantity: r.quantity })),
    }
    try {
      const saved = id ? await update.mutateAsync({ id, input }) : await create.mutateAsync(input)
      setId(saved.id)
      setDirty(false)
      setSavedAt(new Date())
      return saved
    } catch (e) {
      toast({ title: "No se pudo guardar la transferencia", description: (e as Error).message, variant: "destructive" })
      return null
    }
  }

  async function saveDraft() {
    const saved = await save()
    if (saved) toast({ title: "Borrador guardado", description: `${trNumber(saved.number)}. Lo encuentras como borrador en Transferencias.` })
  }

  async function sendNow() {
    const saved = await save()
    if (!saved) return
    try {
      await send.mutateAsync(saved.id)
      toast({
        title: `${trNumber(saved.number)} enviada`,
        description: `Salió de ${nameOf(from)} y queda en tránsito hasta que ${nameOf(to)} confirme.`,
      })
      onClose()
    } catch (e) {
      toast({ title: "No se pudo enviar la transferencia", description: (e as Error).message, variant: "destructive" })
    }
  }

  const pickable = (items.data ?? []).filter((i) => i.isActive)

  return (
    <section aria-labelledby="nt-title" className="space-y-6 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 min-h-9" onClick={() => (dirty ? setLeaving(true) : onClose())}>
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Transferencias
          </Button>
          <h1 id="nt-title" className="text-2xl font-semibold tracking-tight">
            {transfer ? `Borrador ${trNumber(transfer.number)}` : "Nueva transferencia"}
          </h1>
          <p className="text-sm text-muted-foreground">Sale de una bodega y entra a otra al costo de sus lotes (primero lo que vence primero)</p>
        </div>
        {savedAt && !dirty && (
          <span role="status" className="text-sm text-muted-foreground">
            Borrador guardado
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="nt-from">Desde</Label>
          <NativeSelect id="nt-from" className="h-11 w-full" value={from} onChange={(e) => (edit(), setFrom(e.target.value))}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Intercambiar origen y destino"
          onClick={() => {
            edit()
            setFrom(to)
            setTo(from)
          }}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="nt-to">Hacia</Label>
          <NativeSelect id="nt-to" className="h-11 w-full" value={to} aria-invalid={same} onChange={(e) => (edit(), setTo(e.target.value))}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {same && <p className="text-sm text-destructive">Elige una bodega de destino distinta al origen.</p>}

      <section aria-labelledby="nt-lines" className="space-y-3">
        <h2 id="nt-lines" className="text-base font-semibold">
          Artículos ({lines.length})
        </h2>
        <ItemCombobox<InventoryItem>
          ref={comboRef}
          items={pickable}
          excludeIds={lines.map((l) => l.itemId)}
          label="Agregar artículo"
          placeholder={`Agregar artículo de ${nameOf(from)}…`}
          onSelect={(item) => {
            edit()
            setLines((prev) => [...prev, { itemId: item.id, quantity: "" }])
          }}
        />
        {lines.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Busca y agrega los artículos que vas a mover.</p>
        ) : (
          <div className="rounded-2xl border bg-card">
            <table className="block w-full text-sm md:table">
              <caption className="sr-only">Artículos a transferir</caption>
              <thead className="hidden md:table-header-group">
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="h-10 border-b px-3 text-left font-medium">Artículo</th>
                  <th scope="col" className="h-10 border-b px-3 text-left font-medium">Disponible</th>
                  <th scope="col" className="h-10 border-b px-3 text-left font-medium">Cantidad</th>
                  <th scope="col" className="h-10 border-b px-3 text-right font-medium">Valor</th>
                  <th scope="col" className="h-10 w-px border-b px-3">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {rows.map(({ line, item, available, over, valid, quantity }) => {
                  const name = item?.name ?? ""
                  const unit = item?.unit ?? ""
                  const empty = available !== null && available <= 0
                  return (
                    <tr key={line.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0 md:table-row md:p-0">
                      <td className="block md:table-cell md:px-3 md:py-2">
                        <b>{name}</b> <span className="font-mono text-xs text-muted-foreground">{item?.sku}</span>
                      </td>
                      <td className="col-start-1 block tabular-nums md:table-cell md:px-3 md:py-2">
                        <span className="text-muted-foreground md:hidden">Disponible en {nameOf(from)}: </span>
                        {available === null ? "…" : empty ? <span className="text-destructive">Sin stock</span> : formatQuantity(available, unit)}
                      </td>
                      <td className="col-start-1 block md:table-cell md:px-3 md:py-2">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`Cantidad de ${name}`}
                            inputMode="decimal"
                            placeholder="0"
                            className={cn("h-9 w-24", over && "border-destructive")}
                            aria-invalid={over}
                            disabled={empty}
                            value={line.quantity}
                            onChange={(e) => setQuantity(line.itemId, e.target.value)}
                          />
                          <span className="text-xs text-muted-foreground">{unit}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-9"
                            disabled={available === null || empty}
                            aria-label={`Pasar todo el disponible de ${name}`}
                            onClick={() => available !== null && setQuantity(line.itemId, quantityText(available))}
                          >
                            Todo
                          </Button>
                        </div>
                        {over && available !== null && (
                          <span className="mt-1 block text-xs text-destructive">
                            Máximo {formatQuantity(available, unit)} en {nameOf(from)}
                          </span>
                        )}
                      </td>
                      <td className="col-start-2 row-start-2 block text-right tabular-nums md:table-cell md:px-3 md:py-2">
                        {valid ? formatMoney(quantity * (item?.cost ?? 0)) : "—"}
                      </td>
                      <td className="col-start-2 row-start-1 block md:table-cell md:w-px md:px-3 md:py-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label={`Quitar ${name}`}
                          onClick={() => {
                            edit()
                            setLines((prev) => prev.filter((l) => l.itemId !== line.itemId))
                            comboRef.current?.focus()
                          }}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex gap-2 rounded-2xl border bg-muted/40 p-3 text-sm">
        <Snowflake className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <span>
          Al enviar, el stock <b>sale de {nameOf(from)}</b> y queda <b>En tránsito</b> (congelado: no se vende, no se usa, no se cuenta). Entra a{" "}
          {nameOf(to)} solo cuando allá confirmen lo que llegó.
        </span>
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="nt-notes">Nota (opcional)</Label>
        <Textarea id="nt-notes" placeholder="Ej.: reposición para el fin de semana" value={notes} onChange={(e) => (edit(), setNotes(e.target.value))} />
      </div>

      <div
        role="region"
        aria-label="Resumen de la transferencia"
        className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <p className="mr-auto text-sm" aria-live="polite">
          {bad ? (
            <span className="text-destructive">{bad === 1 ? "1 línea supera" : `${bad} líneas superan`} el disponible</span>
          ) : (
            <>
              <b>{plural(ready.length, "artículo", "artículos")}</b> · <span className="tabular-nums">{formatMoney(total)}</span> a costo de lotes
            </>
          )}
        </p>
        <Button variant="outline" className="min-h-11" disabled={busy || same || bad > 0 || ready.length === 0} onClick={() => void saveDraft()}>
          Guardar borrador
        </Button>
        <Button className="min-h-11" disabled={busy || same || bad > 0 || ready.length === 0} onClick={() => void sendNow()}>
          Enviar transferencia
        </Button>
      </div>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir de la transferencia?</AlertDialogTitle>
            <AlertDialogDescription>Tienes cambios sin guardar. Si sales ahora se pierden.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Salir sin guardar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
