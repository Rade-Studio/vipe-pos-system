"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { KeyRound, LogOut, UserCog } from "lucide-react"
import { ChangeOwnPinDialog } from "@/components/auth/ChangeOwnPinDialog"
import type { Profile } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { signOutAndReload } from "@/lib/api/auth"
import { roleLabel } from "@/lib/auth/roles"

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
  const getRoleLabel = (role: string) => roleLabel(role) ?? role

  // Revokes the API session, then a hard reload clears stores, queries and realtime subs.
  const handleLogout = () => signOutAndReload()
  // F4: every role changes its own PIN here (a shared terminal shows its own bar instead of this header).
  const [pinOpen, setPinOpen] = useState(false)

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
        <Button variant="outline" size="sm" aria-label="Cambiar mi PIN" onClick={() => setPinOpen(true)}>
          <KeyRound className="h-4 w-4 sm:mr-2" aria-hidden />
          <span className="hidden sm:inline">Cambiar mi PIN</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Cerrar Sesión</span>
          <span className="sm:hidden">Salir</span>
        </Button>
      </div>
      <ChangeOwnPinDialog open={pinOpen} onOpenChange={setPinOpen} who={`${profile.name} · ${getRoleLabel(profile.role)}`} />
    </header>
  )
}