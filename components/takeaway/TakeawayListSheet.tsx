"use client"

import { useState } from "react"
import { ChevronRight, Plus, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatCurrency } from "@/utils/helpers"
import { takeawayLabel } from "@/lib/cashier/queue"
import type { Order } from "@/types"

const STATUS: Partial<Record<Order["status"], { label: string; tone: string }>> = {
  active: { label: "Abierto", tone: "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg" },
  kitchen: { label: "En cocina", tone: "border-status-warning-line bg-status-warning-bg text-status-warning-fg" },
  delivered: { label: "Entregado", tone: "border-status-free-line bg-status-free-bg text-status-free-fg" },
}

const countLabel = (count: number) => (count === 1 ? "1 pedido" : `${count} pedidos`)

/**
 * S3: the waiter's "Para llevar" button and sheet, mirroring the Carta inbox:
 * a badge with the open takeaway orders, a list to reopen one and the
 * "Nuevo pedido para llevar" action, so the orders stay off the floor.
 */
export function TakeawayListSheet({
  orders,
  onStart,
  onOpen,
}: {
  orders: Order[]
  onStart: () => void
  onOpen: (orderId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const count = orders.length

  return (
    <>
      <Button
        variant="outline"
        className="relative min-h-11 gap-2"
        aria-label={count > 0 ? `Para llevar (${countLabel(count)})` : "Para llevar"}
        onClick={() => setOpen(true)}
      >
        <ShoppingBag className="h-[18px] w-[18px]" aria-hidden />
        Para llevar
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
            <SheetTitle>Para llevar</SheetTitle>
            <SheetDescription>Pedidos para llevar abiertos. Toca uno para agregarle platos.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 p-4">
            <Button
              className="min-h-11 w-full gap-2"
              onClick={() => {
                setOpen(false)
                onStart()
              }}
            >
              <Plus className="h-[18px] w-[18px]" aria-hidden />
              Nuevo pedido para llevar
            </Button>
            {count === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No hay pedidos para llevar abiertos.</p>
            ) : (
              <section aria-label="Pedidos para llevar">
                <ul className="grid gap-2">
                  {orders.map((order) => {
                    const status = STATUS[order.status]
                    return (
                      <li key={order.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => {
                            setOpen(false)
                            onOpen(order.id)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{order.customerName || takeawayLabel(order)}</span>
                          <span
                            className={`inline-flex min-h-6 shrink-0 items-center rounded-full border px-2 text-xs font-semibold ${status?.tone ?? "border-border bg-muted text-muted-foreground"}`}
                          >
                            {status?.label ?? order.status}
                          </span>
                          <span className="shrink-0 tabular-nums">{formatCurrency(order.bill?.total ?? 0)}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
