"use client"

import { Check, List, Minus, Plus, Trash2 } from "lucide-react"

import type { CartItem } from "@/types"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { Button } from "@/components/ui/button"

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

function SentChip() {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-status-ok-line bg-status-ok-bg px-3 text-[13px] font-medium text-status-ok-fg">
      <Check className="h-3 w-3" aria-hidden />
      Enviado a cocina
    </span>
  )
}

interface OrderReviewProps {
  title: string
  /** Lines not sent yet: quantity and removal are editable. */
  newLines: readonly CartItem[]
  /** Lines already in the kitchen: read only. */
  sentLines: readonly CartItem[]
  onChangeQuantity: (lineId: string, change: number) => void
  onRemove: (lineId: string) => void
  onContinue: () => void
}

/** "Ver pedido" of the step flow: what is new (editable) and what the kitchen already has. */
export function OrderReview({ title, newLines, sentLines, onChangeQuantity, onRemove, onContinue }: OrderReviewProps) {
  const all = [...sentLines, ...newLines]
  return (
    <div className="grid max-w-[760px] gap-3.5">
      <div className="mx-0.5 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 tabIndex={-1} className="text-[22px] font-semibold leading-tight outline-none xl:text-[26px]">
          {title}
        </h2>
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
                {line.comments && <span className="col-start-1 text-[13px] text-muted-fg">“{line.comments}”</span>}
                <span className="col-span-full flex flex-wrap items-center gap-2">
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
        <section aria-label="Enviados">
          <h3 className="mb-2">
            <SentChip />
          </h3>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {sentLines.map((line) => (
              <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-line px-3.5 py-3 first:border-t-0">
                <span className="min-w-0 font-medium text-fg-2 [overflow-wrap:anywhere]">
                  {line.quantity}× {line.name}
                </span>
                <span className="text-right font-semibold tabular-nums">{formatCurrency(line.quantity * line.price)}</span>
                {line.comments && <span className="col-start-1 text-[13px] text-muted-fg">“{line.comments}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-baseline justify-between gap-2 border-t border-line pt-3">
        <span className="text-fg-2">Total de la mesa</span>
        <b className="text-xl tabular-nums">{formatCurrency(lineTotal(all))}</b>
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
  sentLines: readonly CartItem[]
  onReview: () => void
}

/** The order so far, beside the steps from 1024 px. */
export function OrderColumn({ title, newLines, sentLines, onReview }: OrderColumnProps) {
  const all = [...sentLines, ...newLines]
  const row = (line: CartItem, sent: boolean) => (
    <li key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-sm">
      <span className="tabular-nums text-muted-fg">{line.quantity}×</span>
      <span className={cn("min-w-0 [overflow-wrap:anywhere]", sent ? "text-fg-2" : "font-medium")}>
        {line.name}
        {line.comments && <small className="block text-xs text-muted-fg">“{line.comments}”</small>}
      </span>
      <span className="tabular-nums">{formatCurrency(line.quantity * line.price)}</span>
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
        {sentLines.length > 0 && (
          <div>
            <p className="mb-1">
              <SentChip />
            </p>
            <ul>{sentLines.map((line) => row(line, true))}</ul>
          </div>
        )}
      </div>
      <div className="grid gap-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-fg-2">Total</span>
          <b className="text-lg tabular-nums">{formatCurrency(lineTotal(all))}</b>
        </div>
        <Button variant="outline" className="h-12" onClick={onReview}>
          <List className="mr-1.5 h-[18px] w-[18px]" aria-hidden />
          Ver y editar pedido
        </Button>
      </div>
    </>
  )
}
