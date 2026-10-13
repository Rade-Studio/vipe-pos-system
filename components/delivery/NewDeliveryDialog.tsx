'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { businessConfigService } from '@/lib/supabase/business-config-service'
import { DEFAULT_FEE_CONFIG_KEY, DEFAULT_FEE_QUERY_KEY } from '@/lib/delivery/courier-admin'
import { suggestedFeeFromConfig } from '@/lib/delivery/fee'
import { useConfigStore } from '@/store/use-config-store'
import { refreshActiveDeliveries } from '@/hooks/use-active-deliveries'
import { DeliveryOrderForm } from './DeliveryOrderForm'

interface NewDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Sheet-style wrapper for the new-order form.
 *
 * T10 (S2): the suggested delivery fee used to be read through a
 * `useEffect` + local state on EVERY open, and the form was only mounted once
 * that read resolved (`open && feeLoaded && <DeliveryOrderForm/>`), so opening
 * "Nuevo domicilio" showed an empty panel for one round-trip and no second
 * open was cheaper than the first.
 *
 * Now the value lives in the query cache (shared key with the admin setting,
 * which invalidates it after a save) and the form renders IMMEDIATELY:
 * `DeliveryOrderForm` starts the draft at 0 and seeds the suggestion the
 * moment it arrives, unless the operator already typed a fee.
 *
 * On a successful create (the form calls `onSubmitted()`), the board is
 * re-read so the new delivery shows up right away.
 */
export function NewDeliveryDialog({ open, onOpenChange }: NewDeliveryDialogProps) {
  const queryClient = useQueryClient()
  const { taxPercentage } = useConfigStore()

  const { data: storedFee = null, isLoading: feeLoading } = useQuery<string | null>({
    queryKey: DEFAULT_FEE_QUERY_KEY,
    queryFn: () => businessConfigService.getConfigValue(DEFAULT_FEE_CONFIG_KEY),
    // The suggestion is a config row an admin edits from another screen, which
    // invalidates this key after saving; between those edits it does not
    // change, so a long staleTime is what makes the second open free.
    staleTime: 5 * 60_000,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo domicilio</DialogTitle>
          <DialogDescription>
            Captura el cliente, los productos y el domicilio. El servidor recalcula los precios y la propina.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <DeliveryOrderForm
            suggestedFee={suggestedFeeFromConfig(storedFee)}
            suggestedFeeResolved={!feeLoading}
            taxPct={taxPercentage}
            onSubmitted={() => {
              refreshActiveDeliveries(queryClient)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}