"use client"

import type React from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"

interface CategoryFormProps {
  formData: any
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent) => void
  handleSelectChange: (name: string, value: string) => void
  handleSwitchChange: (name: string, checked: boolean) => void
  IconSelector: React.ComponentType<any>
  loading: boolean
  category: any
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  formData,
  handleChange,
  handleSubmit,
  handleSelectChange,
  handleSwitchChange,
  IconSelector,
  loading,
  category,
}) => {
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Nombre de la categoría"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Descripción de la categoría"
            rows={3}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="icon">Icono</Label>
          <IconSelector value={formData.icon} onChange={(value) => handleSelectChange("icon", value)} />
        </div>

        <div className="flex items-center space-x-2 md:mt-8">
          <Switch
            id="active"
            checked={formData.active}
            onCheckedChange={(checked) => handleSwitchChange("active", checked)}
          />
          <Label htmlFor="active">Activo</Label>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-4">
        {loading ? "Guardando..." : category ? "Actualizar Categoría" : "Crear Categoría"}
      </Button>
    </form>
  )
}

export default CategoryForm
