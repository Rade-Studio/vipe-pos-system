"use client"

import type React from "react"

import { useState } from "react"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { StaffServiceError, createStaffAccount, type StaffRole } from "@/lib/supabase/staff-service"

const STAFF_ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "waiter", label: "Mesero" },
  { value: "kitchen", label: "Cocina" },
  { value: "cashier", label: "Caja" },
  { value: "delivery_operator", label: "Operador de domicilios" },
]

interface WaiterFormProps {
  waiter?: {
    id: string
    full_name: string
    username: string
    email: string | null
    active: boolean
    role: StaffRole
  }
  onSuccess: () => void
  onCancel: () => void
}

export function WaiterForm({ waiter, onSuccess, onCancel }: WaiterFormProps) {
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    full_name: waiter?.full_name || "",
    username: waiter?.username || "",
    email: waiter?.email || "",
    password: "",
    active: waiter?.active ?? true,
    // Editing keeps the current role; a new member defaults to 'waiter'.
    role: (waiter?.role ?? "waiter") as StaffRole,
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

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
        // Actualizar integrante existente
        const updateData = {
          full_name: formData.full_name,
          username: formData.username,
          email: formData.email || null,
          active: formData.active,
          role: formData.role,
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase.from("profiles").update(updateData).eq("id", waiter.id)

        if (error) throw error

        toast({
          title: "Personal actualizado",
          description: "El integrante del personal ha sido actualizado correctamente",
        })
      } else {
        // The Edge Function creates the auth user (the DB trigger creates the
        // profile); username is not part of the auth payload, so set it after.
        const created = await createStaffAccount({
          email: formData.email,
          password: formData.password,
          fullName: formData.full_name,
          role: formData.role,
        })

        const { error } = await supabase
          .from("profiles")
          .update({ username: formData.username, active: formData.active, updated_at: new Date().toISOString() })
          .eq("id", created.id)

        // The account already exists: a retry would only hit "duplicate", so
        // report the partial save and let the admin fix it from the edit form.
        if (error) {
          log.error("Staff created but username/active not saved:", { error: String(error) })
          toast({
            title: "Personal creado con datos incompletos",
            description: "La cuenta se creó, pero no se guardaron el usuario ni el estado. Edítelo desde la lista.",
            variant: "destructive",
          })
        } else {
          toast({
            title: "Personal creado",
            description: "El integrante del personal ha sido creado correctamente",
          })
        }
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
          <Label htmlFor="email">{waiter ? "Email (opcional)" : "Email"}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Email"
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
