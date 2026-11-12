"use client"

import { Check, List, Minus, Pencil, Plus, Trash2 } from "lucide-react"

import type { CartItem } from "@/types"
import { cn } from "@/lib/utils"
import { sentGroups } from "@/lib/order-steps/details"
import { formatCurrency } from "@/utils/helpers"
import { Button } from "@/components/ui/button"
import { ModifierLines } from "@/components/modifiers/ModifierLines"
import { DiscountRows, SavingsRow, type OrderPricing } from "@/components/promotions/OrderPromotions"
import { isComboLine } from "@/lib/promotions/waiter"

const FOCUS = "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

export const lineCount = (lines: readonly CartItem[]) => lines.reduce((sum, line) => sum + line.quantity, 0)
export const lineTotal = (lines: readonly CartItem[]) => lines.reduce((sum, line) => sum + line.quantity * line.price, 0)

function NewChip() {
  return (
    <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full border border-brand-line bg-brand-tint px-3 text-[13px] font-medium text-brand-strong">
      Nuevo · sin enviar
    </span>
  )
}

/** A line already in the kitchen; `addedAt` is its send time (order_items.added_at). */
export type SentLine = CartItem & { addedAt?: Date }

/** "Enviado a cocina · 19:48" (T22); without a send time, no time. */
function SentChip({ time }: { time: string | null }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-status-ok-line bg-status-ok-bg px-3 text-[13px] font-medium text-status-ok-fg">
      <Check className="h-3 w-3" aria-hidden />
      Enviado a cocina{time ? <span className="tabular-nums"> · {time}</span> : null}
    </span>
  )
}

const NOTE_MAX = 300

/** S12: the dishes chosen in a combo line ("Ajiaco · Bandeja · Jugo de mora"). */
function ComboChoices({ line, className }: { line: CartItem; className?: string }) {
  if (!isComboLine(line)) return null
  return <small className={cn("col-start-1 block text-[12.5px] text-muted-fg", className)}>{line.combo.choices.map((choice) => choice.name).join(" · ")}</small>
}

interface OrderReviewProps {
  title: string
  /** The open order's database number ("#128", T22). */
  orderNumber?: number
  /** Lines not sent yet: quantity and removal are editable. */
  newLines: readonly CartItem[]
  /** Lines already in the kitchen: read only, grouped by send time. */
  sentLines: readonly SentLine[]
  onChangeQuantity: (lineId: string, change: number) => void
  onRemove: (lineId: string) => void
  /** F7: "Cambiar opciones" of a new line with options reopens the modifier sheet. */
  onEditOptions?: (lineId: string) => void
  onContinue: () => void
  /** "Nota del pedido" (orders.notes, T22): optional when `onNoteChange` is given. */
  note?: string
  onNoteChange?: (note: string) => void
  /** Open order: save the note now (PATCH); a new order sends it with the order. */
  onSaveNote?: () => void
  /** The note differs from the stored one. */
  noteDirty?: boolean
  savingNote?: boolean
  /** S11: the promotions' discounts, savings and nudges. */
  pricing?: OrderPricing
}

/** "Ver pedido" of the step flow: what is new (editable) and what the kitchen already has. */
export function OrderReview({
  title,
  orderNumber,
  newLines,
  sentLines,
  onChangeQuantity,
  onRemove,
  onEditOptions,
  onContinue,
  note,
  onNoteChange,
  onSaveNote,
  noteDirty = false,
  savingNote = false,
  pricing,
}: OrderReviewProps) {
  const all = [...sentLines, ...newLines]
  return (
    <div className="grid max-w-[760px] gap-3.5">
      <div className="mx-0.5 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 tabIndex={-1} className="min-w-0 text-[22px] font-semibold leading-tight outline-none xl:text-[26px]">
            {title}
          </h2>
          {orderNumber != null && (
            <span className="inline-flex h-7 flex-none items-center whitespace-nowrap rounded-pill border border-line bg-surface-2 px-3 text-[13px] font-semibold tabular-nums text-fg-2">
              #{orderNumber}
            </span>
          )}
        </span>
        <p className="text-sm tabular-nums text-muted-fg">{lineCount(all)} productos</p>
      </div>

      <section aria-label="Nuevos">
        <h3 className="mb-2">
          <NewChip />
        </h3>
        {newLines.length === 0 ? (
          <p className="text-sm text-fg-2">No hay productos nuevos. Toca “Seguir agregando”.</p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {newLines.map((line) => (
              <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-t border-line px-3.5 py-3 first:border-t-0">
                <span className="min-w-0 text-[15.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{line.name}</span>
                <span className="text-right font-semibold tabular-nums">{formatCurrency(line.quantity * line.price)}</span>
                <ModifierLines modifiers={line.modifiers} unitPrice={line.price} />
                <ComboChoices line={line} />
                {line.comments && <span className="col-start-1 text-[13px] text-muted-fg">“{line.comments}”</span>}
                <DiscountRows rows={pricing?.newDiscounts(line.id) ?? []} />
                <span className="col-span-full flex flex-wrap items-center gap-2">
                  {!isComboLine(line) && (
                  <span role="group" aria-label={`Cantidad de ${line.name}`} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Quitar uno a ${line.name}`}
                      disabled={line.quantity <= 1}
                      onClick={() => onChangeQuantity(line.id, -1)}
                      className={cn("grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-card disabled:cursor-not-allowed disabled:text-muted-fg", FOCUS)}
                    >
                      <Minus className="h-[18px] w-[18px]" aria-hidden />
                    </button>
                    <output className="min-w-8 text-center text-lg font-semibold tabular-nums">{line.quantity}</output>
                    <button
                      type="button"
                      aria-label={`Sumar uno a ${line.name}`}
                      onClick={() => onChangeQuantity(line.id, 1)}
                      className={cn("grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-card", FOCUS)}
                    >
                      <Plus className="h-[18px] w-[18px]" aria-hidden />
                    </button>
                  </span>
                  )}
                  {onEditOptions && (line.modifiers?.length ?? 0) > 0 && (
                    <Button variant="outline" aria-label={`Cambiar opciones de ${line.name}`} onClick={() => onEditOptions(line.id)} className="h-11">
                      <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                      Cambiar opciones
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    aria-label={`Quitar ${line.name}`}
                    onClick={() => onRemove(line.id)}
                    className="h-11 text-status-danger-fg hover:bg-status-danger-bg hover:text-status-danger-fg"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                    Quitar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sentLines.length > 0 && (
        <section aria-label="Enviados" className="grid gap-3">
          {sentGroups(sentLines).map((group) => (
            <div key={group.time ?? "none"}>
              <h3 className="mb-2">
                <SentChip time={group.time} />
              </h3>
              <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
                {group.lines.map((line) => (
                  <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-line px-3.5 py-3 first:border-t-0">
                    <span className="min-w-0 font-medium text-fg-2 [overflow-wrap:anywhere]">
                      {line.quantity}× {line.name}
                    </span>
                    <span className="text-right font-semibold tabular-nums">{formatCurrency(line.quantity * line.price)}</span>
                    <ModifierLines modifiers={line.modifiers} />
                    {line.comments && <span className="col-start-1 text-[13px] text-muted-fg">“{line.comments}”</span>}
                    <DiscountRows rows={pricing?.sentDiscounts(line.id) ?? []} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {onNoteChange && (
        <div>
          <label htmlFor="order-note" className="mb-2 block text-[13px] font-semibold uppercase tracking-wider text-fg-2">
            Nota del pedido (opcional)
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <textarea
              id="order-note"
              rows={2}
              value={note ?? ""}
              maxLength={NOTE_MAX}
              placeholder="Ej.: cumpleaños, alérgico al maní"
              onChange={(event) => onNoteChange(event.target.value)}
              className={cn(
                "min-h-[52px] min-w-0 flex-[1_1_16rem] resize-y rounded-[14px] border border-line-strong bg-card px-3.5 py-3 text-[15px] text-fg placeholder:text-muted-fg",
                FOCUS,
              )}
            />
            {onSaveNote && (
              <Button variant="outline" className="h-[52px] flex-none rounded-[14px]" disabled={!noteDirty || savingNote} onClick={onSaveNote}>
                Guardar nota
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-muted-fg">
            {onSaveNote ? "Cocina la ve en el pedido. Se envía también con los productos nuevos." : "Se envía a cocina con el pedido."}
          </p>
        </div>
      )}

      {pricing?.notices}

      <div className="grid gap-1.5 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-fg-2">Total de la mesa</span>
          <b className="text-xl tabular-nums">{formatCurrency(pricing?.total ?? lineTotal(all))}</b>
        </div>
        <SavingsRow savings={pricing?.savings ?? 0} />
      </div>
      <Button variant="outline" className="h-14 rounded-[18px] text-base" onClick={onContinue}>
        <Plus className="mr-1.5 h-5 w-5" aria-hidden />
        Seguir agregando
      </Button>
    </div>
  )
}

interface OrderColumnProps {
  title: string
  newLines: readonly CartItem[]
  sentLines: readonly SentLine[]
  onReview: () => void
  pricing?: OrderPricing
}

/** The order so far, beside the steps from 1024 px. */
export function OrderColumn({ title, newLines, sentLines, onReview, pricing }: OrderColumnProps) {
  const all = [...sentLines, ...newLines]
  const row = (line: CartItem, sent: boolean) => (
    <li key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-sm">
      <span className="tabular-nums text-muted-fg">{line.quantity}×</span>
      <span className={cn("min-w-0 [overflow-wrap:anywhere]", sent ? "text-fg-2" : "font-medium")}>
        {line.name}
        <ModifierLines modifiers={line.modifiers} className="mt-0.5 text-xs" />
        <ComboChoices line={line} className="text-xs" />
        {line.comments && <small className="block text-xs text-muted-fg">“{line.comments}”</small>}
      </span>
      <span className="tabular-nums">{formatCurrency(line.quantity * line.price)}</span>
      <DiscountRows rows={(sent ? pricing?.sentDiscounts(line.id) : pricing?.newDiscounts(line.id)) ?? []} />
    </li>
  )
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-[13.5px] tabular-nums text-muted-fg">{lineCount(all)} productos</span>
      </div>
      <div className="grid flex-1 content-start gap-2.5">
        <div>
          <p className="mb-1">
            <NewChip />
          </p>
          {newLines.length === 0 ? (
            <p className="text-sm text-fg-2">Aún no agregas productos nuevos.</p>
          ) : (
            <ul>{newLines.map((line) => row(line, false))}</ul>
          )}
        </div>
        {sentGroups(sentLines).map((group) => (
          <div key={group.time ?? "none"}>
            <p className="mb-1">
              <SentChip time={group.time} />
            </p>
            <ul>{group.lines.map((line) => row(line, true))}</ul>
          </div>
        ))}
      </div>
      {pricing?.notices}
      <div className="grid gap-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-fg-2">Total</span>
          <b className="text-lg tabular-nums">{formatCurrency(pricing?.total ?? lineTotal(all))}</b>
        </div>
        <SavingsRow savings={pricing?.savings ?? 0} />
        <Button variant="outline" className="h-12" onClick={onReview}>
          <List className="mr-1.5 h-[18px] w-[18px]" aria-hidden />
          Ver y editar pedido
        </Button>
      </div>
    </>
  )
}
