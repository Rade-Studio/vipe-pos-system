"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import ingredientTransactionService from "@/lib/supabase/ingredient-transaction-service"
import { formatCurrency } from "@/utils/helpers"

interface StockTransactionFormProps {
  ingredientId?: string
  onSuccess?: () => void
}

export function StockTransactionForm({ ingredientId, onSuccess }: StockTransactionFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [ingredients, setIngredients] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [selectedIngredient, setSelectedIngredient] = useState<any>(null)

  const [formData, setFormData] = useState({
    ingredient_id: ingredientId || "",
    quantity: 0,
    total_cost: 0,
    transaction_type: "entrada",
    payment_status: "pagado",
    notes: "",
  })

  // Cargar categorías
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase.from("ingredient_categories").select("*").order("name")
        if (error) throw error
        setCategories(data || [])
      } catch (error: any) {
        log.error("Error loading categories:", { error: String(error) })
      }
    }

    fetchCategories()
  }, [])

  // Cargar ingredientes
  useEffect(() => {
    const fetchIngredients = async () => {
      try {
        // Consulta simple sin join para evitar errores de relación
        const { data, error } = await supabase.from("ingredients").select("*").order("name")

        if (error) throw error

        // Si tenemos categorías, enriquecemos los ingredientes con los nombres de categoría
        if (categories.length > 0) {
          const enrichedIngredients =
            data?.map((ingredient) => {
              const category = categories.find((cat) => cat.id === ingredient.category_id)
              return {
                ...ingredient,
                categoryName: category ? category.name : "Sin categoría",
              }
            }) || []

          setIngredients(enrichedIngredients)
        } else {
          setIngredients(data || [])
        }

        // Si hay un ingredientId preseleccionado, buscar ese ingrediente
        if (ingredientId) {
          const ingredient = data?.find((ing) => ing.id === ingredientId)
          if (ingredient) {
            const category = categories.find((cat) => cat.id === ingredient.category_id)
            setSelectedIngredient({
              ...ingredient,
              categoryName: category ? category.name : "Sin categoría",
            })
          }
        }
      } catch (error: any) {
        log.error("Error loading ingredients:", { error: String(error) })
        toast({
          variant: "destructive",
          title: "Error",
          description: `Error al cargar ingredientes: ${error.message}`,
        })
      }
    }

    fetchIngredients()
  }, [ingredientId, categories, toast])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (name: string, value: string) => {
    if (name === "ingredient_id") {
      const ingredient = ingredients.find((ing) => ing.id === value)
      setSelectedIngredient(ingredient)
    }

    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const calculateUnitCost = () => {
    if (!formData.quantity || !formData.total_cost) return 0
    return Number(formData.total_cost) / Number(formData.quantity)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.ingredient_id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debe seleccionar un ingrediente",
      })
      return
    }

    if (!formData.quantity || formData.quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "La cantidad debe ser mayor que cero",
      })
      return
    }

    setLoading(true)

    try {
      const unitCost = calculateUnitCost()

      // Crear la transacción usando el servicio
      await ingredientTransactionService.create({
        ingredient_id: formData.ingredient_id,
        quantity: Number(formData.quantity),
        total_cost: Number(formData.total_cost || 0),
        unit_cost: unitCost || 0,
        transaction_type: formData.transaction_type as "entrada" | "salida" | "ajuste",
        payment_status: formData.payment_status as "pagado" | "pendiente" | "ajustado" | "eliminado",
        notes: formData.notes,
      })

      // Actualizar el stock del ingrediente
      const currentStock = selectedIngredient?.stock || 0
      let newStock = currentStock

      if (formData.transaction_type === "entrada") {
        newStock = currentStock + Number(formData.quantity)
      } else if (formData.transaction_type === "salida") {
        newStock = Math.max(0, currentStock - Number(formData.quantity))
      } else if (formData.transaction_type === "ajuste") {
        newStock = Number(formData.quantity)
      }

      // Actualizar el costo del ingrediente si es una entrada
      const updateData: any = { stock: newStock }
      if (formData.transaction_type === "entrada" && unitCost > 0) {
        updateData.cost = unitCost
      }

      const { error: updateError } = await supabase
        .from("ingredients")
        .update(updateData)
        .eq("id", formData.ingredient_id)

      if (updateError) throw updateError

      toast({
        title: "Transacción registrada",
        description: `Se ha registrado correctamente la transacción de stock.`,
      })

      // Limpiar formulario
      setFormData({
        ingredient_id: ingredientId || "",
        quantity: 0,
        total_cost: 0,
        transaction_type: "entrada",
        payment_status: "pagado",
        notes: "",
      })

      if (onSuccess) {
        onSuccess()
      }
    } catch (error: any) {
      log.error("Error registering transaction:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al registrar la transacción: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ingredient_id">Ingrediente</Label>
          <Select
            value={formData.ingredient_id}
            onValueChange={(value) => handleSelectChange("ingredient_id", value)}
            disabled={!!ingredientId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar ingrediente" />
            </SelectTrigger>
            <SelectContent>
              {ingredients.map((ingredient) => (
                <SelectItem key={ingredient.id} value={ingredient.id}>
                  {ingredient.name} ({ingredient.unit}) - {ingredient.categoryName || "Sin categoría"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transaction_type">Tipo de Transacción</Label>
          <Select
            value={formData.transaction_type}
            onValueChange={(value) => handleSelectChange("transaction_type", value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="entrada">Entrada de Stock</SelectItem>
              <SelectItem value="salida">Salida de Stock</SelectItem>
              <SelectItem value="ajuste">Ajuste de Inventario</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedIngredient && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Stock Actual</Label>
            <div className="p-2 border rounded-md">
              {selectedIngredient.stock} {selectedIngredient.unit.toUpperCase()}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Costo Actual</Label>
            <div className="p-2 border rounded-md">
              {formatCurrency(selectedIngredient?.cost || 0)} por {selectedIngredient?.unit.toUpperCase()}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">
            {formData.transaction_type === "ajuste"
              ? "Nuevo Stock Total"
              : `Cantidad (${selectedIngredient?.unit || "unidades"})`}
          </Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            value={formData.quantity}
            onChange={handleChange}
            step="1"
            required
          />
        </div>

        {formData.transaction_type !== "salida" ? (
          <div className="space-y-2">
            <Label htmlFor="total_cost">Costo Total</Label>
            <Input
              id="total_cost"
              name="total_cost"
              type="number"
              value={formData.total_cost}
              onChange={handleChange}
              step="1"
              required={formData.transaction_type !== "salida"}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="payment_status">Estado de Pago</Label>
            <Select
              value={formData.payment_status}
              onValueChange={(value) => handleSelectChange("payment_status", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pagado">Pagado</SelectItem>
                <SelectItem value="pendiente">Pendiente por Pagar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {formData.quantity > 0 && formData.total_cost > 0 && formData.transaction_type !== "salida" && (
        <div className="p-3 bg-gray-50 rounded-md">
          <p className="text-sm font-medium">
            Costo por {selectedIngredient?.unit || "unidad"}: {formatCurrency(calculateUnitCost())}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {formData.transaction_type !== "salida" && (
          <div className="space-y-2">
            <Label htmlFor="payment_status">Estado de Pago</Label>
            <Select
              value={formData.payment_status}
              onValueChange={(value) => handleSelectChange("payment_status", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pagado">Pagado</SelectItem>
                <SelectItem value="pendiente">Pendiente por Pagar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Notas</Label>
          <Textarea
            id="notes"
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Notas adicionales sobre la transacción"
            rows={3}
          />
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-4">
        {loading ? "Guardando..." : "Registrar Transacción"}
      </Button>
    </form>
  )
}
