'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import {
  setDeliveryStatus,
  DeliveryServiceError,
  type DeliveryServiceErrorKind,
  type DeliveryOrderWithBill,
} from '@/lib/supabase/delivery-service'
import { useActiveDeliveries, activeDeliveriesQueryKey } from '@/hooks/use-active-deliveries'
import type { DeliveryStatus, DeliveryAction } from '@/lib/delivery/types'
import { toast } from '@/hooks/use-toast'
import { DeliveryCard } from './DeliveryCard'
import { NewDeliveryDialog } from './NewDeliveryDialog'

const DELIVERY_SERVICE_ERROR_TOAST: Record<DeliveryServiceErrorKind, string> = {
  'not-authorized': 'No tienes permiso para cambiar el estado',
  'not-found': 'El domicilio ya no existe o cambió de restaurante',
  rejected: '', // server message is shown directly
  'invalid-input': '', // server message is shown directly
  unknown: 'Ocurrió un error al cambiar el estado. Intenta de nuevo.',
}

function deliveryErrorMessage(err: unknown): string {
  if (err instanceof DeliveryServiceError) {
    const base = DELIVERY_SERVICE_ERROR_TOAST[err.kind]
    if (base) return base
    return err.message || 'La operación fue rechazada por el servidor'
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.'
}

interface DeliveryBoardProps {
  /** Auth role, drives `allowedActions`. */
  role: 'admin' | 'delivery_operator' | 'kitchen' | 'cashier'
}

/**
 * Operator board. Five active tabs (Recibido / En preparación / Listo
 * / En camino / Fallido) plus a sixth "Cerrados hoy" tab that shows
 * delivered/cancelled deliveries that landed today — already filtered
 * client-side by `listActiveDeliveries`.
 *
 * Card actions this task: Marcar listo, start_preparing. Other
 * transitions (dispatch/deliver/fail/cancel) land in task 6 — the
 * card intentionally does not render disabled buttons for those, so
 * a future reader sees no dead affordances.
 */
export function DeliveryBoard({ role }: DeliveryBoardProps) {
  const queryClient = useQueryClient()
  const { data: deliveries = [], isLoading, error } = useActiveDeliveries()
  const [newOpen, setNewOpen] = useState(false)

  const grouped = useMemo(() => groupByStatus(deliveries), [deliveries])

  const onAction = async (orderId: string, action: DeliveryAction) => {
    try {
      await setDeliveryStatus({ orderId, action })
      queryClient.invalidateQueries({ queryKey: activeDeliveriesQueryKey })
      toast.success('Estado actualizado')
    } catch (err) {
      toast.error(deliveryErrorMessage(err))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {deliveries.length} {deliveries.length === 1 ? 'domicilio activo' : 'domicilios activos'}
        </p>
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo domicilio
        </Button>
      </div>

      <Tabs defaultValue="received" className="space-y-2">
        <TabsList className="flex-wrap">
          <TabsTrigger value="received">Recibido ({grouped.received.length})</TabsTrigger>
          <TabsTrigger value="preparing">En preparación ({grouped.preparing.length})</TabsTrigger>
          <TabsTrigger value="ready">Listo ({grouped.ready.length})</TabsTrigger>
          <TabsTrigger value="out_for_delivery">En camino ({grouped.out_for_delivery.length})</TabsTrigger>
          <TabsTrigger value="failed">Fallido ({grouped.failed.length})</TabsTrigger>
          <TabsTrigger value="closed">Cerrados hoy ({grouped.closed.length})</TabsTrigger>
        </TabsList>

        <ColumnContent
          value="received"
          rows={grouped.received}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
        />
        <ColumnContent
          value="preparing"
          rows={grouped.preparing}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
        />
        <ColumnContent
          value="ready"
          rows={grouped.ready}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
        />
        <ColumnContent
          value="out_for_delivery"
          rows={grouped.out_for_delivery}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
        />
        <ColumnContent
          value="failed"
          rows={grouped.failed}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
        />
        <ColumnContent
          value="closed"
          rows={grouped.closed}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          closedMode
        />
      </Tabs>

      <NewDeliveryDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  )
}

function ColumnContent({
  value,
  rows,
  isLoading,
  error,
  role,
  onAction,
  closedMode = false,
}: {
  value: string
  rows: ReturnType<typeof groupByStatus>[DeliveryStatus | 'closed']
  isLoading: boolean
  error: unknown
  role: DeliveryBoardProps['role']
  onAction: (orderId: string, action: DeliveryAction) => void
  closedMode?: boolean
}) {
  if (error !== null && error !== undefined) {
    return (
      <TabsContent value={value}>
        <p className="text-sm text-destructive">No se pudieron cargar los domicilios.</p>
      </TabsContent>
    )
  }
  if (isLoading) {
    return (
      <TabsContent value={value}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </TabsContent>
    )
  }
  if (rows.length === 0) {
    return (
      <TabsContent value={value}>
        <p className="text-sm text-muted-foreground">
          {closedMode ? 'No hay domicilios cerrados hoy.' : 'Sin domicilios en este estado.'}
        </p>
      </TabsContent>
    )
  }
  return (
    <TabsContent value={value}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <DeliveryCard
            key={row.delivery.orderId}
            row={row}
            role={role}
            onAction={(action) => onAction(row.delivery.orderId, action)}
          />
        ))}
      </div>
    </TabsContent>
  )
}

type GroupByStatusKey = DeliveryStatus | 'closed'

function groupByStatus(rows: ReadonlyArray<DeliveryOrderWithBill>): Record<GroupByStatusKey, DeliveryOrderWithBill[]> {
  const result: Record<GroupByStatusKey, DeliveryOrderWithBill[]> = {
    received: [],
    preparing: [],
    ready: [],
    out_for_delivery: [],
    delivered: [],
    failed: [],
    cancelled: [],
    closed: [],
  }
  for (const row of rows) {
    const status = row.delivery.status
    if (status === 'delivered' || status === 'cancelled') {
      result.closed.push(row)
    } else {
      result[status].push(row)
    }
  }
  return result
}