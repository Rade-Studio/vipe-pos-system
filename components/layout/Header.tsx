"use client"

import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"
import type { Profile } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"

interface HeaderProps {
  profile: Profile
  onChangeProfile: () => void
  title?: string
}

export function Header({ profile, onChangeProfile, title = "VibePOS" }: HeaderProps) {
  const getRoleLabel = (role: string) => {
    switch (role) {
      case "waiter":
        return "Mesero"
      case "kitchen":
        return "Cocina"
      case "cashier":
        return "Caja"
      case "admin":
        return "Administrador"
      default:
        return role
    }
  }

  return (
    <header className="flex justify-between items-center mb-6 sticky top-0 z-10 bg-background pb-2 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <div className="hidden sm:flex flex-col items-end">
          <span className="font-medium">{profile.name}</span>
          <span className="text-xs text-muted-foreground">{getRoleLabel(profile.role)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={onChangeProfile}>
          <LogOut className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Cambiar Perfil</span>
          <span className="sm:hidden">Salir</span>
        </Button>
      </div>
    </header>
  )
}
