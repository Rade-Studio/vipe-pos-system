"use client"

import { Bike } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface DeliveryOrderBannerProps {
  /** Snapshot name from order_deliveries; null while the row loads. */
  customerName: string | null
}

/** Strip shown above a kitchen order card when the order is a delivery. */
export function DeliveryOrderBanner({ customerName }: DeliveryOrderBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-orange-300 bg-orange-50 px-3 py-2 dark:border-orange-700 dark:bg-orange-950/40">
      <Bike className="h-4 w-4 shrink-0 text-orange-600" />
      <Badge className="bg-orange-600 text-white hover:bg-orange-600">DOMICILIO</Badge>
      <span className="truncate text-sm font-semibold">{customerName ?? "Cargando cliente…"}</span>
    </div>
  )
}
