"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { KeyRound, LogOut, UserCog } from "lucide-react"
import { ChangeOwnPinDialog } from "@/components/auth/ChangeOwnPinDialog"
import type { Profile } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { signOutAndReload } from "@/lib/api/auth"
import { roleLabel } from "@/lib/auth/roles"
import { useTerminal } from "@/components/terminal/terminal-context"
import { countdown } from "@/lib/terminal/format"

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

  // F4b: on a shared terminal this same header shows who is identified, and
  // "Salir" asks an admin or cashier PIN first; nobody changes a PIN there.
  const terminal = useTerminal()
  // Revokes the API session, then a hard reload clears stores, queries and realtime subs.
  const handleLogout = () => (terminal ? terminal.requestLogout() : signOutAndReload())
  // F4: every role changes its own PIN here.
  const [pinOpen, setPinOpen] = useState(false)
  const identity = terminal?.identity

  return (
    // S6: below sm the actions are icon-only 44 px buttons (full name in aria-label/title) so a 360 px phone never overflows.
    <header className="sticky top-0 z-10 mb-2 flex min-w-0 items-center justify-between gap-2 bg-background pb-2 pt-2 sm:mb-6 sm:pt-4">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <ThemeToggle />
        {terminal ? (
          identity ? (
            <>
              <span
                role="status"
                aria-label={`${identity.name} identificado, quedan ${countdown(identity.deadline - terminal.now)}`}
                className="whitespace-nowrap font-medium"
              >
                {identity.name.split(/\s+/)[0]} · <span className="tabular-nums">{countdown(identity.deadline - terminal.now)}</span>
              </span>
              <Button variant="outline" size="sm" className="min-h-11" onClick={terminal.endIdentity}>
                Terminar
              </Button>
            </>
          ) : (
            <span className="hidden whitespace-nowrap text-sm text-muted-foreground lg:inline">Terminal compartida</span>
          )
        ) : (
          <div className="hidden sm:flex flex-col items-end">
            <span className="font-medium">{profile.name}</span>
            <span className="text-xs text-muted-foreground">{getRoleLabel(profile.role)}</span>
          </div>
        )}
        {/* "Cambiar Perfil" solo para admin (rol real, no el impersonado).
            Es la única forma de que admin previsualice las otras vistas
            sin deslogearse, incluso desde una vista impersonada. */}
        {authRole === "admin" && (
          <Button variant="outline" size="sm" className="min-h-11 min-w-11" aria-label="Cambiar Perfil" title="Cambiar Perfil" onClick={onChangeProfile}>
            <UserCog className="h-4 w-4 sm:mr-2" aria-hidden />
            <span className="hidden sm:inline">Cambiar Perfil</span>
          </Button>
        )}
        {!terminal && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            aria-label="Cambiar mi PIN"
            title="Cambiar mi PIN"
            onClick={() => setPinOpen(true)}
          >
            <KeyRound className="h-4 w-4 sm:mr-2" aria-hidden />
            <span className="hidden sm:inline">Cambiar mi PIN</span>
          </Button>
        )}
        <Button variant="outline" size="sm" className="min-h-11 min-w-11" aria-label="Cerrar Sesión" title="Cerrar Sesión" onClick={handleLogout}>
          <LogOut className="h-4 w-4 sm:mr-2" aria-hidden />
          <span className="hidden sm:inline">Cerrar Sesión</span>
        </Button>
      </div>
      {!terminal && <ChangeOwnPinDialog open={pinOpen} onOpenChange={setPinOpen} who={`${profile.name} · ${getRoleLabel(profile.role)}`} />}
    </header>
  )
}