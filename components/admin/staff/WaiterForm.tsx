"use client"

import type React from "react"

import { useState } from "react"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  StaffServiceError,
  createStaffAccount,
  setStaffPassword,
  updateStaff,
  type StaffMember,
  type StaffRole,
} from "@/lib/api/staff"

const STAFF_ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "waiter", label: "Mesero" },
  { value: "kitchen", label: "Cocina" },
  { value: "cashier", label: "Caja" },
  { value: "delivery_operator", label: "Operador de domicilios" },
]

interface WaiterFormProps {
  waiter?: StaffMember
  onSuccess: () => void
  onCancel: () => void
}

export function WaiterForm({ waiter, onSuccess, onCancel }: WaiterFormProps) {
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    full_name: waiter?.fullName || "",
    username: waiter?.username || "",
    email: waiter?.email || "",
    password: "",
    active: waiter?.active ?? true,
    // Editing keeps the current role; a new member defaults to 'waiter'.
    role: (waiter?.role ?? "waiter") as StaffRole,
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [newPassword, setNewPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.full_name.trim()) {
      newErrors.full_name = "El nombre es obligatorio"
    }

    if (!formData.username.trim()) {
      newErrors.username = "El nombre de usuario es obligatorio"
    }

    if (!waiter) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
        newErrors.email = "Ingresa un correo electrónico válido"
      }
      if (formData.password.length < 8) {
        newErrors.password = "La contraseña debe tener al menos 8 caracteres"
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, active: checked }))
  }

  const handleRoleChange = (value: string) => {
    const option = STAFF_ROLE_OPTIONS.find((o) => o.value === value)
    if (option) setFormData((prev) => ({ ...prev, role: option.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setLoading(true)

    try {
      if (waiter) {
        // PATCH takes no email: the login email cannot change.
        await updateStaff(waiter.id, {
          fullName: formData.full_name,
          username: formData.username,
          active: formData.active,
          role: formData.role,
        })

        toast({
          title: "Personal actualizado",
          description: "El integrante del personal ha sido actualizado correctamente",
        })
      } else {
        // One transaction on the API: login and profile with username and state.
        await createStaffAccount({
          email: formData.email,
          password: formData.password,
          fullName: formData.full_name,
          role: formData.role,
          username: formData.username,
          active: formData.active,
        })

        toast({
          title: "Personal creado",
          description: "El integrante del personal ha sido creado correctamente",
        })
      }

      onSuccess()
    } catch (error: any) {
      log.error("Error:", { error: String(error) })
      toast({
        title: "Error",
        description:
          error instanceof StaffServiceError ? error.message : error.message || "Ha ocurrido un error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!waiter) return
    if (newPassword.length < 8) {
      setPasswordError("La contraseña debe tener al menos 8 caracteres")
      return
    }
    setPasswordError(null)
    setResetting(true)
    try {
      await setStaffPassword(waiter.id, newPassword)
      setNewPassword("")
      toast({
        title: "Contraseña actualizada",
        description: "Las sesiones abiertas del integrante se cerraron.",
      })
    } catch (error: any) {
      log.error("Error resetting staff password:", { error: String(error) })
      toast({
        title: "Error",
        description: error instanceof StaffServiceError ? error.message : "No se pudo cambiar la contraseña",
        variant: "destructive",
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Nombre completo</Label>
          <Input
            id="full_name"
            name="full_name"
            value={formData.full_name}
            onChange={handleChange}
            placeholder="Nombre completo"
          />
          {errors.full_name && <p className="text-sm text-red-500">{errors.full_name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">Nombre de usuario</Label>
          <Input
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="Nombre de usuario"
          />
          {errors.username && <p className="text-sm text-red-500">{errors.username}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Email"
            readOnly={!!waiter}
            className={waiter ? "bg-muted" : undefined}
          />
          {errors.email && <p className="text-sm text-red-500">{errors.email}</p>}
        </div>

        {!waiter && (
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 8 caracteres"
            />
            {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="role">Rol</Label>
          <Select value={formData.role} onValueChange={handleRoleChange}>
            <SelectTrigger id="role">
              <SelectValue placeholder="Selecciona un rol" />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center space-x-2">
          <Switch id="active" checked={formData.active} onCheckedChange={handleSwitchChange} />
          <Label htmlFor="active">Activo</Label>
        </div>
      </div>

      {/* A legacy profile without login has no password to reset. */}
      {waiter && waiter.userId !== null && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="new_password">Nueva contraseña</Label>
          <div className="flex gap-2">
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
            <Button type="button" variant="outline" onClick={handleResetPassword} disabled={resetting}>
              Restablecer contraseña
            </Button>
          </div>
          {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
          <p className="text-xs text-muted-foreground">Cierra las sesiones abiertas del integrante.</p>
        </div>
      )}

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : waiter ? "Actualizar" : "Crear"}
        </Button>
      </div>
    </form>
  )
}
