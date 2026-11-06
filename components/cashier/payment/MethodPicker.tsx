"use client"

import { Banknote, CreditCard, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PaymentMethodOption } from "@/lib/payments/types"
import { focusRing } from "@/components/cashier/cashier-ui"

interface MethodPickerProps {
  methods: PaymentMethodOption[]
  selectedMethodId: string | null
  onSelectMethod: (methodId: string) => void
  disabled?: boolean
}

/**
 * One tile per active payment method from the catalog. Icons are picked by
 * `kind`: cash = banknote, electronic = credit card; the catalog `name` is
 * the visible (and accessible) label, the kind line is decoration.
 */
export function MethodPicker({ methods, selectedMethodId, onSelectMethod, disabled }: MethodPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Método de pago">
      {methods.map((method) => {
        const selected = selectedMethodId === method.id
        const Icon = method.kind === "cash" ? Banknote : method.code === "nequi" ? Smartphone : CreditCard
        return (
          <button
            key={method.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelectMethod(method.id)}
            className={cn(
              "flex min-h-[56px] min-w-0 items-center gap-2 rounded-card border px-3 py-2 text-left text-sm font-semibold transition-colors motion-reduce:transition-none disabled:opacity-50",
              focusRing,
              selected
                ? "border-brand bg-brand-tint text-fg shadow-glow"
                : "border-line bg-surface text-fg hover:bg-surface-2",
            )}
          >
            <Icon aria-hidden="true" className={cn("h-5 w-5 shrink-0", selected ? "text-brand" : "text-muted-fg")} />
            <span className="min-w-0">
              <span className="block truncate">{method.name}</span>
              <small aria-hidden="true" className="block truncate text-xs font-normal text-muted-fg">
                {method.kind === "cash" ? "con cambio" : "electrónico"}
              </small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
