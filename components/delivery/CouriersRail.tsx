'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { listCouriers, updateCourier, DeliveryServiceError } from '@/lib/api/delivery'
import { CONFIG_QUERY_KEY, fetchConfig } from '@/lib/api/config'
import { courierStatusLine, type CourierTrip } from '@/lib/delivery/console'
import { toast } from '@/hooks/use-toast'
import { CHIP, MONEY, PILL_BUTTON, formatMoney } from './console-ui'
import { NewCourierDialog } from './NewCourierDialog'

interface CouriersRailProps {
  /** Deliveries on the road per courier id (from the board). */
  load: ReadonlyMap<string, number>
  /** Trips per courier (T25): ETA, location and finished trips still to return. */
  trips?: ReadonlyMap<string, CourierTrip>
  /** Side column (desktop) or a section under the board (tablet, phone). */
  layout: 'side' | 'section'
  /** T25: the operator (and the admin) create couriers and switch them on and off. */
  canManage?: boolean
  /** Records the courier back for these deliveries ("Volvió"). */
  onReturn?: (orderIds: string[]) => Promise<void>
}

type CourierState = 'inactive' | 'road' | 'returning' | 'free'

/**
 * "Repartidores" (T12, T25): every courier with its real state — inactive,
 * on the road ("1 pedido en ruta · vuelve 19:55 · Laureles"), back on the
 * way after a finished trip ("De regreso", with "Volvió") or at the
 * restaurant ("En el local") — plus "+ Nuevo" and Activar/Desactivar for the
 * operator (the API lets the operator change only isActive), and the
 * suggested delivery fee, read-only here (an admin edits it in Administración).
 */
export function CouriersRail({ load, trips, layout, canManage = false, onReturn }: CouriersRailProps) {
  const queryClient = useQueryClient()
  const { data: couriers = [], isLoading, error } = useQuery({
    queryKey: ['couriers', 'all'],
    queryFn: () => listCouriers({ activeOnly: false }),
    staleTime: 30_000,
  })
  // Same cache slot as the new-delivery form (`NewDeliveryDialog`).
  const { data: config } = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: fetchConfig,
    staleTime: 5 * 60_000,
  })
  const [newOpen, setNewOpen] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const suggestedFee = config?.deliveryDefaultFee
  const ordered = [...couriers].sort((a, b) => Number(b.isActive) - Number(a.isActive))

  /** One request per courier at a time; the button stays disabled meanwhile. */
  const runFor = async (id: string, task: () => Promise<void>) => {
    if (busy.has(id)) return
    setBusy((prev) => new Set(prev).add(id))
    try {
      await task()
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const setActive = (id: string, name: string, isActive: boolean) =>
    runFor(id, async () => {
      try {
        await updateCourier(id, { isActive })
        toast.success(isActive ? `${name} está activo` : `${name} quedó inactivo`)
      } catch (err) {
        toast.error(
          err instanceof DeliveryServiceError && err.kind === 'not-authorized'
            ? 'No tienes permiso para cambiar repartidores'
            : 'No se pudo cambiar el repartidor. Intenta de nuevo.',
        )
      } finally {
        void queryClient.invalidateQueries({ queryKey: ['couriers'] })
      }
    })

  return (
    <section
      aria-labelledby="couriers-title"
      className={cn(
        'flex min-w-0 flex-col gap-4',
        layout === 'side' ? 'border-l border-line px-4 py-5' : 'px-4 pb-6 md:px-6',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="couriers-title" className="text-base font-semibold text-fg">
          Repartidores
        </h2>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            className={cn(PILL_BUTTON, 'px-3.5')}
            onClick={() => setNewOpen(true)}
            aria-label="Nuevo repartidor"
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Nuevo
          </Button>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive">No se pudieron cargar los repartidores.</p>
      ) : isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-card" />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-fg">
          {canManage ? 'No hay repartidores. Crea el primero con «Nuevo».' : 'No hay repartidores.'}
        </p>
      ) : (
        <ul className={cn('grid gap-2', layout === 'section' && 'sm:grid-cols-2 lg:grid-cols-3')}>
          {ordered.map((c) => {
            const trip = trips?.get(c.id)
            const onRoad = trip?.onRoad ?? load.get(c.id) ?? 0
            const toReturn = trip?.toReturn ?? []
            const state: CourierState = !c.isActive
              ? 'inactive'
              : onRoad > 0
                ? 'road'
                : toReturn.length > 0
                  ? 'returning'
                  : 'free'
            const line =
              state === 'inactive'
                ? 'No asignable'
                : trip
                  ? courierStatusLine(trip)
                  : onRoad > 0
                    ? `${onRoad} ${onRoad === 1 ? 'pedido' : 'pedidos'} en ruta`
                    : 'En el local'
            const pending = busy.has(c.id)
            // Only a manager may record the return (the server refuses others, 42501).
            const showReturn = canManage && toReturn.length > 0 && onReturn !== undefined
            const showSwitch = canManage && (state === 'inactive' || state === 'free')
            return (
              <li
                key={c.id}
                className={cn(
                  'grid min-h-14 min-w-0 gap-2 rounded-card border border-line p-2.5',
                  'bg-surface dark:bg-surface-2',
                  state === 'inactive' && 'opacity-90',
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand-strong"
                  >
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium leading-snug text-fg [overflow-wrap:anywhere]">
                      {c.name}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-fg [overflow-wrap:anywhere]">{line}</span>
                  </span>
                  <span
                    className={cn(
                      CHIP,
                      state === 'road' && 'border-status-served-line bg-status-served-bg text-status-served-fg',
                      state === 'returning' && 'border-status-warning-line bg-status-warning-bg text-status-warning-fg',
                      state === 'free' && 'border-status-free-line bg-status-free-bg text-status-free-fg',
                      state === 'inactive' && 'border-line-strong bg-surface-2 text-fg-2',
                    )}
                  >
                    {state === 'road' ? 'En ruta' : state === 'returning' ? 'De regreso' : state === 'free' ? 'Libre' : 'Inactivo'}
                  </span>
                </div>
                {(showReturn || showSwitch) && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {showReturn && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className={cn(PILL_BUTTON, 'px-3.5')}
                        disabled={pending}
                        onClick={() => void runFor(c.id, () => onReturn!(toReturn))}
                      >
                        Volvió
                      </Button>
                    )}
                    {showSwitch && (
                      <Button
                        size="sm"
                        variant={state === 'inactive' ? 'outline' : 'ghost'}
                        className={cn(PILL_BUTTON, 'px-3.5')}
                        disabled={pending}
                        aria-label={`${state === 'inactive' ? 'Activar' : 'Desactivar'} a ${c.name}`}
                        onClick={() => void setActive(c.id, c.name, state === 'inactive')}
                      >
                        {state === 'inactive' ? 'Activar' : 'Desactivar'}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {typeof suggestedFee === 'number' && (
        <div className="grid gap-1 rounded-card border border-line bg-surface p-3 dark:bg-surface-2">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-fg">Valor sugerido del domicilio</span>{' '}
            <span className={cn(MONEY, 'font-semibold text-fg')}>{formatMoney(suggestedFee)}</span>
          </p>
          <p className="text-xs text-muted-fg">
            Se precarga en cada nuevo domicilio; se puede editar por pedido. Un administrador lo
            cambia en Administración.
          </p>
        </div>
      )}

      {canManage && <NewCourierDialog open={newOpen} onOpenChange={setNewOpen} />}
    </section>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase()
}
