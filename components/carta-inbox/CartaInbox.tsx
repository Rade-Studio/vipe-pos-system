"use client"

import { useEffect, useId, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTerminal } from "@/components/terminal/terminal-context"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  confirmErrorMessage,
  confirmProposal,
  getInbox,
  kitchenCommandFor,
  rejectProposal,
  resolveRequest,
  type InboxProposal,
  type InboxRequest,
} from "@/lib/api/carta-inbox"
import { conflictMessage } from "@/lib/api/errors"
import { sendCommand } from "@/lib/api/print"
import { usePrintingEnabled } from "@/lib/api/printing"
import { realtimeService } from "@/lib/api/realtime"
import { clockTime } from "@/lib/order-steps/details"

export const CARTA_INBOX_KEY = ["carta-inbox"] as const

const tableLabel = (row: { tableNumber: number; zoneName: string | null }) =>
  row.zoneName ? `Mesa ${row.tableNumber} · ${row.zoneName}` : `Mesa ${row.tableNumber}`

const requestText = (request: InboxRequest) =>
  request.kind === "bill" ? `Mesa ${request.tableNumber} pide la cuenta` : `Mesa ${request.tableNumber} llama al mesero`

const meta = (row: { zoneName: string | null; waiterName: string | null; createdAt: string }) =>
  [clockTime(new Date(row.createdAt)), row.waiterName].filter(Boolean).join(" · ")

/**
 * The waiter's "Carta" button and sheet (T5, S12/S14): guest proposals to
 * confirm or reject and table requests to mark as attended, live through the
 * staff realtime socket. A confirm adds the lines to the open order; the
 * comanda is queued here, as the waiter's own send does.
 */
export function CartaInbox() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: CARTA_INBOX_KEY, queryFn: getInbox, retry: false })

  useEffect(() => {
    // The shared client may predate the carta stream (screens that mock it).
    const unsubscribe = realtimeService.subscribeToCartaInbox?.(() => {
      void queryClient.invalidateQueries({ queryKey: CARTA_INBOX_KEY })
    })
    return () => unsubscribe?.()
  }, [queryClient])

  const proposals = data?.proposals ?? []
  const requests = data?.requests ?? []
  const count = proposals.length + requests.length

  return (
    <>
      <Button
        variant="outline"
        className="relative min-h-11 gap-2"
        aria-label={count > 0 ? `Carta (${count} pendientes)` : "Carta"}
        onClick={() => setOpen(true)}
      >
        <QrCode className="h-[18px] w-[18px]" aria-hidden />
        Carta
        {count > 0 && (
          <span
            aria-hidden
            className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold tabular-nums text-primary-foreground"
          >
            {count}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle>Pedidos de la carta</SheetTitle>
            <SheetDescription>Lo que piden las mesas desde el QR. Nada va a cocina hasta que lo confirmes.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 p-4">
            {count === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No hay pedidos ni solicitudes de la carta.</p>}
            {requests.length > 0 && (
              <section aria-label="Solicitudes" className="grid gap-2">
                {requests.map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))}
              </section>
            )}
            {proposals.length > 0 && (
              <section aria-label="Pedidos por confirmar" className="grid gap-3">
                {proposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function useRefreshInbox() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: CARTA_INBOX_KEY })
}

/**
 * Runs a write once someone is identified: on a shared terminal (T5b, L29)
 * the PIN sheet first, so the API client sends that waiter's acting claim,
 * as on the waiter's own order writes; a closed sheet sends nothing. With
 * own accounts it runs at once.
 */
function useIdentified() {
  const terminal = useTerminal()
  return async (label: string, write: () => void) => {
    if (terminal && !(await terminal.ensureIdentity({ label }))) return
    write()
  }
}

function RequestCard({ request }: { request: InboxRequest }) {
  const refresh = useRefreshInbox()
  const identified = useIdentified()
  const titleId = useId()
  const resolve = useMutation({ mutationFn: () => resolveRequest(request.id), onSuccess: refresh })
  const tone =
    request.kind === "bill"
      ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg"
      : "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg"
  return (
    <article aria-labelledby={titleId} className={`flex items-center gap-3 rounded-lg border p-3 ${tone}`}>
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="font-semibold">
          {requestText(request)}
        </h3>
        <p className="text-xs">{[request.zoneName, meta(request)].filter(Boolean).join(" · ")}</p>
        {resolve.isError && (
          <p role="alert" className="text-xs font-medium">
            No se pudo marcar como atendido. Intenta de nuevo.
          </p>
        )}
      </div>
      <Button variant="outline" className="min-h-11 bg-background text-foreground" disabled={resolve.isPending} onClick={() => void identified(`Mesa ${request.tableNumber}`, () => resolve.mutate())}>
        Atendido
      </Button>
    </article>
  )
}

function ProposalCard({ proposal }: { proposal: InboxProposal }) {
  const refresh = useRefreshInbox()
  const printingEnabled = usePrintingEnabled()
  const identified = useIdentified()
  const titleId = useId()
  const reasonId = useId()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const confirm = useMutation({
    mutationFn: () => confirmProposal(proposal.id),
    onSuccess: (confirmed) => {
      // S2 (F6): a restaurant without thermal printers reads the comanda on the kitchen screen.
      if (printingEnabled) void sendCommand(kitchenCommandFor(proposal, confirmed.orderItemIds))
      return refresh()
    },
  })
  const reject = useMutation({ mutationFn: () => rejectProposal(proposal.id, reason), onSuccess: refresh })
  const busy = confirm.isPending || reject.isPending
  const error = confirm.isError
    ? confirmErrorMessage(confirm.error)
    : reject.isError
      ? conflictMessage(reject.error, "No se pudo rechazar el pedido. Intenta de nuevo.")
      : null

  return (
    <article aria-labelledby={titleId} className="grid gap-3 rounded-lg border bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className="font-semibold">
            {tableLabel(proposal)}
          </h3>
          <p className="text-xs text-muted-foreground">{meta(proposal)}</p>
        </div>
        <span className="inline-flex min-h-6 items-center rounded-full border border-status-warning-line bg-status-warning-bg px-2 text-xs font-semibold text-status-warning-fg">
          Por confirmar
        </span>
      </header>
      <ul className="grid gap-1.5 text-sm">
        {proposal.lines.map((line, index) => (
          <li key={`${line.dishId}-${index}`}>
            <span className="font-medium">{`${line.quantity} × ${line.name ?? "Plato"}`}</span>
            {(line.options.length > 0 || line.note) && (
              <div className="text-xs text-muted-foreground">
                {line.options.map((o) => (
                  <span key={o.id} className="mr-2">
                    {o.name}
                  </span>
                ))}
                {line.note && <span className="italic">{`“${line.note}”`}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {proposal.note && <p className="rounded-md bg-muted p-2 text-sm">{`Nota del comensal: ${proposal.note}`}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {rejecting ? (
        <div className="grid gap-2">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Motivo (opcional)
          </label>
          <input
            id={reasonId}
            value={reason}
            maxLength={140}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: se acabó la bandeja"
            className="min-h-11 rounded-md border bg-background px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1" disabled={busy} onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="min-h-11 flex-1" disabled={busy} onClick={() => void identified(`Mesa ${proposal.tableNumber}`, () => reject.mutate())}>
              Rechazar pedido
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11 flex-1" disabled={busy} onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
          <Button className="min-h-11 flex-1" disabled={busy} onClick={() => void identified(`Mesa ${proposal.tableNumber}`, () => confirm.mutate())}>
            Confirmar
          </Button>
        </div>
      )}
    </article>
  )
}
