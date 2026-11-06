"use client"

import type { ReactNode } from "react"
import { LockIcon, Plus, ShoppingCart, UnlockIcon } from "lucide-react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { seatsText } from "@/lib/floor/layout"
import { Button } from "@/components/ui/button"
import { StatusChip } from "./StatusChip"
import { toneClasses } from "./tones"

interface TablePanelProps {
  table: Table | null
  waiterName?: string
  zoneName?: string
  onAddItems: () => void
  onReserve: (tableId: string) => void
  onRelease: (tableId: string) => void
  /** Phone: open the order (cart) sheet; it shows the current number of lines. */
  onShowOrder?: () => void
  orderCount?: number
  className?: string
  children?: ReactNode
}

/** The API refuses to release these (409 `Table cannot be released while <status>`). */
const LOCKED = new Set(["kitchen", "served"])

/**
 * The selected table: who has it, its chairs and the floor actions of the
 * waiter flow (add products, reserve, free). The order itself (cart, send to
 * the kitchen) is the existing CartSidebar, rendered by the view.
 */
export function TablePanel({
  table,
  waiterName,
  zoneName,
  onAddItems,
  onReserve,
  onRelease,
  onShowOrder,
  orderCount = 0,
  className,
  children,
}: TablePanelProps) {
  if (!table) {
    return (
      <section aria-label="Mesa" className={cn("px-4 py-5", className)}>
        <h2 className="mb-1 text-base font-semibold text-fg">Ninguna mesa seleccionada</h2>
        <p className="text-sm text-fg-2">Toca una mesa para ver su pedido.</p>
      </section>
    )
  }

  const tone = toneClasses(table.status)
  const reserved = table.status === "reserved"
  const canRelease = !LOCKED.has(table.status)
  const details = [waiterName, seatsText(table.seats), zoneName].filter(Boolean).join(" · ")

  return (
    <section aria-label={`Mesa ${table.number}`} className={cn("flex flex-col gap-3 px-4 py-3", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "grid h-12 w-12 place-items-center border-[1.5px] text-lg font-semibold tabular-nums",
            table.shape === "round" ? "rounded-full" : "rounded-[14px]",
            tone.fill,
          )}
          style={{ boxShadow: "0 4px 0 -1px rgba(9,9,11,.18)" }}
        >
          {table.number}
        </span>
        <div className="min-w-0">
          <StatusChip status={table.status} />
          <p className="mt-1 truncate text-sm text-muted-fg">{details}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button className="col-span-2 h-11" onClick={onAddItems}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Agregar productos
        </Button>
        {onShowOrder && (
          <Button variant="outline" className="col-span-2 h-11" onClick={onShowOrder}>
            <ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden />
            Ver pedido{orderCount > 0 ? ` (${orderCount})` : ""}
          </Button>
        )}
        {!reserved && (
          <Button variant="outline" className="h-11" onClick={() => onReserve(table.id)}>
            <LockIcon className="mr-1.5 h-4 w-4" aria-hidden />
            Reservar
          </Button>
        )}
        {(reserved || canRelease) && (
          <Button
            variant="outline"
            className={cn("h-11", reserved && "col-span-2")}
            onClick={() => onRelease(table.id)}
          >
            <UnlockIcon className="mr-1.5 h-4 w-4" aria-hidden />
            Liberar mesa
          </Button>
        )}
        {!canRelease && (
          <p className="text-xs leading-snug text-muted-fg">No se puede liberar en cocina o servida.</p>
        )}
      </div>
      {children}
    </section>
  )
}
