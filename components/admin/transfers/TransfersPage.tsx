"use client"

import { useMemo, useState } from "react"
import { ArrowRight, ArrowRightLeft, Plus, Snowflake } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { formatMoney } from "@/components/admin/inventory-shared"
import { SearchField } from "@/components/admin/production/production-ui"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useInventoryItems, useInventoryLocations } from "@/hooks/inventory"
import { useSendTransfer, useTransfers } from "@/hooks/admin/use-transfers"
import type { InventoryTransfer, TransferStatus } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { NewTransferPage } from "./NewTransferPage"
import { CancelTransferDialog, ReceiveTransferDialog, TransferDetailDialog } from "./TransferDialogs"
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABEL,
  TransferStatusBadge,
  plural,
  sortTransfers,
  transferActor,
  transferValue,
  trNumber,
} from "./transfer-ui"

type Editor = { transfer: InventoryTransfer | null }

export function TransfersPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const [status, setStatus] = useState<TransferStatus | "">("")
  const [locationId, setLocationId] = useState("")
  const [query, setQuery] = useState("")
  const [editor, setEditor] = useState<Editor | null>(null)
  const [receiving, setReceiving] = useState<InventoryTransfer | null>(null)
  const [cancelling, setCancelling] = useState<InventoryTransfer | null>(null)
  const [viewing, setViewing] = useState<InventoryTransfer | null>(null)

  const transfers = useTransfers()
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const send = useSendTransfer()
  const { toast } = useToast()

  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data])

  if (editor) return <NewTransferPage transfer={editor.transfer} onClose={() => setEditor(null)} />

  async function sendDraft(t: InventoryTransfer) {
    try {
      await send.mutateAsync(t.id)
      toast({ title: `${trNumber(t.number)} enviada`, description: `Salió de ${t.fromLocationName ?? "origen"} y quedó en tránsito.` })
    } catch (e) {
      toast({ title: "No se pudo enviar la transferencia", description: (e as Error).message, variant: "destructive" })
    }
  }

  const all = transfers.data ?? []
  const text = query.trim().toLowerCase()
  const rows = sortTransfers(
    all.filter(
      (t) =>
        (!status || t.status === status) &&
        (!locationId || t.fromLocationId === locationId || t.toLocationId === locationId) &&
        (!text || `${trNumber(t.number)} ${t.lines.map((l) => l.itemName).join(" ")}`.toLowerCase().includes(text)),
    ),
  )

  const inTransit = all.filter((t) => t.status === "in_transit")
  const byDestination = [...new Set(inTransit.map((t) => t.toLocationId))].map((id) => {
    const group = inTransit.filter((t) => t.toLocationId === id)
    return { id, name: group[0].toLocationName, count: group.length, value: group.reduce((s, t) => s + transferValue(t, itemById), 0) }
  })
  const transitValue = byDestination.reduce((s, d) => s + d.value, 0)
  const chips: { value: TransferStatus | ""; label: string }[] = [
    { value: "", label: "Todas" },
    ...TRANSFER_STATUSES.map((s) => ({ value: s, label: TRANSFER_STATUS_LABEL[s] })),
  ]
  const cell = "block md:table-cell md:px-3 md:py-2"

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferencias"
        description={description}
        actions={
          <Button className="min-h-11" onClick={() => setEditor({ transfer: null })}>
            <Plus className="mr-2 h-4 w-4" /> Nueva transferencia
          </Button>
        }
      />

      <section aria-label="Stock en camino" className="rounded-2xl border bg-card p-4 text-sm">
        <div className="flex gap-3">
          <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <p>
            <b>
              En tránsito: {plural(inTransit.length, "transferencia", "transferencias")} · <span className="tabular-nums">{formatMoney(transitValue)}</span>
            </b>
            <span className="block text-muted-foreground">
              Ya salió del origen y aún no entra al destino: no se vende, no se usa y no se cuenta en ninguna bodega.
            </span>
          </p>
        </div>
        {byDestination.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 pl-8">
            {byDestination.map((d) => (
              <li key={d.id}>
                Hacia <b>{d.name}</b> · {plural(d.count, "transferencia", "transferencias")} ·{" "}
                <span className="tabular-nums">{formatMoney(d.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField label="Buscar transferencia o artículo" placeholder="Buscar TR-0007 o artículo…" value={query} onChange={setQuery} />
        <div className="flex w-full gap-1.5 overflow-x-auto sm:w-auto sm:flex-wrap" role="group" aria-label="Filtrar por estado">
          {chips.map((chip) => (
            <button
              key={chip.value || "all"}
              type="button"
              aria-pressed={status === chip.value}
              onClick={() => setStatus(chip.value)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                status === chip.value && "border-primary/50 bg-primary/10 text-foreground",
              )}
            >
              {chip.label} <span className="tabular-nums">{chip.value ? all.filter((t) => t.status === chip.value).length : all.length}</span>
            </button>
          ))}
        </div>
        <NativeSelect
          aria-label="Bodega de origen o destino"
          className="h-11 w-full sm:ml-auto sm:w-56"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">Todas las bodegas</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {transfers.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState icon={ArrowRightLeft} title="Sin transferencias" description="Mueve stock entre bodegas con una nueva transferencia." />
      ) : (
        <div className="rounded-2xl border bg-card">
          <table className="block w-full text-sm md:table">
            <caption className="sr-only">Transferencias entre bodegas, en tránsito primero</caption>
            <thead className="hidden md:table-header-group">
              <tr className="text-xs text-muted-foreground">
                {["N.º", "Origen → destino", "Artículos", "Valor", "Envió", "Estado"].map((label) => (
                  <th key={label} scope="col" className={cn("h-10 border-b px-3 text-left font-medium", label === "Valor" && "text-right")}>
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
                  <td colSpan={7} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                    No hay transferencias con estos filtros.
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const names = t.lines.map((l) => l.itemName ?? "")
                  const actor = transferActor(t)
                  return (
                    <tr
                      key={t.id}
                      onClick={() => (t.status === "draft" ? setEditor({ transfer: t }) : setViewing(t))}
                      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40 md:table-row md:p-0"
                    >
                      <td className={cn(cell, "font-mono text-xs")}>{trNumber(t.number)}</td>
                      <td className={cn(cell, "col-start-1 min-w-0 font-medium")}>
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {t.fromLocationName}
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="sr-only"> hacia </span>
                          {t.toLocationName}
                        </span>
                      </td>
                      <td className={cn(cell, "col-start-1 min-w-0 truncate")} title={names.join(", ")}>
                        <b>{plural(t.lines.length, "artículo", "artículos")}</b> · {names.slice(0, 2).join(", ")}
                        {names.length > 2 && ` +${names.length - 2}`}
                      </td>
                      <td className={cn(cell, "col-start-2 row-start-2 text-right tabular-nums")}>{formatMoney(transferValue(t, itemById))}</td>
                      <td className={cn(cell, "col-start-1")}>
                        {actor.who}
                        <small className="block text-xs text-muted-foreground">{actor.when}</small>
                      </td>
                      <td className={cn(cell, "col-start-2 row-start-1")}>
                        <TransferStatusBadge status={t.status} />
                      </td>
                      <td className={cn(cell, "col-span-2 mt-1 md:mt-0 md:w-px md:whitespace-nowrap md:text-right")}>
                        <div className="flex flex-wrap gap-2 md:justify-end" onClick={(e) => e.stopPropagation()}>
                          {t.status === "in_transit" ? (
                            <>
                              <Button size="sm" variant="outline" className="min-h-9 flex-1 md:flex-none" aria-haspopup="dialog" onClick={() => setCancelling(t)}>
                                Anular
                              </Button>
                              <Button size="sm" className="min-h-9 flex-1 md:flex-none" aria-haspopup="dialog" onClick={() => setReceiving(t)}>
                                Recibir
                              </Button>
                            </>
                          ) : t.status === "draft" ? (
                            <Button size="sm" variant="outline" className="min-h-9 w-full md:w-auto" disabled={send.isPending} onClick={() => void sendDraft(t)}>
                              Enviar
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="min-h-9 w-full md:w-auto" aria-label={`Ver ${trNumber(t.number)}`} onClick={() => setViewing(t)}>
                              Ver
                            </Button>
                          )}
                        </div>
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
        {rows.length} de {all.length} transferencias
      </p>

      <ReceiveTransferDialog transfer={receiving} items={itemById} onOpenChange={(open) => !open && setReceiving(null)} />
      <CancelTransferDialog transfer={cancelling} items={itemById} onOpenChange={(open) => !open && setCancelling(null)} />
      <TransferDetailDialog transfer={viewing} onOpenChange={(open) => !open && setViewing(null)} />
    </div>
  )
}
