"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Profile } from "@/types"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { useConfigStore } from "@/store/use-config-store"

interface PasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  onSuccess: () => void
}

export function PasswordDialog({ open, onOpenChange, profile, onSuccess }: PasswordDialogProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState(false)
  const [maskedPassword, setMaskedPassword] = useState("")
  const { kitchenPassword, cashierPassword, adminPassword, waiterPassword, loadConfigFromDB } = useConfigStore()

  // Cargar configuración al montar el componente
  useEffect(() => {
    loadConfigFromDB()
  }, [loadConfigFromDB])

  // Efecto para enmascarar la contraseña con asteriscos
  useEffect(() => {
    setMaskedPassword("•".repeat(password.length))
  }, [password])

  const handlePasswordChange = (value: string) => {
    setPassword(value)
    setError(false)
  }

  const getProfilePassword = (profileId: string): string => {
    if (profileId.startsWith("kitchen")) return kitchenPassword
    if (profileId.startsWith("cashier")) return cashierPassword
    if (profileId.startsWith("admin")) return adminPassword
    if (profileId.startsWith("waiter")) return waiterPassword
    return ""
  }

  const handleSubmit = () => {
    // Obtener la contraseña correcta para este perfil
    const correctPassword = getProfilePassword(profile.id)

    // Verificar si la contraseña es correcta
    if (correctPassword === password) {
      setError(false)
      setPassword("")
      onSuccess()
      onOpenChange(false)
    } else {
      setError(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ingrese Contraseña</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Contraseña incorrecta. Intente nuevamente.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="text-center mb-4">
              <p className="text-sm text-muted-foreground mb-2">Ingrese la contraseña para {profile.name}</p>
              <div className="h-12 flex items-center justify-center text-2xl font-mono border rounded-md bg-muted/20">
                {maskedPassword || <span className="text-muted-foreground">Ingrese PIN</span>}
              </div>
            </div>

            <NumericKeypad
              value={password}
              onValueChange={handlePasswordChange}
              maxLength={6}
              allowDecimal={false}
              className="mt-4"
              onEnter={handleSubmit}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
