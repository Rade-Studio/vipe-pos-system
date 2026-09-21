"use client"

import { Button } from "@/components/ui/button"
import { LogOut, UserCog } from "lucide-react"
import type { Profile } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { supabase } from "@/lib/supabase/client"

interface HeaderProps {
  profile: Profile
  onChangeProfile: () => void
  // El rol REAL del usuario autenticado (no el impersonado).
  // Cuando es admin, mostramos "Cambiar Perfil" para que pueda cambiar de rol
  // incluso desde una vista impersonada (mesero, cocina, etc.).
  authRole?: string
  title?: string
}

export function Header({ profile, onChangeProfile, authRole, title = "VibePOS" }: HeaderProps) {
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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    // Hard reload to clear all client state (stores, queries, realtime subs)
    window.location.href = "/"
  }

  return (
    <header className="flex justify-between items-center mb-6 sticky top-0 z-10 bg-background pb-2 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="hidden sm:flex flex-col items-end">
          <span className="font-medium">{profile.name}</span>
          <span className="text-xs text-muted-foreground">{getRoleLabel(profile.role)}</span>
        </div>
        {/* "Cambiar Perfil" solo para admin (rol real, no el impersonado).
            Es la única forma de que admin previsualice las otras vistas
            sin deslogearse, incluso desde una vista impersonada. */}
        {authRole === "admin" && (
          <Button variant="outline" size="sm" onClick={onChangeProfile}>
            <UserCog className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Cambiar Perfil</span>
            <span className="sm:hidden">Cambiar</span>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Cerrar Sesión</span>
          <span className="sm:hidden">Salir</span>
        </Button>
      </div>
    </header>
  )
}