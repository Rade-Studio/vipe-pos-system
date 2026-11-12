import { Badge } from "@/components/ui/badge"
import type { PaymentStatus, PurchaseOrder, PurchaseOrderStatus } from "@/lib/api/inventory/types"

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Borrador",
  ordered: "Enviada",
  partially_received: "Recibida parcial",
  received: "Recibida",
  cancelled: "Cancelada",
}

export const PO_STATUSES = Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[]

const PO_STATUS_VARIANT = {
  draft: "outline",
  ordered: "secondary",
  partially_received: "warning",
  received: "default",
  cancelled: "destructive",
} as const

export function PurchaseStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge variant={PO_STATUS_VARIANT[status]}>{PO_STATUS_LABEL[status]}</Badge>
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "Por pagar", paid: "Pagada" }

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={status === "paid" ? "secondary" : "warning"}>{PAYMENT_LABEL[status]}</Badge>
}

export const canReceive = (status: PurchaseOrderStatus) => status === "ordered" || status === "partially_received"

export const poNumber = (n: number) => `OC-${String(n).padStart(4, "0")}`

/** Estado chips of the order list; "open" (awaiting receipt) is the default. */
export type OrderFilter = "open" | "draft" | "all" | "received"

export const ORDER_FILTERS: { value: OrderFilter; label: string; match: (status: PurchaseOrderStatus) => boolean }[] = [
  { value: "open", label: "Por recibir", match: canReceive },
  { value: "draft", label: "Borradores", match: (s) => s === "draft" },
  { value: "all", label: "Todas", match: () => true },
  { value: "received", label: "Recibidas", match: (s) => s === "received" },
]

const RANK: Record<PurchaseOrderStatus, number> = { partially_received: 0, ordered: 1, draft: 2, received: 3, cancelled: 4 }

/** Awaiting receipt first (partial before sent), then drafts, received, cancelled; earliest expected date first. */
export const sortOrders = (orders: readonly PurchaseOrder[]) =>
  [...orders].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || (a.expectedOn ?? "9999").localeCompare(b.expectedOn ?? "9999") || a.number - b.number,
  )

/** Whole days an order awaiting receipt is past its expected date, or 0. */
export function lateDays(order: PurchaseOrder, today = new Date()) {
  if (!order.expectedOn || !canReceive(order.status)) return 0
  const [y, m, d] = order.expectedOn.slice(0, 10).split("-").map(Number)
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000)
  return Math.max(0, days)
}
