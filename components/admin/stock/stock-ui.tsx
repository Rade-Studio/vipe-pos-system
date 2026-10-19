"use client"

import { forwardRef, type SelectHTMLAttributes } from "react"
import { Badge } from "@/components/ui/badge"
import { expiryStatus, stockStatus } from "@/lib/inventory/stock"
import type { InventoryItem, ItemKind, MovementType } from "@/lib/supabase/inventory/types"
import { cn } from "@/lib/utils"

export const KIND_LABEL: Record<ItemKind, string> = { raw: "Materia prima", prep: "Preparación" }

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: "Saldo inicial",
  purchase: "Compra",
  sale: "Venta",
  production_consume: "Consumo producción",
  production_output: "Producción",
  adjustment: "Ajuste",
  waste: "Merma",
  transfer_out: "Traslado salida",
  transfer_in: "Traslado entrada",
  count_adjustment: "Ajuste por conteo",
}

export const MOVEMENT_TYPES = Object.keys(MOVEMENT_LABEL) as MovementType[]

export type StockStatus = ReturnType<typeof stockStatus>

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = { out: "Agotado", low: "Bajo", ok: "OK", over: "Exceso" }

export const itemStockStatus = (item: InventoryItem): StockStatus =>
  stockStatus({ stock: item.stock, min_stock: item.minStock, max_stock: item.maxStock, purchase_factor: item.purchaseFactor })

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const variant = status === "out" ? "destructive" : status === "low" ? "warning" : status === "over" ? "secondary" : "outline"
  return <Badge variant={variant}>{STOCK_STATUS_LABEL[status]}</Badge>
}

export function ExpiryBadge({ expiresOn, today = new Date() }: { expiresOn: string | null; today?: Date }) {
  const status = expiryStatus(expiresOn, today)
  if (status === "none") return <span className="text-muted-foreground">—</span>
  const label = status === "expired" ? "Vencido" : status === "soon" ? "Por vencer" : "Vigente"
  const variant = status === "expired" ? "destructive" : status === "soon" ? "warning" : "outline"
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">{expiresOn}</span>
      <Badge variant={variant}>{label}</Badge>
    </span>
  )
}

/** Signed quantity colored by direction. */
export function signedClass(value: number) {
  return value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-destructive" : "text-muted-foreground"
}

/** Native select styled like the shadcn input: dependable on mobile and in tests. */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
)
NativeSelect.displayName = "NativeSelect"

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}
