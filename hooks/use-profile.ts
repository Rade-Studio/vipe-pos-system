"use client"

import { useProfileStore } from "@/store/useProfileStore"

export function useProfile() {
  const profiles = useProfileStore((s) => s.profiles)
  const selectedProfile = useProfileStore((s) => s.selectedProfile)
  const showProfileSelection = useProfileStore((s) => s.showProfileSelection)
  const selectProfile = useProfileStore((s) => s.selectProfile)
  const changeProfile = useProfileStore((s) => s.changeProfile)

  return {
    profiles,
    selectedProfile,
    showProfileSelection,
    selectProfile,
    changeProfile,
  }
}
