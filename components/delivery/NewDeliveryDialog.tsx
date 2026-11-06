'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CONFIG_QUERY_KEY, fetchConfig } from '@/lib/api/config'
import { useConfigStore } from '@/store/use-config-store'
import { refreshActiveDeliveries } from '@/hooks/use-active-deliveries'
import { DeliveryOrderForm } from './DeliveryOrderForm'

interface NewDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Wide right drawer for the new-order form (T12: full width on phones; the
 * form inside is the step layout with its persistent summary).
 *
 * T10 (S2): the suggested delivery fee used to be read through a
 * `useEffect` + local state on EVERY open, and the form was only mounted once
 * that read resolved (`open && feeLoaded && <DeliveryOrderForm/>`), so opening
 * "Nuevo domicilio" showed an empty panel for one round-trip and no second
 * open was cheaper than the first.
 *
 * Now the value lives in the query cache (T7b: `deliveryDefaultFee` of the
 * shared `GET /config` query, which the admin setting refreshes after a save)
 * and the form renders IMMEDIATELY:
 * `DeliveryOrderForm` starts the draft at 0 and seeds the suggestion the
 * moment it arrives, unless the operator already typed a fee.
 *
 * On a successful create (the form calls `onSubmitted()`), the board is
 * re-read so the new delivery shows up right away.
 */
export function NewDeliveryDialog({ open, onOpenChange }: NewDeliveryDialogProps) {
  const queryClient = useQueryClient()
  const { taxPercentage } = useConfigStore()

  const { data: config, isLoading: feeLoading } = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: fetchConfig,
    // The suggestion is a config row an admin edits from another screen, which
    // invalidates this key after saving; between those edits it does not
    // change, so a long staleTime is what makes the second open free.
    staleTime: 5 * 60_000,
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-[100dvh] w-full max-w-none flex-col gap-0 border-line bg-canvas p-0 sm:w-[min(1000px,100vw)] sm:max-w-none motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
      >
        <SheetHeader className="space-y-0.5 border-b border-line px-4 py-3 pr-14 text-left md:px-6">
          <SheetTitle className="text-lg">Nuevo domicilio</SheetTitle>
          <SheetDescription className="text-xs">
            Captura el cliente, los productos y el domicilio. El servidor recalcula los precios y la propina.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <DeliveryOrderForm
            suggestedFee={config?.deliveryDefaultFee ?? 0}
            suggestedFeeResolved={!feeLoading}
            taxPct={taxPercentage}
            onSubmitted={() => {
              refreshActiveDeliveries(queryClient)
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}