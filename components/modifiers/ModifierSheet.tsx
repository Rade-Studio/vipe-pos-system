"use client"

import { useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AlertCircle, Check, Minus, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { STEP_SHEET_CLASS } from "@/components/voids/sheet"
import { useToast } from "@/hooks/use-toast"
import type { DishModifierGroupDto } from "@/lib/api/catalog"
import {
  blockReason,
  chosenModifiers,
  missingGroups,
  modifiersExtra,
  priceSummary,
  toggleOption,
  type LineModifier,
  type ModifierSelection,
} from "@/lib/modifiers/rules"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { ModifierGroupField } from "./ModifierGroupField"

export interface ModifierSheetDish {
  id: string
  name: string
  /** The dish unit price the line starts from (after promotion on table orders). */
  price: number
  modifierGroups: DishModifierGroupDto[]
}

export interface ModifierSheetResult {
  modifiers: LineModifier[]
  quantity: number
  /** Trimmed; empty when none. */
  note: string
  /** Dish price + options. */
  unitPrice: number
}

export interface ModifierSheetProps {
  /** null keeps the sheet closed. */
  dish: ModifierSheetDish | null
  /** "Platos fuertes · Hamburguesas". */
  context?: string
  /** A cart line being edited ("Cambiar opciones"): its options, quantity and note. */
  initial?: { selection: ModifierSelection; quantity: number; note: string }
  onClose: () => void
  onSubmit: (result: ModifierSheetResult) => void
}

/**
 * The modifier sheet of step 4 and the delivery form (F7 T3, S1, S3): the
 * dish's groups in order, a live line price and "Agregar" blocked with the
 * reason until every rule holds. The step sheet of voids / PIN / reserve.
 */
export function ModifierSheet({ dish, ...rest }: ModifierSheetProps) {
  return (
    <DialogPrimitive.Root open={dish !== null} onOpenChange={(next) => !next && rest.onClose()}>
      {dish && (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <SheetBody key={dish.id} dish={dish} {...rest} />
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  )
}

function SheetBody({ dish, context, initial, onSubmit }: Omit<ModifierSheetProps, "dish"> & { dish: ModifierSheetDish }) {
  const { toast } = useToast()
  const [selection, setSelection] = useState<ModifierSelection>(initial?.selection ?? {})
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1)
  const [note, setNote] = useState(initial?.note ?? "")
  const groups = dish.modifierGroups
  const modifiers = chosenModifiers(groups, selection)
  const extra = modifiersExtra(modifiers)
  const unitPrice = dish.price + extra
  const missing = missingGroups(groups, selection)
  const why = blockReason(missing)
  const editing = initial !== undefined

  const toggle = (group: DishModifierGroupDto, optionId: string) => {
    const result = toggleOption(group, selection, optionId)
    if (result.refused) toast({ title: `Máximo ${group.maxSelect} en ${group.name}` })
    else setSelection(result.selection)
  }

  return (
    <DialogPrimitive.Content aria-describedby={undefined} className={cn(STEP_SHEET_CLASS, "md:w-[min(640px,calc(100vw-2rem))]")}>
      <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title asChild>
            <h2 className="text-xl font-bold leading-tight text-fg [overflow-wrap:anywhere]">{dish.name}</h2>
          </DialogPrimitive.Title>
          <p className="mt-1 text-sm tabular-nums text-fg-2">
            {formatCurrency(dish.price)} c/u{context ? ` · ${context}` : ""}
          </p>
        </div>
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11 flex-none" aria-label="Cerrar sin agregar">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
        {groups.map((group) => (
          <ModifierGroupField
            key={group.id}
            group={group}
            selection={selection}
            missing={missing.includes(group)}
            onToggle={(optionId) => toggle(group, optionId)}
          />
        ))}
        <div>
          <label htmlFor="modifier-note" className="mb-2 block text-sm font-semibold text-fg-2">
            Nota para cocina (opcional)
          </label>
          <input
            id="modifier-note"
            type="text"
            value={note}
            maxLength={200}
            placeholder="Ej.: alérgico al maní"
            onChange={(event) => setNote(event.target.value)}
            className="min-h-12 w-full rounded-[14px] border border-line-strong bg-card px-3.5 py-3 text-[15px] text-fg placeholder:text-muted-fg focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
        </div>
      </div>

      <footer className="grid gap-2 border-t border-line bg-card px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:px-5">
        <p aria-live="polite" className="text-sm tabular-nums text-fg-2 [overflow-wrap:anywhere]">
          {priceSummary(dish.name, dish.price, extra)}
        </p>
        {why && (
          <p id="modifier-why" className="flex items-start gap-1.5 text-sm font-medium text-status-warning-fg">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{why}</span>
          </p>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <div role="group" aria-label="Cantidad" className="flex flex-none items-center rounded-[14px] border border-line-strong bg-surface">
            <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Quitar uno" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              <Minus className="h-5 w-5" aria-hidden />
            </Button>
            <output aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</output>
            <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Sumar uno" onClick={() => setQuantity((q) => q + 1)}>
              <Plus className="h-5 w-5" aria-hidden />
            </Button>
          </div>
          <Button
            className="h-12 min-w-0 flex-1 rounded-[14px] text-base"
            disabled={why !== null}
            aria-describedby={why ? "modifier-why" : undefined}
            onClick={() => onSubmit({ modifiers, quantity, note: note.trim(), unitPrice })}
          >
            {editing ? <Check className="mr-1.5 h-5 w-5" aria-hidden /> : <Plus className="mr-1.5 h-5 w-5" aria-hidden />}
            <span className="truncate">
              {editing ? "Guardar" : "Agregar"} · <span className="tabular-nums">{formatCurrency(unitPrice * quantity)}</span>
            </span>
          </Button>
        </div>
      </footer>
    </DialogPrimitive.Content>
  )
}
