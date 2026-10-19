import { Badge } from "@/components/ui/badge"
import type { PaymentStatus, PurchaseOrderStatus } from "@/lib/supabase/inventory/types"

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

export const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "Pendiente", paid: "Pagado" }

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={status === "paid" ? "secondary" : "outline"}>{PAYMENT_LABEL[status]}</Badge>
}

export const canReceive = (status: PurchaseOrderStatus) => status === "ordered" || status === "partially_received"

export const poNumber = (n: number) => `OC-${String(n).padStart(4, "0")}`
