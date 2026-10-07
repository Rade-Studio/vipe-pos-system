import { create } from 'zustand'
import type { Profile } from '@/types'

// Mock data for profiles — represents the locally-selected active profile session.
// Used by admin (via "Cambiar Perfil") to preview other role UIs.
const mockProfiles: Profile[] = [
  { id: 'waiter-1', name: 'Mesero', full_name: 'Mesero', role: 'waiter', hasPassword: false },
  { id: 'kitchen-1', name: 'Cocina', full_name: 'Cocina', role: 'kitchen', hasPassword: true },
  { id: 'cashier-1', name: 'Caja', full_name: 'Caja', role: 'cashier', hasPassword: true },
  { id: 'admin-1', name: 'Admin', full_name: 'Admin', role: 'admin', hasPassword: true },
]

interface ProfileState {
  profiles: Profile[]
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
  profiles: mockProfiles,
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