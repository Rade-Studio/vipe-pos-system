"use client"

import { useContext, useEffect, useId, useState } from "react"
import { QueryClientContext, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { refreshActiveDeliveries } from "@/hooks/use-active-deliveries"
import { toast } from "@/hooks/use-toast"
import {
  confirmDeliveryRequest,
  deliveryRequestErrorMessage,
  getDeliveryRequests,
  rejectDeliveryRequest,
  type DeliveryInboxRequest,
  type DeliveryRequestConfirmed,
} from "@/lib/api/carta-delivery"
import { realtimeService } from "@/lib/api/realtime"
import { formatCop } from "@/lib/carta/format"
import { clockTime } from "@/lib/order-steps/details"

export const CARTA_DELIVERY_KEY = ["carta-delivery-inbox"] as const

/** Who sees the button; only admin and delivery_operator confirm (L29: cashier stays out of confirm). */
const VIEWERS = new Set(["admin", "delivery_operator", "cashier"])
const CONFIRMERS = new Set(["admin", "delivery_operator"])

const PAYMENT: Record<DeliveryInboxRequest["paymentMethod"], string> = { cash: "Efectivo", card: "Datáfono", transfer: "Transferencia" }

const phoneText = (phone: string) => (/^\d{10}$/.test(phone) ? `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}` : phone)

const paymentText = (r: DeliveryInboxRequest) =>
  r.paymentMethod === "cash" && r.cashFrom ? `${PAYMENT.cash} · paga con ${formatCop(r.cashFrom)}` : PAYMENT[r.paymentMethod]

function totalText(r: DeliveryInboxRequest): string {
  if (r.previewTotal === null) return "Total por confirmar: un plato ya no tiene precio"
  const parts = [...(r.previewTax ? [`impuesto ${formatCop(r.previewTax)}`] : []), `envío ${formatCop(r.deliveryFee)}`]
  return `Total ${formatCop(r.previewTotal)} (incluye ${parts.join(" y ")})`
}

/** Same wording as the console's own create (DeliveryOrderForm). */
function announceCreated(confirmed: DeliveryRequestConfirmed) {
  const shortages = confirmed.order.consumption.shortages
  if (shortages.length > 0) {
    const items = shortages.map((s) => `${s.name} (faltan ${s.missing}${s.unit ? ` ${s.unit}` : ""})`).join(", ")
    toast.warning(`El domicilio se creó y se envió a cocina, pero hay stock insuficiente: ${items}.`)
  } else {
    toast.success("Domicilio creado y enviado a cocina")
  }
}

/**
 * The delivery console's "Carta" button and sheet (T7, S15): guest delivery
 * orders from the carta, pending until the operator confirms (the order is
 * created, stock consumed and the kitchen command queued by the server) or
 * rejects them. Live through the staff realtime socket.
 */
export function CartaDeliveryInbox({ role }: { role?: string }) {
  // Role views also render in isolation (tests, previews) without a query client.
  const client = useContext(QueryClientContext)
  if (!client || !role || !VIEWERS.has(role)) return null
  return <InboxButton canConfirm={CONFIRMERS.has(role)} />
}

function InboxButton({ canConfirm }: { canConfirm: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: CARTA_DELIVERY_KEY, queryFn: getDeliveryRequests, retry: false })

  useEffect(() => {
    // The shared client may predate the carta stream (screens that mock it).
    const unsubscribe = realtimeService.subscribeToCartaInbox?.(() => {
      void queryClient.invalidateQueries({ queryKey: CARTA_DELIVERY_KEY })
    })
    return () => unsubscribe?.()
  }, [queryClient])

  const requests = data ?? []
  const count = requests.length

  return (
    <>
      <Button
        variant="outline"
        className="relative mb-2 min-h-11 gap-2"
        aria-label={count === 0 ? "Carta" : `Carta (${count} ${count === 1 ? "pendiente" : "pendientes"})`}
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
            <SheetTitle>Domicilios de la carta</SheetTitle>
            <SheetDescription>Pedidos que llegan desde la carta digital. Nada va a cocina hasta que lo confirmes.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-3 p-4">
            {count === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No hay domicilios de la carta por confirmar.</p>}
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} canConfirm={canConfirm} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function RequestCard({ request, canConfirm }: { request: DeliveryInboxRequest; canConfirm: boolean }) {
  const queryClient = useQueryClient()
  const titleId = useId()
  const reasonId = useId()
  const hintId = useId()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const refresh = () => queryClient.invalidateQueries({ queryKey: CARTA_DELIVERY_KEY })
  const confirm = useMutation({
    mutationFn: () => confirmDeliveryRequest(request.id),
    onSuccess: (confirmed) => {
      // What the console does after its own create: announce it and re-read the board.
      announceCreated(confirmed)
      refreshActiveDeliveries(queryClient)
      return refresh()
    },
  })
  const reject = useMutation({ mutationFn: () => rejectDeliveryRequest(request.id, reason), onSuccess: refresh })
  const busy = confirm.isPending || reject.isPending
  const error = confirm.isError
    ? deliveryRequestErrorMessage(confirm.error, "No se pudo confirmar el domicilio. Intenta de nuevo.")
    : reject.isError
      ? deliveryRequestErrorMessage(reject.error, "No se pudo rechazar el domicilio. Intenta de nuevo.")
      : null
  const renamed = request.registeredName !== null && request.registeredName.trim() !== request.customerName.trim()

  return (
    <article aria-labelledby={titleId} className="grid gap-3 rounded-lg border bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="font-semibold">
            {request.customerName}
          </h3>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">{phoneText(request.phone)}</span>
            {" · "}
            {clockTime(new Date(request.createdAt))}
          </p>
        </div>
        <span className="inline-flex min-h-6 items-center rounded-full border border-status-warning-line bg-status-warning-bg px-2 text-xs font-semibold text-status-warning-fg">
          Por confirmar
        </span>
      </header>
      {renamed && (
        <p className="rounded-md border border-status-warning-line bg-status-warning-bg p-2 text-sm text-status-warning-fg">
          {`Registrado como ${request.registeredName}; se mantiene ese nombre`}
        </p>
      )}
      <div className="grid gap-1 text-sm">
        <p>{[request.address, request.neighborhood].filter(Boolean).join(" · ")}</p>
        {request.notes && <p className="rounded-md bg-muted p-2">{request.notes}</p>}
        <p>{paymentText(request)}</p>
      </div>
      <ul className="grid gap-1.5 text-sm">
        {request.lines.map((line, index) => (
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
      <p className="text-sm font-semibold tabular-nums">{totalText(request)}</p>
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
            placeholder="Ej.: no llegamos a ese barrio"
            className="min-h-11 rounded-md border bg-background px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1" disabled={busy} onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="min-h-11 flex-1" disabled={busy} onClick={() => reject.mutate()}>
              Rechazar pedido
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1" disabled={busy} onClick={() => setRejecting(true)}>
              Rechazar
            </Button>
            <Button
              className="min-h-11 flex-1"
              disabled={busy || !canConfirm}
              aria-describedby={canConfirm ? undefined : hintId}
              onClick={() => confirm.mutate()}
            >
              Confirmar
            </Button>
          </div>
          {!canConfirm && (
            <p id={hintId} className="text-xs text-muted-foreground">
              Solo el administrador o el operador de domicilios confirman.
            </p>
          )}
        </>
      )}
    </article>
  )
}
