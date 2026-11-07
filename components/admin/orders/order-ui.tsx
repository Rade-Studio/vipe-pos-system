"use client"

import { useEffect, useState } from "react"
import { CircleCheck, Clock, ConciergeBell, CookingPot, X, type LucideIcon } from "lucide-react"
import { Chip, type ChipTone } from "@/components/cashier/cashier-ui"
import { ACTIVE_STATUS_INFO, type ActiveStatus } from "@/lib/admin/orders"
import type { OrderStatus } from "@/types"

const STATUS_ICON: Record<ActiveStatus, LucideIcon> = {
  active: Clock,
  kitchen: CookingPot,
  delivered: ConciergeBell,
}

const CLOSED_STATUS: Partial<Record<OrderStatus, { label: string; tone: ChipTone; icon: LucideIcon }>> = {
  paid: { label: "Pagada", tone: "ok", icon: CircleCheck },
  cancelled: { label: "Cancelada", tone: "danger", icon: X },
}

/** Order status in words + icon on its status tint (never colour alone). */
export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const active = ACTIVE_STATUS_INFO[status as ActiveStatus]
  const closed = CLOSED_STATUS[status]
  const label = active?.label ?? closed?.label ?? status
  const tone: ChipTone = active?.tone ?? closed?.tone ?? "reserved"
  const Icon = active ? STATUS_ICON[status as ActiveStatus] : (closed?.icon ?? Clock)
  return (
    <Chip tone={tone} className={className}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </Chip>
  )
}

/** "AF" from "Andrés Felipe Osorio". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("")
}

export const DOCKED_PANEL_FROM = 1280
export const TABLE_FROM = 768

/** The window width, followed on resize (the panel docks from 1280 px, the table starts at 768 px). */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? DOCKED_PANEL_FROM : window.innerWidth))
  useEffect(() => {
    const read = () => setWidth(window.innerWidth)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [])
  return width
}

/** "13:46" in the local time. */
export function clockTime(date: Date | string): string {
  const value = new Date(date)
  if (Number.isNaN(value.getTime())) return "—"
  return value.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false })
}
