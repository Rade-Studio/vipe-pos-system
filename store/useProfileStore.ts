import { create } from 'zustand'
import type { Profile } from '@/types'

// Mock data for profiles — represents the locally-selected active profile session
const mockProfiles: Profile[] = [
  { id: 'waiter-1', name: 'Mesero', full_name: 'Mesero', role: 'waiter', hasPassword: false },
  { id: 'kitchen-1', name: 'Cocina', full_name: 'Cocina', role: 'kitchen', hasPassword: true },
  { id: 'cashier-1', name: 'Caja', full_name: 'Caja', role: 'cashier', hasPassword: true },
  { id: 'admin-1', name: 'Admin', full_name: 'Admin', role: 'admin', hasPassword: true },
]

interface ProfileState {
  profiles: Profile[]
  selectedProfile: Profile | null
  showProfileSelection: boolean
  setSelectedProfile: (profile: Profile | null) => void
  selectProfile: (profile: Profile) => void
  changeProfile: () => void
}

export const useProfileStore = create<ProfileState>((set) => ({
  profiles: mockProfiles,
  selectedProfile: null,
  showProfileSelection: true,

  setSelectedProfile: (profile) =>
    set({ selectedProfile: profile }),

  selectProfile: (profile) =>
    set({ selectedProfile: profile, showProfileSelection: false }),

  changeProfile: () =>
    set({ selectedProfile: null, showProfileSelection: true }),
}))
