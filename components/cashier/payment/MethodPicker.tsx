"use client"

import { Button } from "@/components/ui/button"
import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import type { PaymentMethodOption } from "@/lib/payments/types"

interface MethodPickerProps {
  methods: PaymentMethodOption[]
  selectedMethodId: string | null
  /** Pre-filled amount suggestion (the remaining on the bill). */
  quickFillAmount: number
  onSelectMethod: (methodId: string) => void
  onQuickFill: (amount: number) => void
}

/**
 * Renders one row per active payment method from the catalog. Each row
 * is a clickable button that selects the method; once selected, the
 * "Usar restante" button fills the amount input with the bill's
 * remaining. Icons are picked by `kind`: cash = banknote, electronic =
 * credit card; the catalog `name` is the visible label.
 */
export function MethodPicker({
  methods,
  selectedMethodId,
  quickFillAmount,
  onSelectMethod,
  onQuickFill,
}: MethodPickerProps) {
  return (
    <div className="grid gap-2">
      {methods.map((method) => {
        const selected = selectedMethodId === method.id
        const Icon = method.kind === "cash" ? Banknote : method.code === "nequi" ? Smartphone : CreditCard
        return (
          <div
            key={method.id}
            className={cn(
              "flex items-center gap-2 rounded-md border p-3 transition-colors",
              selected ? "border-primary bg-primary/5 ring-2 ring-primary" : "hover:bg-muted",
            )}
          >
            <Button
              type="button"
              variant={selected ? "default" : "outline"}
              className="flex-1 justify-start"
              onClick={() => onSelectMethod(method.id)}
            >
              <Icon className="mr-2 h-5 w-5" />
              {method.name}
            </Button>
            {selected && quickFillAmount > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onQuickFill(quickFillAmount)}
                title="Usar el restante"
              >
                <Wallet className="mr-2 h-4 w-4" />
                Usar restante ({formatCurrency(quickFillAmount)})
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
