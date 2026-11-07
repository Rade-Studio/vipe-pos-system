'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  getClosedTodaySummary,
  returnCourier,
  setDeliveryStatus,
  DeliveryServiceError,
  type DeliveryServiceErrorKind,
  type DeliveryOrderWithBill,
} from '@/lib/api/delivery'
import type { DeliveryOrder } from '@/lib/delivery/types'
import { applyDeliveryStatusPatch } from '@/lib/delivery/realtime'
import {
  useActiveDeliveries,
  activeDeliveriesQueryKey,
  refreshActiveDeliveries,
  useRealtimeConnected,
} from '@/hooks/use-active-deliveries'
import type { DeliveryAction } from '@/lib/delivery/types'
import { toast } from '@/hooks/use-toast'
import { needsPrepaidWarning, rejectionMessage } from '@/lib/delivery/card-actions'
import { useCashRegisterStore } from '@/store/use-cash-register-store'
import { getOpenRegister } from '@/lib/api/registers'
import { PaymentMethodDialog } from '@/components/cashier/PaymentMethodDialog'
import { DeliveryCard } from './DeliveryCard'
import { NewDeliveryDialog } from './NewDeliveryDialog'
import { DispatchDialog } from './DispatchDialog'
import { FailDialog } from './FailDialog'
import { VoidFlow } from '@/components/voids/VoidFlow'
import type { VoidTarget } from '@/components/voids/flow'
import { CouriersRail } from './CouriersRail'
import { useLastLiveSignal, useNow } from './use-live-signal'
import { CONFIG_QUERY_KEY, fetchConfig } from '@/lib/api/config'
import { DEFAULT_LATE_THRESHOLDS } from '@/lib/api/settings'
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_GAP_PX,
  BOARD_COLUMN_MIN_PX,
  BOARD_WIDE_MIN_PX,
  closedTodayLine,
  columnRangeLabel,
  courierLoad,
  courierTrips,
  deliveryOrderRef,
  groupDeliveries,
  isShortcutTarget,
  lostConnectionText,
  signalAgeLabel,
  visibleColumnRange,
  type BoardColumnStatus,
  type ColumnRange,
} from '@/lib/delivery/console'
import { formatAddress } from '@/lib/delivery/address'
import {
  CHIP,
  COLUMN_SURFACE,
  FOCUS_RING,
  PILL_BUTTON,
  STATUS_CHIP,
} from './console-ui'

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
  /** T25: the signed-in person, shown in the header with the register state. */
  operatorName?: string
  /** T25: the view shows the role nav (bottom bar on phones), so the FAB moves up. */
  withRoleNav?: boolean
}

const ACTION_SUCCESS_TOAST: Record<DeliveryAction, string> = {
  start_preparing: 'Domicilio en preparación',
  mark_ready: 'Domicilio listo',
  dispatch: 'Domicilio despachado',
  deliver: 'Domicilio entregado',
  fail: 'Domicilio marcado como fallido',
  cancel: 'Domicilio cancelado',
}

type CardDialogKind = 'dispatch' | 'fail' | 'pay'

/** T25: how often the header re-checks the register (also on window focus). */
export const REGISTER_POLL_MS = 60_000

/** Container width from which the couriers rail is a side column. */
const RAIL_SIDE_MIN_PX = 1024

/**
 * Operator board — T12 "Consola de despacho". Header with the real live
 * indicator and "Nuevo domicilio" (N shortcut, FAB on phones); from a
 * 1200 px container the five states are a horizontal snap scroller of
 * columns (arrows, edge fade, "Columnas 1–3 de 5"), below that status tabs
 * over a card list; the couriers rail is a side column from 1024 px and a
 * section under the board below.
 *
 * Five active tabs (Recibido / En preparación / Listo
 * / En camino / Fallido) plus a sixth "Cerrados hoy" tab that shows
 * delivered/cancelled deliveries that landed today — already filtered
 * client-side by `listActiveDeliveries`.
 *
 * start_preparing, mark_ready and deliver run directly; dispatch (and
 * re-dispatch), fail and cancel go through a dialog; "Registrar pago"
 * opens the cashier payment dialog on the open register. Every
 * mutation is single-flight per card: a synchronous ref gate plus a
 * state set that disables the card's buttons.
 *
 * T25 (S8): the header names the operator with "Caja abierta/cerrada" and the
 * age of the last live signal; "Cerrados hoy" reads the server's split and
 * average; cards show "#D-0412", the prepaid channel and turn late at the
 * restaurant's `deliveryLateMinutes`; the couriers rail shows each trip (ETA,
 * location), records the return and lets the operator add and switch couriers.
 */
export function DeliveryBoard({ role, operatorName, withRoleNav = false }: DeliveryBoardProps) {
  const queryClient = useQueryClient()
  const { data: deliveries = [], isLoading, error } = useActiveDeliveries()
  const [newOpen, setNewOpen] = useState(false)
  const [dialog, setDialog] = useState<{ kind: CardDialogKind; orderId: string } | null>(null)
  const inFlight = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const { isRegisterOpen, loadOpenRegister } = useCashRegisterStore()
  // null until the first check: the header shows nothing rather than a guess.
  const [registerOpen, setRegisterOpen] = useState<boolean | null>(null)

  // The register may have been opened after the app loaded. The board only
  // needs open/closed, so this is the ONE-request check, not the full register
  // load (which also reads both transaction histories) — T10/S1.
  useEffect(() => {
    let alive = true
    void loadOpenRegister().finally(() => {
      if (alive) setRegisterOpen(useCashRegisterStore.getState().isRegisterOpen())
    })
    return () => {
      alive = false
    }
  }, [loadOpenRegister])

  // T25: "Caja abierta/cerrada" follows the register while the console is open.
  // The store's check never clears a register closed elsewhere, so the header
  // re-reads the open register every minute and on window focus; a newly
  // opened one goes into the store through the same store check.
  useEffect(() => {
    let alive = true
    const recheck = async () => {
      try {
        const open = await getOpenRegister()
        if (!alive) return
        setRegisterOpen(open !== null)
        if (open && useCashRegisterStore.getState().currentRegister?.id !== open.id) void loadOpenRegister()
      } catch {
        // Keep the last known state; the next check tries again.
      }
    }
    const timer = setInterval(() => void recheck(), REGISTER_POLL_MS)
    const onFocus = () => void recheck()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadOpenRegister])

  const grouped = useMemo(() => groupDeliveries(deliveries), [deliveries])
  const load = useMemo(() => courierLoad(deliveries), [deliveries])
  const trips = useMemo(() => courierTrips(deliveries), [deliveries])
  const connected = useRealtimeConnected()
  const lastSignalAt = useLastLiveSignal(connected)
  // Late tones move with the clock; a 30 s tick is enough for whole minutes.
  const nowMs = useNow(30_000)
  const { data: config } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig, staleTime: 5 * 60_000 })
  const lateMinutes = config?.deliveryLateMinutes ?? DEFAULT_LATE_THRESHOLDS.deliveryLateMinutes
  // Re-read the closed-today metrics when a delivery closes or fails on the board.
  const { data: closedToday } = useQuery({
    queryKey: ['delivery-closed-today', grouped.closed.length, grouped.failed.length],
    queryFn: getClosedTodaySummary,
    enabled: !isLoading,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  })
  const shift = [
    operatorName,
    registerOpen === null ? null : registerOpen ? 'Caja abierta' : 'Caja cerrada',
  ].filter(Boolean).join(' · ')
  const [rootRef, width] = useElementWidth<HTMLDivElement>()
  const wide = width >= BOARD_WIDE_MIN_PX
  const railSide = width >= RAIL_SIDE_MIN_PX
  const [showClosed, setShowClosed] = useState(false)
  const activeCount = deliveries.length - grouped.closed.length

  // "N" opens Nuevo domicilio unless the operator is typing or a dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (newOpen || dialog !== null || event.defaultPrevented) return
      if (!isShortcutTarget(event)) return
      event.preventDefault()
      setNewOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newOpen, dialog])
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
    courierEta?: string
    courierLocation?: string
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
        setDialog({ kind: action, orderId })
        return
      case 'cancel': {
        // F3b: the audited step sheet; the target is fixed now so the sheet
        // survives the row moving under it while it is open.
        const row = deliveries.find((r) => r.delivery.orderId === orderId)
        if (row) setCancelTarget(deliveryCancelTarget(row))
        return
      }
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

  /** "Volvió": the courier is back for these finished trips (one request each). */
  const onReturn = async (orderIds: string[]) => {
    let returned = 0
    for (const orderId of orderIds) {
      await runForCard(orderId, async () => {
        try {
          applyMove(await returnCourier(orderId))
          returned += 1
        } catch (err) {
          toast.error(deliveryErrorMessage(err))
          refreshBoard()
        }
      })
    }
    if (returned > 0) toast.success('Repartidor de regreso en el local')
  }

  const [cancelTarget, setCancelTarget] = useState<VoidTarget | null>(null)
  const dialogPending = dialog !== null && pendingIds.has(dialog.orderId)
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null)
  }

  const listProps = { isLoading, error, role, onAction, onRegisterPayment, pendingIds, lateMinutes, nowMs }
  const closedLine = closedToday ? closedTodayLine(closedToday) : null

  return (
    <div ref={rootRef} className="flex min-h-full min-w-0 flex-col bg-canvas text-fg">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 md:px-6">
        <div className="mr-auto min-w-0">
          <h2 className="whitespace-nowrap text-xl font-semibold tracking-tight">Consola de despacho</h2>
          {shift && (
            <p aria-label="Turno" className="truncate text-sm text-muted-fg">
              {shift}
            </p>
          )}
        </div>
        <LiveIndicator connected={connected} lastSignalAt={lastSignalAt} />
        <Button
          className={cn(PILL_BUTTON, 'hidden bg-btn px-5 text-btn-foreground shadow-glow hover:bg-btn/90 md:inline-flex')}
          onClick={() => setNewOpen(true)}
          aria-keyshortcuts="N"
          aria-label="Nuevo domicilio"
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Nuevo domicilio
          <kbd className="ml-2 rounded border border-current/30 px-1.5 text-[11px] font-medium opacity-80">N</kbd>
        </Button>
      </div>

      {!connected && lastSignalAt !== null && (
        <LostConnectionBanner lastSignalAt={lastSignalAt} onRefresh={refreshBoard} />
      )}

      <div className={cn('grid min-w-0 flex-1', railSide ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1')}>
        <section
          aria-labelledby="board-title"
          className={cn(
            'flex min-w-0 flex-col gap-4 px-4 pt-4 md:px-6 md:pb-7 md:pt-5',
            withRoleNav ? 'pb-40' : 'pb-24',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 id="board-title" className="mr-auto whitespace-nowrap text-[17px] font-semibold">
              Domicilios activos{' '}
              <span className="font-normal text-muted-fg">
                · {activeCount} en curso
              </span>
            </h3>
            {wide && (
              <Button
                variant="outline"
                size="sm"
                className={cn(PILL_BUTTON, showClosed && 'border-brand-line bg-brand-tint')}
                aria-pressed={showClosed}
                onClick={() => setShowClosed((v) => !v)}
              >
                Cerrados hoy ({grouped.closed.length})
              </Button>
            )}
          </div>

          {closedLine && (
            <p
              role="group"
              aria-label="Cerrados hoy"
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-3 py-2 text-sm text-fg-2 dark:bg-surface-2"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-fg">Cerrados hoy:</span>{' '}
                <span className="tabular-nums">{closedLine.counts}</span>
              </span>
              <span className="tabular-nums text-muted-fg">{closedLine.average}</span>
            </p>
          )}

          {wide ? (
            <>
              <ColumnScroller grouped={grouped} {...listProps} />
              {showClosed && (
                <div className="grid gap-3">
                  <h4 className="text-sm font-semibold">Cerrados hoy</h4>
                  <CardList rows={grouped.closed} closedMode {...listProps} />
                </div>
              )}
            </>
          ) : (
            <StatusTabs grouped={grouped} {...listProps} />
          )}
        </section>

        <CouriersRail
          load={load}
          trips={trips}
          layout={railSide ? 'side' : 'section'}
          canManage={role === 'delivery_operator' || role === 'admin'}
          onReturn={onReturn}
        />
      </div>

      <Button
        className={cn(
          withRoleNav ? 'bottom-[84px]' : 'bottom-5',
          'fixed right-4 z-30 h-14 w-14 rounded-full bg-btn p-0 text-btn-foreground shadow-glow-lg hover:bg-btn/90 md:hidden',
          FOCUS_RING,
        )}
        onClick={() => setNewOpen(true)}
        aria-label="Nuevo domicilio"
        aria-keyshortcuts="N"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </Button>

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
          orderRef={deliveryOrderRef(dialogRow.delivery)}
          orderSummary={`${dialogRow.delivery.customerName} · ${safeAddress(dialogRow.delivery)}`}
          courierLoad={load}
          courierTrips={trips}
          onConfirm={(courierId, details) =>
            void closeDialogOnSuccess(
              transition({ orderId: dialogRow.delivery.orderId, action: 'dispatch', courierId, ...details }),
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
      <VoidFlow
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={() => {
          toast.success(ACTION_SUCCESS_TOAST.cancel)
          refreshBoard()
        }}
      />
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

/**
 * The step sheet's target for a delivery (F3b): a reason always; a supervisor
 * only when it is paid, and then its payment is voided (the sheet reads its
 * total, tip included, from the order).
 */
function deliveryCancelTarget(row: DeliveryOrderWithBill): VoidTarget {
  const total = row.amountDue + row.delivery.deliveryFee
  return {
    action: 'order',
    orderId: row.delivery.orderId,
    label: `${deliveryOrderRef(row.delivery)} · ${row.delivery.customerName}`,
    lines: [],
    total,
    hasPayments: row.isPaid,
    delivery: true,
  }
}

type ListProps = {
  isLoading: boolean
  error: unknown
  role: DeliveryBoardProps['role']
  onAction: (orderId: string, action: DeliveryAction) => void
  onRegisterPayment: (orderId: string) => void
  pendingIds: ReadonlySet<string>
  lateMinutes: number
  nowMs: number
}

type Grouped = ReturnType<typeof groupDeliveries<DeliveryOrderWithBill>>

function LiveIndicator({ connected, lastSignalAt }: { connected: boolean; lastSignalAt: number | null }) {
  const now = useNow(1_000)
  // Connected: age of the last signal; disconnected: time since it (T25).
  const age = lastSignalAt !== null ? signalAgeLabel(now - lastSignalAt) : null
  const label = `${connected ? 'En vivo' : 'Sin conexión en vivo'}${age ? ` · ${age}` : ''}`
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        CHIP,
        'h-8 px-3 text-[13px]',
        connected
          ? 'border-status-free-line bg-status-free-bg text-status-free-fg'
          : 'border-status-warning-line bg-status-warning-bg text-status-warning-fg',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 rounded-full bg-current',
          connected && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      <span>{connected ? 'En vivo' : 'Sin conexión en vivo'}</span>
      {age && <span className="tabular-nums">{` · ${age}`}</span>}
    </span>
  )
}

/**
 * The design's stale-board banner (T25): shown while the live connection is
 * lost after a first signal, with the time since it; the socket reconnects on
 * its own, so the action re-reads the board now.
 */
function LostConnectionBanner({ lastSignalAt, onRefresh }: { lastSignalAt: number; onRefresh: () => void }) {
  const now = useNow(1_000)
  return (
    <div
      role="alert"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-status-warning-line bg-status-warning-bg px-4 py-3 text-sm text-status-warning-fg md:mx-6"
    >
      <p className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
        <b className="font-semibold">{lostConnectionText(now - lastSignalAt)}</b> El tablero puede estar
        desactualizado; las acciones siguen funcionando.
      </p>
      <Button size="sm" variant="outline" className={cn(PILL_BUTTON, 'px-4')} onClick={onRefresh}>
        Actualizar tablero
      </Button>
    </div>
  )
}

/** < 1200 px: status tabs with counts over a card list. */
function StatusTabs({ grouped, ...listProps }: { grouped: Grouped } & ListProps) {
  const tabs: ReadonlyArray<{ value: BoardColumnStatus | 'closed'; label: string }> = [
    ...BOARD_COLUMNS.map((c) => ({ value: c.status, label: c.label })),
    { value: 'closed', label: 'Cerrados hoy' },
  ]
  return (
    <Tabs defaultValue="received" className="grid min-w-0 gap-3">
      <TabsList className="flex h-auto w-full min-w-0 justify-start gap-1.5 overflow-x-auto rounded-none bg-transparent p-0.5 [scrollbar-width:none]">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className={cn(
              'min-h-11 shrink-0 snap-start gap-2 rounded-pill border border-line bg-surface-2 px-3.5 text-sm text-fg-2',
              'data-[state=active]:shadow-none',
              t.value === 'closed'
                ? 'data-[state=active]:border-line-strong data-[state=active]:bg-surface data-[state=active]:text-fg'
                : TAB_ACTIVE[t.value],
              FOCUS_RING,
            )}
          >
            {t.label}{' '}
            <span className="tabular-nums text-xs opacity-90">{grouped[t.value].length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-0">
          <CardList rows={grouped[t.value]} closedMode={t.value === 'closed'} showStatus={t.value === 'closed'} {...listProps} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

const TAB_ACTIVE: Record<BoardColumnStatus, string> = {
  received: 'data-[state=active]:border-status-occupied-line data-[state=active]:bg-status-occupied-bg data-[state=active]:text-status-occupied-fg',
  preparing: 'data-[state=active]:border-status-kitchen-line data-[state=active]:bg-status-kitchen-bg data-[state=active]:text-status-kitchen-fg',
  ready: 'data-[state=active]:border-status-free-line data-[state=active]:bg-status-free-bg data-[state=active]:text-status-free-fg',
  out_for_delivery: 'data-[state=active]:border-status-served-line data-[state=active]:bg-status-served-bg data-[state=active]:text-status-served-fg',
  failed: 'data-[state=active]:border-status-danger-line data-[state=active]:bg-status-danger-bg data-[state=active]:text-status-danger-fg',
}

/** ≥ 1200 px: one snap column per state, arrows, edge fade and a column counter. */
function ColumnScroller({ grouped, ...listProps }: { grouped: Grouped } & ListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const total = BOARD_COLUMNS.length
  const [range, setRange] = useState<ColumnRange>({ first: 1, last: total })
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const column = (el.firstElementChild as HTMLElement | null)?.offsetWidth || BOARD_COLUMN_MIN_PX
    setRange(
      visibleColumnRange({ scrollLeft: el.scrollLeft, viewport: el.clientWidth, column, gap: BOARD_COLUMN_GAP_PX, total }),
    )
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }, [total])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const scrollByColumn = (direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    const column = (el.firstElementChild as HTMLElement | null)?.offsetWidth || BOARD_COLUMN_MIN_PX
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * (column + BOARD_COLUMN_GAP_PX), behavior: reduce ? 'auto' : 'smooth' })
  }

  const mask =
    edges.left && edges.right
      ? 'linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 72px), transparent)'
      : edges.right
        ? 'linear-gradient(90deg, #000 calc(100% - 72px), transparent)'
        : edges.left
          ? 'linear-gradient(90deg, transparent, #000 48px)'
          : undefined

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex items-center justify-end gap-2">
        <p className="mr-1 whitespace-nowrap text-sm tabular-nums text-muted-fg" aria-live="polite">
          {columnRangeLabel(range, total)}
        </p>
        <Button
          variant="outline"
          size="icon"
          className={cn(PILL_BUTTON, 'h-11 w-11')}
          onClick={() => scrollByColumn(-1)}
          disabled={!edges.left}
          aria-label="Columnas anteriores"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className={cn(PILL_BUTTON, 'h-11 w-11')}
          onClick={() => scrollByColumn(1)}
          disabled={!edges.right}
          aria-label="Columnas siguientes"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="grid snap-x snap-mandatory auto-cols-[minmax(288px,1fr)] grid-flow-col items-start gap-3 overflow-x-auto pb-1.5 [scrollbar-width:thin] motion-safe:scroll-smooth"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {BOARD_COLUMNS.map((c) => (
          <section
            key={c.status}
            aria-label={`${c.label}, ${grouped[c.status].length}`}
            className={cn('flex min-h-[480px] min-w-0 snap-start flex-col rounded-card-lg border border-line', COLUMN_SURFACE)}
          >
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
              <h4 className="mr-auto whitespace-nowrap text-sm font-semibold">{c.label}</h4>
              <span className={cn(CHIP, STATUS_CHIP[c.status], 'tabular-nums')}>{grouped[c.status].length}</span>
            </div>
            <div className="grid gap-2.5 p-2.5">
              <CardList rows={grouped[c.status]} stacked {...listProps} />
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function CardList({
  rows,
  isLoading,
  error,
  role,
  onAction,
  onRegisterPayment,
  pendingIds,
  lateMinutes,
  nowMs,
  closedMode = false,
  stacked = false,
  showStatus = false,
}: ListProps & {
  rows: DeliveryOrderWithBill[]
  closedMode?: boolean
  /** One card per row (inside a board column). */
  stacked?: boolean
  showStatus?: boolean
}) {
  const layout = stacked
    ? 'grid gap-2.5'
    : 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]'
  if (error !== null && error !== undefined) {
    return <p className="text-sm text-destructive">No se pudieron cargar los domicilios.</p>
  }
  if (isLoading) {
    return (
      <div className={layout}>
        {Array.from({ length: stacked ? 2 : 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-card" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-sm text-muted-fg">
        {closedMode ? 'No hay domicilios cerrados hoy.' : 'Sin domicilios en este estado.'}
      </p>
    )
  }
  return (
    <div className={layout}>
      {rows.map((row) => (
        <DeliveryCard
          key={row.delivery.orderId}
          row={row}
          role={role}
          onAction={(action) => onAction(row.delivery.orderId, action)}
          onRegisterPayment={() => onRegisterPayment(row.delivery.orderId)}
          isPending={pendingIds.has(row.delivery.orderId)}
          showStatus={showStatus}
          lateMinutes={lateMinutes}
          nowMs={nowMs}
        />
      ))}
    </div>
  )
}

/** Width of an element, kept current with a ResizeObserver (0 until measured). */
function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    const read = () => setWidth(node.getBoundingClientRect().width)
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}

function safeAddress(d: { addressLine: string; neighborhood: string | null; addressReference: string | null }): string {
  try {
    return formatAddress({ addressLine: d.addressLine, neighborhood: d.neighborhood, reference: d.addressReference })
  } catch {
    return d.addressLine
  }
}
