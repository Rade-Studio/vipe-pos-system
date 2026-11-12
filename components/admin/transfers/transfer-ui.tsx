import { Badge } from "@/components/ui/badge"
import type { InventoryItem, InventoryTransfer, TransferStatus } from "@/lib/api/inventory/types"

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  draft: "Borrador",
  in_transit: "En tránsito",
  received: "Recibida",
  received_short: "Recibida con faltante",
  cancelled: "Anulada",
}

export const TRANSFER_STATUSES = Object.keys(TRANSFER_STATUS_LABEL) as TransferStatus[]

const VARIANT = {
  draft: "outline",
  in_transit: "secondary",
  received: "default",
  received_short: "warning",
  cancelled: "destructive",
} as const

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <Badge variant={VARIANT[status]}>{TRANSFER_STATUS_LABEL[status]}</Badge>
}

export const trNumber = (n: number) => `TR-${String(n).padStart(4, "0")}`

/** Typed quantity with a decimal comma ("7,5"); NaN when empty or invalid. */
export function parseQuantity(text: string): number {
  const value = text.trim().replace(",", ".")
  return /^\d*\.?\d+$/.test(value) ? Number(value) : Number.NaN
}

export const quantityText = (value: number) => String(Math.round(value * 10_000) / 10_000).replace(".", ",")

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Sent value at the current item cost (the lot cost is not in the transfer read). */
export function transferValue(transfer: InventoryTransfer, costs: ReadonlyMap<string, InventoryItem>) {
  return transfer.lines.reduce((sum, line) => sum + line.requestedQuantity * (costs.get(line.itemId)?.cost ?? 0), 0)
}

const RANK: Record<TransferStatus, number> = { in_transit: 0, draft: 1, received_short: 2, received: 2, cancelled: 3 }

/** In transit first, then drafts, then the rest; newest first within each. */
export const sortTransfers = (transfers: readonly InventoryTransfer[]) =>
  [...transfers].sort((a, b) => RANK[a.status] - RANK[b.status] || b.number - a.number)

const WHEN = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })

/** Who moved the transfer last and when, as shown in the list. */
export function transferActor(t: InventoryTransfer): { who: string; when: string } {
  const [who, at] =
    t.status === "draft"
      ? [t.createdByName, t.createdAt]
      : t.status === "cancelled"
        ? [t.cancelledByName ?? t.sentByName, t.cancelledAt ?? t.createdAt]
        : [t.sentByName, t.sentAt ?? t.createdAt]
  return { who: who ?? "—", when: `${t.status === "draft" ? "Sin enviar · " : ""}${WHEN.format(new Date(at))}` }
}
