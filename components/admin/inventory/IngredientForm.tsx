"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"

// Unidades de medida comunes en restaurantes
const UNITS = [
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "g", label: "Gramos (g)" },
  { value: "l", label: "Litros (l)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "unidad", label: "Unidad" },
  { value: "docena", label: "Docena" },
  { value: "caja", label: "Caja" },
  { value: "botella", label: "Botella" },
  { value: "lata", label: "Lata" },
  { value: "paquete", label: "Paquete" },
  { value: "bolsa", label: "Bolsa" },
  { value: "porción", label: "Porción" },
  { value: "oz", label: "Onzas (oz)" },
  { value: "lb", label: "Libras (lb)" },
  { value: "cucharada", label: "Cucharada" },
  { value: "cucharadita", label: "Cucharadita" },
  { value: "taza", label: "Taza" },
]

interface IngredientFormProps {
  onSuccess?: () => void
  ingredient?: any
}

export function IngredientForm({ onSuccess, ingredient }: IngredientFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([])
  const [formData, setFormData] = useState({
    name: ingredient?.name || "",
    description: ingredient?.description || "",
    stock: ingredient?.stock || 0,
    unit: ingredient?.unit || "unidad",
    min_stock: ingredient?.min_stock || 0,
    category: "",
    cost: ingredient?.cost || 0,
  })
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({}) // Mapa de nombre a ID

  // Cargar categorías de ingredientes
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase.from("ingredient_categories").select("id, name").order("name")

        if (error) throw error

        // Crear un mapa de nombre a ID para buscar el ID por nombre
        const nameToIdMap: Record<string, string> = {}
        data.forEach((cat: any) => {
          nameToIdMap[cat.name] = cat.id
        })
        setCategoryMap(nameToIdMap)

        setCategories(
          data.map((cat: any) => ({
            value: cat.id,
            label: cat.name,
          })),
        )

        // Si no hay categorías, crear algunas por defecto
        if (data.length === 0) {
          const defaultCategories = [
            { name: "Carnes", description: "Carnes y productos cárnicos" },
            { name: "Lácteos", description: "Leche y productos lácteos" },
            { name: "Frutas", description: "Frutas frescas" },
            { name: "Verduras", description: "Verduras y hortalizas" },
            { name: "Granos", description: "Granos y cereales" },
            { name: "Condimentos", description: "Especias y condimentos" },
            { name: "Bebidas", description: "Bebidas y líquidos" },
            { name: "Otros", description: "Otros ingredientes" },
          ]

          for (const category of defaultCategories) {
            await supabase.from("ingredient_categories").insert(category)
          }

          // Volver a cargar las categorías
          const { data: newData } = await supabase.from("ingredient_categories").select("id, name").order("name")

          // Actualizar el mapa de nombre a ID
          const newNameToIdMap: Record<string, string> = {}
          newData.forEach((cat: any) => {
            newNameToIdMap[cat.name] = cat.id
          })
          setCategoryMap(newNameToIdMap)

          setCategories(
            newData.map((cat: any) => ({
              value: cat.id,
              label: cat.name,
            })),
          )
        }
      } catch (error: any) {
        console.error("Error loading categories:", error)
        toast({
          variant: "destructive",
          title: "Error",
          description: `Error al cargar categorías: ${error.message}`,
        })
      }
    }

    fetchCategories()
  }, [toast])

  // Cuando se carguen las categorías y haya un ingrediente para editar, buscar el ID de la categoría
  useEffect(() => {
    if (ingredient && Object.keys(categoryMap).length > 0) {
      // Si el ingrediente tiene category_id, usarlo directamente
      if (ingredient.category_id) {
        setFormData((prev) => ({ ...prev, category: ingredient.category_id }))
      }
      // Si el ingrediente tiene una categoría que es un nombre, buscar su ID
      else if (ingredient.category && categoryMap[ingredient.category]) {
        setFormData((prev) => ({ ...prev, category: categoryMap[ingredient.category] }))
      }
      // Si no se encuentra, dejar vacío
      else {
        setFormData((prev) => ({ ...prev, category: "" }))
      }

      console.log("Categoría seleccionada:", ingredient.category_id || categoryMap[ingredient.category] || "")
    }
  }, [ingredient, categoryMap])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Asegurarse de que la categoría no sea vacía
      const categoryValue = formData.category || null

      if (ingredient?.id) {
        // Actualizar ingrediente existente
        const { error } = await supabase
          .from("ingredients")
          .update({
            name: formData.name,
            description: formData.description,
            // No actualizamos el stock aquí, se maneja a través de transacciones
            unit: formData.unit,
            min_stock: Number(formData.min_stock),
            category_id: categoryValue, // Usar category_id en lugar de category
            cost: Number(formData.cost),
            updated_at: new Date().toISOString(),
          })
          .eq("id", ingredient.id)

        if (error) throw error

        toast({
          title: "Ingrediente actualizado",
          description: `El ingrediente ${formData.name} ha sido actualizado correctamente.`,
        })
      } else {
        // Crear nuevo ingrediente
        const { error } = await supabase.from("ingredients").insert({
          name: formData.name,
          description: formData.description,
          stock: 0, // Iniciar con stock en 0
          unit: formData.unit,
          min_stock: Number(formData.min_stock),
          category_id: categoryValue, // Usar category_id en lugar de category
          cost: Number(formData.cost),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

        if (error) throw error

        toast({
          title: "Ingrediente creado",
          description: `El ingrediente ${formData.name} ha sido creado correctamente.`,
        })

        // Limpiar formulario
        setFormData({
          name: "",
          description: "",
          stock: 0,
          unit: "unidad",
          min_stock: 0,
          category: "",
          cost: 0,
        })
      }

      if (onSuccess) {
        onSuccess()
      }
    } catch (error: any) {
      console.error("Error saving ingredient:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al guardar el ingrediente: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

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
            placeholder="Nombre del ingrediente"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Categoría</Label>
          <Select value={formData.category} onValueChange={(value) => handleSelectChange("category", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar categoría" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Descripción del ingrediente"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label htmlFor="unit">Unidad de Medida</Label>
            <Select value={formData.unit} onValueChange={(value) => handleSelectChange("unit", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar unidad" />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {ingredient && (
            <div className="space-y-2">
              <Label htmlFor="stock">Stock Actual (No editable)</Label>
              <Input id="stock" name="stock" type="number" value={formData.stock} disabled className="bg-gray-100" />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="min_stock">Stock Mínimo</Label>
          <Input
            id="min_stock"
            name="min_stock"
            type="number"
            value={formData.min_stock}
            onChange={handleChange}
            min="0"
            step="0.01"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cost">Costo por {formData.unit}</Label>
          <Input
            id="cost"
            name="cost"
            type="number"
            value={formData.cost}
            onChange={handleChange}
            min="0"
            step="0.01"
            placeholder={`Costo por ${formData.unit}`}
          />
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-4">
        {loading ? "Guardando..." : ingredient?.id ? "Actualizar Ingrediente" : "Crear Ingrediente"}
      </Button>
    </form>
  )
}
