"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"

interface WaiterFormProps {
  waiter?: {
    id: string
    full_name: string
    username: string
    email: string | null
    active: boolean
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

    if (!waiter && !formData.password.trim()) {
      newErrors.password = "La contraseña es obligatoria para nuevos meseros"
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setLoading(true)

    try {
      if (waiter) {
        // Actualizar mesero existente
        const updateData: any = {
          full_name: formData.full_name,
          username: formData.username,
          email: formData.email || null,
          active: formData.active,
          updated_at: new Date().toISOString(),
        }

        // Solo incluir password si se ha proporcionado uno nuevo
        if (formData.password.trim()) {
          updateData.password = formData.password
        }

        const { error } = await supabase.from("profiles").update(updateData).eq("id", waiter.id)

        if (error) throw error

        toast({
          title: "Mesero actualizado",
          description: "El mesero ha sido actualizado correctamente",
        })
      } else {
        // Crear nuevo mesero
        const { error } = await supabase.from("profiles").insert({
          full_name: formData.full_name,
          username: formData.username,
          email: formData.email || null,
          password: formData.password,
          role: "waiter",
          active: formData.active,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

        if (error) throw error

        toast({
          title: "Mesero creado",
          description: "El mesero ha sido creado correctamente",
        })
      }

      onSuccess()
    } catch (error: any) {
      console.error("Error:", error)
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

        <div className="space-y-2">
          <Label htmlFor="password">{waiter ? "Nueva contraseña (opcional)" : "Contraseña"}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            placeholder={waiter ? "Dejar en blanco para mantener la actual" : "Contraseña"}
          />
          {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center space-x-2">
          <Switch id="active" checked={formData.active} onCheckedChange={handleSwitchChange} />
          <Label htmlFor="active">Activo</Label>
        </div>

        <div className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando..." : waiter ? "Actualizar" : "Crear"}
          </Button>
        </div>
      </div>
    </form>
  )
}
