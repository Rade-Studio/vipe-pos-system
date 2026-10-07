'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { businessConfigService } from '@/lib/supabase/business-config-service'
import { useConfigStore } from '@/store/use-config-store'
import { activeDeliveriesQueryKey } from '@/hooks/use-active-deliveries'
import { DeliveryOrderForm } from './DeliveryOrderForm'

interface NewDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEFAULT_FEE_KEY = 'delivery_default_fee'

/**
 * Sheet-style wrapper for the new-order form. Loads the suggested
 * delivery fee from `business_config.delivery_default_fee` when the
 * row exists; falls back to 0 otherwise. On a successful create
 * (the form calls `onSubmitted()`), the board's query is invalidated
 * so the new delivery shows up immediately.
 */
export function NewDeliveryDialog({ open, onOpenChange }: NewDeliveryDialogProps) {
  const queryClient = useQueryClient()
  const { taxPercentage } = useConfigStore()
  const [suggestedFee, setSuggestedFee] = useState(0)
  // The form seeds its draft from suggestedFee on mount, so it mounts only
  // after the value has been read.
  const [feeLoaded, setFeeLoaded] = useState(false)

  // Read the suggested fee on every open so a fresh admin edit on
  // task 7 lands in the form. `getConfigValue` returns null on a
  // missing key (the migration that introduces it is task 7; today
  // it does not exist, so we render 0).
  useEffect(() => {
    if (!open) {
      setFeeLoaded(false)
      return
    }
    let cancelled = false
    ;(async () => {
      let fee = 0
      try {
        const raw = await businessConfigService.getConfigValue(DEFAULT_FEE_KEY)
        const parsed = raw === null ? 0 : Number.parseInt(raw, 10)
        fee = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
      } catch {
        // An unreadable config falls back to no suggested fee; the operator
        // can still type one.
        fee = 0
      }
      if (cancelled) return
      setSuggestedFee(fee)
      setFeeLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo domicilio</DialogTitle>
          <DialogDescription>
            Captura el cliente, los productos y el domicilio. El servidor recalcula los precios y la propina.
          </DialogDescription>
        </DialogHeader>
        {open && feeLoaded && (
          <DeliveryOrderForm
            suggestedFee={suggestedFee}
            taxPct={taxPercentage}
            onSubmitted={() => {
              queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}