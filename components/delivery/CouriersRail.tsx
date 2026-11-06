'use client'

import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { listCouriers } from '@/lib/api/delivery'
import { CONFIG_QUERY_KEY, fetchConfig } from '@/lib/api/config'
import { CHIP, MONEY, formatMoney } from './console-ui'

interface CouriersRailProps {
  /** Deliveries on the road per courier id (from the board). */
  load: ReadonlyMap<string, number>
  /** Side column (desktop) or a section under the board (tablet, phone). */
  layout: 'side' | 'section'
}

/**
 * "Repartidores" (T12): every courier with its real state — inactive, on the
 * road (count of its deliveries out for delivery) or free — and the suggested
 * delivery fee setting, read-only here (an admin edits it in Administración).
 */
export function CouriersRail({ load, layout }: CouriersRailProps) {
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
  const suggestedFee = config?.deliveryDefaultFee
  const ordered = [...couriers].sort((a, b) => Number(b.isActive) - Number(a.isActive))

  return (
    <section
      aria-labelledby="couriers-title"
      className={cn(
        'flex min-w-0 flex-col gap-4',
        layout === 'side' ? 'border-l border-line px-4 py-5' : 'px-4 pb-6 md:px-6',
      )}
    >
      <h2 id="couriers-title" className="text-base font-semibold text-fg">
        Repartidores
      </h2>

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
          No hay repartidores. Un administrador los crea en el panel de administración.
        </p>
      ) : (
        <ul className={cn('grid gap-2', layout === 'section' && 'sm:grid-cols-2 lg:grid-cols-3')}>
          {ordered.map((c) => {
            const onRoad = load.get(c.id) ?? 0
            const state = !c.isActive ? 'inactive' : onRoad > 0 ? 'road' : 'free'
            return (
              <li
                key={c.id}
                className={cn(
                  'flex min-h-14 min-w-0 items-center gap-2.5 rounded-card border border-line p-2.5',
                  'bg-surface dark:bg-surface-2',
                  state === 'inactive' && 'opacity-75',
                )}
              >
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
                  <span className="block truncate text-xs tabular-nums text-muted-fg">
                    {state === 'inactive'
                      ? 'No asignable'
                      : state === 'road'
                        ? `${onRoad} ${onRoad === 1 ? 'pedido' : 'pedidos'} en ruta`
                        : 'Sin pedidos en ruta'}
                  </span>
                </span>
                <span
                  className={cn(
                    CHIP,
                    state === 'road' && 'border-status-served-line bg-status-served-bg text-status-served-fg',
                    state === 'free' && 'border-status-free-line bg-status-free-bg text-status-free-fg',
                    state === 'inactive' && 'border-line-strong bg-surface-2 text-fg-2',
                  )}
                >
                  {state === 'road' ? 'En ruta' : state === 'free' ? 'Libre' : 'Inactivo'}
                </span>
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
    </section>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase()
}
