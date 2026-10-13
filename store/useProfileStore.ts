import { create } from 'zustand'
import type { Profile } from '@/types'

// One tile per role for the admin "Cambiar Perfil" picker, used to preview the
// other role views. Kept apart from `profiles` (the waiter directory loaded from
// the database) so loading the waiters never replaces the picker.
const roleProfiles: Profile[] = [
  { id: 'waiter-1', name: 'Mesero', full_name: 'Mesero', role: 'waiter', hasPassword: false },
  { id: 'kitchen-1', name: 'Cocina', full_name: 'Cocina', role: 'kitchen', hasPassword: true },
  { id: 'cashier-1', name: 'Caja', full_name: 'Caja', role: 'cashier', hasPassword: true },
  { id: 'admin-1', name: 'Admin', full_name: 'Admin', role: 'admin', hasPassword: true },
  { id: 'delivery-1', name: 'Domicilios', full_name: 'Domicilios', role: 'delivery_operator', hasPassword: true },
]

interface ProfileState {
  /** Waiter directory from the database, used to resolve waiter names. */
  profiles: Profile[]
  /** Role tiles shown by the "Cambiar Perfil" picker. */
  roleProfiles: Profile[]
  selectedProfile: Profile | null
  // El perfil REAL del usuario autenticado (siempre el de la DB, con UUID válido).
  // Cuando admin impersona otro rol, selectedProfile es el mock pero authProfile
  // sigue siendo el real. Los queries que necesitan un UUID válido (FK constraints)
  // deben usar authProfile.id, no selectedProfile.id.
  authProfile: Profile | null
  showProfileSelection: boolean
  setProfiles: (profiles: Profile[]) => void
  setSelectedProfile: (profile: Profile | null) => void
  setAuthProfile: (profile: Profile | null) => void
  selectProfile: (profile: Profile) => void
  changeProfile: () => void
}

export const useProfileStore = create<ProfileState>((set) => ({
  profiles: [],
  roleProfiles,
  selectedProfile: null,
  authProfile: null,
  // El picker solo se muestra cuando el admin presiona "Cambiar Perfil".
  showProfileSelection: false,

  setProfiles: (profiles) => set({ profiles }),

  setSelectedProfile: (profile) =>
    set({ selectedProfile: profile }),

  setAuthProfile: (profile) =>
    set({ authProfile: profile }),

  selectProfile: (profile) =>
    set({ selectedProfile: profile, showProfileSelection: false }),

  changeProfile: () =>
    set({ selectedProfile: null, showProfileSelection: true }),
}))