"use client"

import { useState } from "react"
import { AlertCircle, ArrowRight, Bike, Check, ShoppingBag, UtensilsCrossed } from "lucide-react"
import type { Order, OrderItemModifier } from "@/types"
import { cn } from "@/lib/utils"
import { isServedItem, pendingItems } from "@/lib/kitchen/order"
import { modifierLabel } from "@/lib/modifiers/rules"
import {
  formatElapsed,
  newItemIdsOf,
  sendIndexOf,
  ticketAge,
  ticketStartedAt,
  type KitchenThresholds,
  type TicketTone,
} from "@/lib/kitchen/ticket"

export interface KitchenTicketProps {
  order: Order
  /** "Mesa 7" or the delivery customer name. */
  place: string
  waiterName: string | null
  /** Delivery address; null for a table. */
  address: string | null
  /** Order-level comment: the order note (table) or the delivery notes. */
  note: string | null
  /** Clock shared by every ticket, so they all tick together. */
  now: number
  /** From the business `kitchenLateMinutes`. */
  thresholds: KitchenThresholds
  onServeItem: (itemId: string) => Promise<void> | void
  onServeAll: () => void
}

const HEAD_TONE: Record<TicketTone, string> = {
  ok: "",
  risk: "bg-status-kitchen-bg",
  late: "bg-status-danger-bg",
}
const BORDER_TONE: Record<TicketTone, string> = {
  ok: "border-line-strong",
  risk: "border-status-kitchen-line",
  late: "border-status-danger-line",
}
const AGE_TEXT: Record<TicketTone, string> = {
  ok: "text-fg",
  risk: "text-status-kitchen-fg",
  late: "text-status-danger-fg",
}

const chip =
  "inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold leading-none"

interface ItemGroup {
  key: string
  name: string
  comments?: string
  modifiers?: OrderItemModifier[]
  quantity: number
  ids: string[]
  served: boolean
}

// Identical lines (same name, options, comment, send and state) render as one row;
// its ✓ serves the first line, as the previous kitchen card did. Served lines
// stay, struck through as "Entregado" (T23). The send, not the exact
// millisecond, groups them: one send can straddle a millisecond.
function groupItems(order: Order): ItemGroup[] {
  const groups = new Map<string, ItemGroup>()
  const sendOf = sendIndexOf(order)
  for (const item of order.items) {
    const served = isServedItem(item)
    // F7: the sorted option ids, so two burgers with different options never merge.
    const options = (item.modifiers ?? []).map((modifier) => modifier.optionId).sort().join(",")
    const key = `${item.name}|${options}|${item.comments || ""}|${sendOf.get(item.id) ?? "?"}|${served}`
    const group = groups.get(key) ?? {
      key,
      name: item.name,
      comments: item.comments,
      modifiers: item.modifiers,
      quantity: 0,
      ids: [],
      served,
    }
    group.quantity += item.quantity
    group.ids.push(item.id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function KitchenTicket({
  order,
  place,
  waiterName,
  address,
  note,
  now,
  thresholds,
  onServeItem,
  onServeAll,
}: KitchenTicketProps) {
  const [busy, setBusy] = useState(false)
  const delivery = order.orderType === "delivery"
  const takeaway = order.orderType === "takeaway"
  const startedAt = ticketStartedAt(order)
  const elapsed = now - startedAt
  const age = ticketAge(elapsed, thresholds)
  const groups = groupItems(order)
  const pendingCount = pendingItems(order).length
  const newItemIds = newItemIdsOf(order)
  // "+n nuevos" counts the lines the cook sees (as the artboard), so it always
  // equals the number of "Nuevo" chips: same-dish rows of one batch are one line.
  const isNewGroup = (group: ItemGroup) => group.ids.some((id) => newItemIds.includes(id))
  const newCount = groups.filter(isNewGroup).length
  const guests = !delivery && order.guests ? `${order.guests} ${order.guests === 1 ? "persona" : "personas"}` : null
  const sentAt = new Date(startedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false })

  const serve = async (itemId: string) => {
    setBusy(true)
    try {
      await onServeItem(itemId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      aria-label={`${takeaway ? place : `${delivery ? "Domicilio" : "Mesa"} ${place.replace(/^Mesa /, "")}`}, ${age.minutes} minutos, ${age.label}`}
      data-tone={age.tone}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-card-lg border-[1.5px] bg-surface text-fg dark:backdrop-blur-xl",
        BORDER_TONE[age.tone],
        age.tone === "late" && "shadow-[0_0_36px_-10px_var(--status-danger-line)]",
        newCount > 0 && "border-brand-line shadow-glow",
      )}
    >
      <div className={cn("border-b border-line px-4 pb-3 pt-3.5", HEAD_TONE[age.tone])}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-wrap gap-1.5">
            {delivery ? (
              <span className={cn(chip, "border-status-served-line bg-status-served-bg text-status-served-fg")}>
                <Bike className="h-3.5 w-3.5" aria-hidden="true" />
                Domicilio
              </span>
            ) : takeaway ? (
              <span className={cn(chip, "border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg")}>
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                Para llevar
              </span>
            ) : (
              <span className={cn(chip, "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg")}>
                <UtensilsCrossed className="h-3.5 w-3.5" aria-hidden="true" />
                Mesa
              </span>
            )}
            {newCount > 0 && (
              <span className={cn(chip, "border-brand-line bg-brand-tint text-brand-strong")}>+{newCount} nuevos</span>
            )}
          </span>
          <span className={cn("ml-auto flex flex-none flex-col items-end", AGE_TEXT[age.tone])}>
            <span className="font-mono text-[26px] font-bold leading-none tabular-nums xl:text-[28px]" role="timer">
              {formatElapsed(elapsed)}
            </span>
            <span className="mt-1 whitespace-nowrap text-xs font-semibold uppercase tracking-wider">{age.label}</span>
          </span>
        </div>
        <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] xl:text-[30px]">
          {place}
        </h2>
        <p className="mt-1.5 text-sm leading-snug text-muted-fg [overflow-wrap:anywhere]">
          Orden #{order.orderNumber ?? order.id.slice(0, 8)}
          {delivery ? (
            address && <> · {address}</>
          ) : (
            <>
              {" "}
              · Mesero <b className="font-medium text-fg-2">{waiterName ?? "no asignado"}</b>
              {guests && (
                <>
                  {" "}
                  · <span className="whitespace-nowrap">{guests}</span>
                </>
              )}
            </>
          )}{" "}
          · {sentAt}
        </p>
      </div>

      {note && (
        <p className="mx-3 mt-2.5 flex gap-2 rounded-card border border-status-warning-line bg-status-warning-bg px-3 py-2.5 text-[15px] leading-snug text-status-warning-fg">
          <AlertCircle className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <b>Comentario:</b> {note}
          </span>
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
        {groups.map((group) => {
          const isNew = isNewGroup(group)
          return (
            <li
              key={group.key}
              data-line
              className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 border-line py-3 [&+&]:border-t"
            >
              <span
                className={cn(
                  "whitespace-nowrap text-center font-mono text-[22px] font-bold tabular-nums",
                  group.served ? "text-muted-fg" : "text-brand-strong",
                )}
              >
                {group.quantity}
                <span className="ml-px text-sm text-muted-fg">×</span>
              </span>
              <span className="min-w-0 text-[19px] font-medium leading-tight [overflow-wrap:anywhere] xl:text-xl">
                <span className={cn(group.served && "text-muted-fg line-through")}>{group.name}</span>
                {isNew && (
                  <span
                    className={cn(
                      chip,
                      "ml-1.5 h-[22px] px-2 align-[2px] text-[11.5px] border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg",
                    )}
                  >
                    Nuevo
                  </span>
                )}
                {group.modifiers?.length ? (
                  // No prices in the kitchen (S6): only what to cook.
                  <span role="list" aria-label="Opciones" className="mt-1 grid gap-0.5 text-[15px] font-medium text-fg-2">
                    {group.modifiers.map((modifier) => (
                      <span role="listitem" key={modifier.optionId}>
                        {modifierLabel(modifier)}
                      </span>
                    ))}
                  </span>
                ) : null}
                {group.comments && (
                  <span className="mt-1 block text-[15px] font-medium text-status-kitchen-fg">{group.comments}</span>
                )}
              </span>
              {group.served ? (
                <span className={cn(chip, "border-status-ok-line bg-status-ok-bg text-status-ok-fg")}>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />
                  Entregado
                </span>
              ) : (
              <button
                type="button"
                aria-label={`Entregar ${group.quantity} ${group.name}`}
                disabled={busy}
                onClick={() => serve(group.ids[0])}
                className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full border-[1.5px] border-status-ok-line bg-status-ok-bg text-status-ok-fg hover:brightness-110 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus disabled:opacity-50"
              >
                <Check className="h-6 w-6" strokeWidth={2.6} aria-hidden="true" />
              </button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex gap-2 border-t border-line p-3">
        <button
          type="button"
          onClick={onServeAll}
          disabled={busy}
          className="group inline-flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-btn px-4 text-[17px] font-semibold text-btn-foreground shadow-glow transition-transform duration-300 hover:scale-[1.02] focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          <span className="truncate">{delivery ? "Listo para domicilio" : "Entregar toda"}</span>{" "}
          <span className="tabular-nums">({pendingCount})</span>
          <ArrowRight
            className="h-5 w-5 flex-none transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            aria-hidden="true"
          />
        </button>
      </div>
    </article>
  )
}
