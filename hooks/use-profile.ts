"use client"

import { useState, useEffect } from "react"
import {Profile, ProfileRole} from "@/types"
import {usePOSStore} from "@/store/use-pos-store";

// Mock data for profiles - ahora con un solo perfil de mesero
const profiles: Profile[] = [
  { id: "waiter-1", name: "Mesero", role: "waiter", hasPassword: false },
  { id: "kitchen-1", name: "Cocina", role: "kitchen", hasPassword: true },
  { id: "cashier-1", name: "Caja", role: "cashier", hasPassword: true },
  { id: "admin-1", name: "Admin", role: "admin", hasPassword: true },
]

export function useProfile() {
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [showProfileSelection, setShowProfileSelection] = useState(true)

  // Select profile
  const selectProfile = (profile: Profile) => {
    setSelectedProfile(profile)
    setShowProfileSelection(false)
  }

  // Change profile
  const changeProfile = () => {
    setSelectedProfile(null)
    setShowProfileSelection(true)
    setSelectedProfile(null)
  }

  return {
    profiles,
    selectedProfile,
    showProfileSelection,
    selectProfile,
    changeProfile,
  }
}
