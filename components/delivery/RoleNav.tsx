'use client'

import { ChefHat, LayoutGrid, Settings, Truck, Wallet, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProfileStore } from '@/store/useProfileStore'
import type { Profile } from '@/types'
import { FOCUS_RING } from './console-ui'

const TILES: ReadonlyArray<{ role: Profile['role']; label: string; icon: LucideIcon }> = [
  { role: 'waiter', label: 'Mesas', icon: LayoutGrid },
  { role: 'kitchen', label: 'Cocina', icon: ChefHat },
  { role: 'cashier', label: 'Caja', icon: Wallet },
  { role: 'admin', label: 'Admin', icon: Settings },
  { role: 'delivery_operator', label: 'Domicilios', icon: Truck },
]

/**
 * Role nav of the dispatch console (T25): only for a user with more than one
 * role view (the admin, whose "Cambiar Perfil" previews every role). Each tile
 * selects the same role profile the picker would. Bottom bar on phones, a
 * pill row from 768 px.
 */
export function RoleNav() {
  const roleProfiles = useProfileStore((s) => s.roleProfiles)
  const selectProfile = useProfileStore((s) => s.selectProfile)
  const pick = (role: Profile['role']) => {
    const profile = roleProfiles.find((p) => p.role === role)
    if (profile) selectProfile(profile)
  }
  return (
    <nav
      aria-label="Vistas"
      className={cn(
        'z-30 border-line bg-canvas/95 backdrop-blur',
        'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:border-t max-md:px-2 max-md:pb-[calc(6px+env(safe-area-inset-bottom))] max-md:pt-1.5',
        'md:px-6 md:pb-2',
      )}
    >
      <ul className="grid grid-cols-5 gap-1 md:flex md:flex-wrap md:gap-1.5">
        {TILES.map(({ role, label, icon: Icon }) => {
          const current = role === 'delivery_operator'
          return (
            <li key={role} className="min-w-0">
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => (current ? undefined : pick(role))}
                className={cn(
                  'flex w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[11.5px] font-medium',
                  'min-h-[52px] md:min-h-10 md:flex-row md:gap-1.5 md:rounded-pill md:px-3.5 md:text-sm',
                  current ? 'border-brand-line bg-brand-tint text-brand-strong' : 'border-transparent text-muted-fg hover:bg-surface-2 hover:text-fg',
                  FOCUS_RING,
                )}
              >
                <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
