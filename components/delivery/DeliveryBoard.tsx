'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { DeliveryOrder } from '@/lib/delivery/types'
import { applyDeliveryStatusPatch } from '@/lib/delivery/realtime'
import {
  useActiveDeliveries,
  activeDeliveriesQueryKey,
  refreshActiveDeliveries,
} from '@/hooks/use-active-deliveries'
import type { DeliveryStatus, DeliveryAction } from '@/lib/delivery/types'
import { toast } from '@/hooks/use-toast'
import { needsPrepaidWarning, rejectionMessage } from '@/lib/delivery/card-actions'
import { useCashRegisterStore } from '@/store/use-cash-register-store'
import { PaymentMethodDialog } from '@/components/cashier/PaymentMethodDialog'
import { DeliveryCard } from './DeliveryCard'
import { NewDeliveryDialog } from './NewDeliveryDialog'
import { DispatchDialog } from './DispatchDialog'
import { FailDialog } from './FailDialog'
import { CancelDeliveryDialog } from './CancelDeliveryDialog'

const DELIVERY_SERVICE_ERROR_TOAST: Record<DeliveryServiceErrorKind, string> = {
  'not-authorized': 'No tienes permiso para cambiar el estado',
  'not-found': 'El domicilio ya no existe o cambió de restaurante',
  rejected: '', // mapped by rejectionMessage
  'invalid-input': '', // server message is shown directly
  unknown: 'Ocurrió un error al cambiar el estado. Intenta de nuevo.',
}

function deliveryErrorMessage(err: unknown): string {
  if (err instanceof DeliveryServiceError) {
    const base = DELIVERY_SERVICE_ERROR_TOAST[err.kind]
    if (base) return base
    if (err.kind === 'rejected') return rejectionMessage(err.message)
    return err.message || 'La operación fue rechazada por el servidor'
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.'
}

interface DeliveryBoardProps {
  /** Auth role, drives `allowedActions`. */
  role: 'admin' | 'delivery_operator' | 'kitchen' | 'cashier'
}

const ACTION_SUCCESS_TOAST: Record<DeliveryAction, string> = {
  start_preparing: 'Domicilio en preparación',
  mark_ready: 'Domicilio listo',
  dispatch: 'Domicilio despachado',
  deliver: 'Domicilio entregado',
  fail: 'Domicilio marcado como fallido',
  cancel: 'Domicilio cancelado',
}

type CardDialogKind = 'dispatch' | 'fail' | 'cancel' | 'pay'

/**
 * Operator board. Five active tabs (Recibido / En preparación / Listo
 * / En camino / Fallido) plus a sixth "Cerrados hoy" tab that shows
 * delivered/cancelled deliveries that landed today — already filtered
 * client-side by `listActiveDeliveries`.
 *
 * start_preparing, mark_ready and deliver run directly; dispatch (and
 * re-dispatch), fail and cancel go through a dialog; "Registrar pago"
 * opens the cashier payment dialog on the open register. Every
 * mutation is single-flight per card: a synchronous ref gate plus a
 * state set that disables the card's buttons.
 */
export function DeliveryBoard({ role }: DeliveryBoardProps) {
  const queryClient = useQueryClient()
  const { data: deliveries = [], isLoading, error } = useActiveDeliveries()
  const [newOpen, setNewOpen] = useState(false)
  const [dialog, setDialog] = useState<{ kind: CardDialogKind; orderId: string } | null>(null)
  const inFlight = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const { isRegisterOpen, loadOpenRegister } = useCashRegisterStore()

  // The register may have been opened after the app loaded. The board only
  // needs open/closed, so this is the ONE-request check, not the full register
  // load (which also reads both transaction histories) — T10/S1.
  useEffect(() => {
    void loadOpenRegister()
  }, [loadOpenRegister])

  const grouped = useMemo(() => groupByStatus(deliveries), [deliveries])
  // Dialogs read the latest row so realtime updates (e.g. a payment) show up.
  const dialogRow = dialog
    ? deliveries.find((r) => r.delivery.orderId === dialog.orderId) ?? null
    : null

  const refreshBoard = useCallback(
    () => refreshActiveDeliveries(queryClient),
    [queryClient],
  )

  /**
   * Apply the row the RPC returned so the card moves without re-reading the
   * board. `unchanged` means the cache already shows it (no write at all);
   * `needs-refresh` (order no longer on the board) falls back to a read.
   */
  const applyMove = useCallback(
    (moved: DeliveryOrder) => {
      const cached = queryClient.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      const outcome = applyDeliveryStatusPatch(cached, moved)
      if (outcome.kind === 'patched') {
        queryClient.setQueryData(activeDeliveriesQueryKey, outcome.rows)
        return
      }
      if (outcome.kind === 'needs-refresh') refreshBoard()
    },
    [queryClient, refreshBoard],
  )

  /** Runs `task` unless another one is in flight for the same card. */
  const runForCard = async <T,>(orderId: string, task: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current.has(orderId)) return undefined
    inFlight.current.add(orderId)
    setPendingIds((prev) => new Set(prev).add(orderId))
    try {
      return await task()
    } finally {
      inFlight.current.delete(orderId)
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const transition = async (input: {
    orderId: string
    action: DeliveryAction
    courierId?: string
    reason?: string
  }): Promise<boolean> => {
    const ok = await runForCard(input.orderId, async () => {
      let moved: DeliveryOrder | null = null
      try {
        moved = await setDeliveryStatus(input)
        toast.success(ACTION_SUCCESS_TOAST[input.action])
        return true
      } catch (err) {
        toast.error(deliveryErrorMessage(err))
        return false
      } finally {
        // T10: ONE reload per action. A successful write is applied from the
        // RPC's own row (the realtime echo of it then changes nothing), so the
        // board is not re-read. A rejection may mean the row moved under us,
        // so that path still re-reads — once, debounced.
        if (moved) applyMove(moved)
        else refreshBoard()
      }
    })
    return ok === true
  }

  const closeDialogOnSuccess = async (run: Promise<boolean>) => {
    if (await run) setDialog(null)
  }

  const onAction = (orderId: string, action: DeliveryAction) => {
    switch (action) {
      case 'dispatch':
      case 'fail':
      case 'cancel':
        setDialog({ kind: action, orderId })
        return
      default:
        void transition({ orderId, action })
    }
  }

  const onRegisterPayment = (orderId: string) => {
    void runForCard(orderId, async () => {
      await loadOpenRegister()
      if (!isRegisterOpen()) {
        toast.error('No hay caja abierta. Pide al cajero que abra la caja para registrar el pago.')
        return
      }
      setDialog({ kind: 'pay', orderId })
    })
  }

  const dialogPending = dialog !== null && pendingIds.has(dialog.orderId)
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null)
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
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
        />
        <ColumnContent
          value="preparing"
          rows={grouped.preparing}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
        />
        <ColumnContent
          value="ready"
          rows={grouped.ready}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
        />
        <ColumnContent
          value="out_for_delivery"
          rows={grouped.out_for_delivery}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
        />
        <ColumnContent
          value="failed"
          rows={grouped.failed}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
        />
        <ColumnContent
          value="closed"
          rows={grouped.closed}
          isLoading={isLoading}
          error={error}
          role={role}
          onAction={onAction}
          onRegisterPayment={onRegisterPayment}
          pendingIds={pendingIds}
          closedMode
        />
      </Tabs>

      <NewDeliveryDialog open={newOpen} onOpenChange={setNewOpen} />

      {dialogRow && dialog?.kind === 'dispatch' && (
        <DispatchDialog
          open
          onOpenChange={closeDialog}
          isRedispatch={dialogRow.delivery.status === 'failed'}
          showPrepaidWarning={needsPrepaidWarning({
            paymentMode: dialogRow.delivery.paymentMode,
            isPaid: dialogRow.isPaid,
          })}
          isPending={dialogPending}
          onConfirm={(courierId) =>
            void closeDialogOnSuccess(
              transition({ orderId: dialogRow.delivery.orderId, action: 'dispatch', courierId }),
            )
          }
        />
      )}
      {dialogRow && dialog?.kind === 'fail' && (
        <FailDialog
          open
          onOpenChange={closeDialog}
          isPending={dialogPending}
          onConfirm={(reason) =>
            void closeDialogOnSuccess(
              transition({ orderId: dialogRow.delivery.orderId, action: 'fail', reason }),
            )
          }
        />
      )}
      {dialogRow && dialog?.kind === 'cancel' && (
        <CancelDeliveryDialog
          open
          onOpenChange={closeDialog}
          customerName={dialogRow.delivery.customerName}
          isPending={dialogPending}
          onConfirm={() =>
            void closeDialogOnSuccess(
              transition({ orderId: dialogRow.delivery.orderId, action: 'cancel' }),
            )
          }
        />
      )}
      {dialogRow && dialog?.kind === 'pay' && (
        <PaymentMethodDialog
          open
          onOpenChange={closeDialog}
          orderId={dialogRow.delivery.orderId}
          tableId={null}
          deliveryFee={dialogRow.delivery.deliveryFee}
          delivery={dialogRow.delivery}
          onSuccess={() => {
            setDialog(null)
            refreshBoard()
          }}
        />
      )}
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
  onRegisterPayment,
  pendingIds,
  closedMode = false,
}: {
  value: string
  rows: ReturnType<typeof groupByStatus>[DeliveryStatus | 'closed']
  isLoading: boolean
  error: unknown
  role: DeliveryBoardProps['role']
  onAction: (orderId: string, action: DeliveryAction) => void
  onRegisterPayment: (orderId: string) => void
  pendingIds: ReadonlySet<string>
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
            onRegisterPayment={() => onRegisterPayment(row.delivery.orderId)}
            isPending={pendingIds.has(row.delivery.orderId)}
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