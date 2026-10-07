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

interface WaiterFormProps {
  waiter?: {
    id: string
    full_name: string
    username: string
    email: string | null
    active: boolean
    role: "waiter" | "delivery_operator"
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
    active: waiter?.active ?? true,
    // Editing keeps the current role; a new member defaults to 'waiter'.
    // Other roles are still managed outside of this form.
    role: (waiter?.role ?? "waiter") as "waiter" | "delivery_operator",
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
    if (value === "waiter" || value === "delivery_operator") {
      setFormData((prev) => ({ ...prev, role: value }))
    }
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
        // profiles.password was dropped (migration 20250917090007). Email and
        // password sign-in is a Supabase Auth account this form does not create.
        const { error } = await supabase.from("profiles").insert({
          full_name: formData.full_name,
          username: formData.username,
          email: formData.email || null,
          role: formData.role,
          active: formData.active,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

        if (error) throw error

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
        description: error.message || "Ha ocurrido un error",
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
          <Label htmlFor="email">Email (opcional)</Label>
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

        <p className="text-sm text-muted-foreground md:self-end">
          El acceso con correo y contraseña se crea aparte, como usuario de autenticación.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="role">Rol</Label>
          <Select value={formData.role} onValueChange={handleRoleChange}>
            <SelectTrigger id="role">
              <SelectValue placeholder="Selecciona un rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="waiter">Mesero</SelectItem>
              <SelectItem value="delivery_operator">Operador de domicilios</SelectItem>
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
