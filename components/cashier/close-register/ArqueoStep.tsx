"use client"

import { Minus, Plus } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Chip, Money, focusRing } from "@/components/cashier/cashier-ui"
import {
  BILL_VALUES,
  CLOSE_NOTE_MAX,
  COIN_VALUES,
  closeNoteValid,
  denominationSubtotal,
  differenceStatus,
  type DenominationCounts,
  type DenominationValue,
} from "@/lib/payments/denominations"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { differenceText, pesos } from "@/components/printing/slip-format"

const stepper = cn(
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg hover:bg-surface-2 disabled:opacity-40",
  focusRing,
)

function DenominationRowView({
  value,
  quantity,
  onChange,
}: {
  value: DenominationValue
  quantity: number | undefined
  onChange: (quantity: number) => void
}) {
  const bill = value >= 2000
  const face = pesos(value)
  const count = quantity ?? 0
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="w-20 shrink-0 font-semibold tabular-nums">{face}</span>
      <button
        type="button"
        className={stepper}
        aria-label={`Restar ${bill ? "un billete" : "una moneda"} de ${face}`}
        disabled={count === 0}
        onClick={() => onChange(Math.max(0, count - 1))}
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </button>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        aria-label={`${bill ? "Billetes" : "Monedas"} de ${face}`}
        className="h-11 w-20 text-center tabular-nums"
        value={quantity === undefined ? "" : quantity}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(Number.isInteger(next) && next >= 0 ? next : 0)
        }}
      />
      <button
        type="button"
        className={stepper}
        aria-label={`Sumar ${bill ? "un billete" : "una moneda"} de ${face}`}
        onClick={() => onChange(count + 1)}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      <span data-testid={`subtotal-${value}`} className="ml-auto">
        <Money className={cn("text-sm", count ? "font-semibold" : "text-muted-fg")}>
          {count ? `= ${pesos(denominationSubtotal(value, count))}` : "Sin contar"}
        </Money>
      </span>
    </li>
  )
}

/**
 * Step 3 (caja-cierres S3): the arqueo by denomination (or one total in quick
 * mode) next to the cuadre card; a difference asks for the note.
 */
export function ArqueoStep({
  summary,
  counts,
  onCountsChange,
  quick,
  onQuickChange,
  quickInput,
  onQuickInputChange,
  counted,
  note,
  onNoteChange,
}: {
  summary: RegisterSummary | undefined
  counts: DenominationCounts
  onCountsChange: (counts: DenominationCounts) => void
  quick: boolean
  onQuickChange: (quick: boolean) => void
  quickInput: string
  onQuickInputChange: (value: string) => void
  /** Null while the quick amount is blank or invalid. */
  counted: number | null
  note: string
  onNoteChange: (note: string) => void
}) {
  const expected = summary?.expectedCashAfterTips ?? 0
  const difference = counted === null ? 0 : counted - expected
  const status = differenceStatus(difference)
  const noteOk = closeNoteValid(note, difference)
  const group = (title: string, values: readonly DenominationValue[]) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{title}</p>
      <ul className="divide-y divide-line">
        {values.map((value) => (
          <DenominationRowView
            key={value}
            value={value}
            quantity={counts[value]}
            onChange={(quantity) => onCountsChange({ ...counts, [value]: quantity })}
          />
        ))}
      </ul>
    </div>
  )

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
      <div className="space-y-3">
        <p className="text-sm text-muted-fg">Cuenta todo el efectivo del cajón, incluido el fondo.</p>
        <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
          <Switch checked={quick} onCheckedChange={onQuickChange} aria-label="Arqueo rápido: solo total" />
          Arqueo rápido: solo total
        </label>
        {quick ? (
          <div className="space-y-1">
            <Label htmlFor="quickCounted">Total contado en efectivo</Label>
            <Input
              id="quickCounted"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={quickInput}
              onChange={(event) => onQuickInputChange(event.target.value)}
              className="h-11 tabular-nums"
            />
            <p className="text-xs text-muted-fg">Un solo total, sin denominaciones. Menos trazable.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {group("Billetes", BILL_VALUES)}
            {group("Monedas", COIN_VALUES)}
          </div>
        )}
      </div>

      <section aria-label="Cuadre" className="h-fit space-y-2 rounded-xl border border-line bg-surface p-3 text-sm md:sticky md:top-0">
        <h4 className="font-semibold">Cuadre</h4>
        <div className="flex justify-between gap-2 font-medium">
          <span>Esperado</span>
          <Money>{pesos(expected)}</Money>
        </div>
        {summary && (
          <div className="space-y-0.5 text-xs text-muted-fg">
            <div className="flex justify-between gap-2"><span>Fondo</span><Money>{pesos(summary.initialCash)}</Money></div>
            <div className="flex justify-between gap-2"><span>Entradas</span><Money>{pesos(summary.cashDeposits)}</Money></div>
            <div className="flex justify-between gap-2"><span>Salidas</span><Money>{pesos(-summary.cashWithdrawals)}</Money></div>
            <div className="flex justify-between gap-2"><span>Propinas a pagar</span><Money>{pesos(-summary.tipsPayout)}</Money></div>
          </div>
        )}
        <div className="flex justify-between gap-2 border-t border-line pt-2 font-medium">
          <span>Contado</span>
          <Money>{counted === null ? "—" : pesos(counted)}</Money>
        </div>
        {counted !== null && (
          <div className="flex items-center justify-between gap-2">
            <span>Diferencia</span>
            <Chip tone={status.tone}>
              <Money>{differenceText(difference)}</Money>
            </Chip>
          </div>
        )}
      </section>

      {counted !== null && difference !== 0 && (
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="closeNote">Nota del cuadre *</Label>
          <Textarea
            id="closeNote"
            value={note}
            maxLength={CLOSE_NOTE_MAX}
            aria-invalid={!noteOk}
            aria-describedby="closeNoteHelp"
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Escribe por qué no cuadra"
          />
          <p id="closeNoteHelp" className={cn("text-xs", noteOk ? "text-muted-fg" : "text-status-danger-fg")}>
            Obligatoria cuando hay diferencia: de 3 a 300 caracteres.
          </p>
        </div>
      )}
    </div>
  )
}
