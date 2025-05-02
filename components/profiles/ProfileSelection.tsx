"use client"

import { useState } from "react"
import type { Profile } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PasswordDialog } from "@/components/profiles/PasswordDialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ThemeToggle } from "@/components/theme/theme-toggle"

interface ProfileSelectionProps {
  profiles: Profile[]
  onSelectProfile: (profile: Profile) => void
}

export function ProfileSelection({ profiles, onSelectProfile }: ProfileSelectionProps) {
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)

  const handleProfileClick = (profile: Profile) => {
    setSelectedProfile(profile)

    if (profile.hasPassword) {
      setShowPasswordDialog(true)
    } else {
      onSelectProfile(profile)
    }
  }

  const handlePasswordSuccess = () => {
    if (selectedProfile && typeof onSelectProfile === "function") {
      onSelectProfile(selectedProfile)
    }
  }

  // Filtrar solo los perfiles principales (no los meseros internos)
  const mainProfiles = profiles.filter((profile) => !profile.id.startsWith("internal-"))

  // Función para obtener iniciales
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
  }

  // Función para obtener color de fondo basado en el rol
  const getRoleColor = (role: string) => {
    switch (role) {
      case "waiter":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
      case "kitchen":
        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
      case "cashier":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
      case "admin":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
    }
  }

  // Traducción de roles
  const roleTranslation: Record<string, string> = {
    waiter: "Mesero",
    kitchen: "Cocina",
    cashier: "Caja",
    admin: "Administrador",
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-3xl">
        <CardHeader className="relative">
          <CardTitle className="text-center text-2xl">Seleccionar Perfil</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap justify-center gap-8 py-6">
            {mainProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex flex-col items-center gap-2 cursor-pointer p-2 rounded-lg transition-colors hover:bg-muted"
                onClick={() => handleProfileClick(profile)}
              >
                <Avatar className="h-24 w-24 border-2 border-primary/20">
                  <AvatarFallback className={`text-xl ${getRoleColor(profile.role)}`}>
                    {getInitials(profile.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-base font-medium text-center">{profile.name}</span>
                <span className="text-xs text-muted-foreground">{roleTranslation[profile.role]}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedProfile && (
        <PasswordDialog
          open={showPasswordDialog}
          onOpenChange={setShowPasswordDialog}
          profile={selectedProfile}
          onSuccess={handlePasswordSuccess}
        />
      )}
    </div>
  )
}
