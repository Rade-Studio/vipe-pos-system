"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarIcon, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Promotion } from "@/lib/supabase/promotion-service"
import { log } from "@/lib/log"
import { promotionService } from "@/lib/supabase/promotion-service"
import { dishService } from "@/lib/supabase"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {toast} from "@/components/ui/use-toast";

interface PromotionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  promotion: Promotion | null
  onSubmit: () => Promise<void> // Cambiado para no recibir parámetros
}

export function PromotionForm({ open, onOpenChange, promotion, onSubmit }: PromotionFormProps) {
  const [loading, setLoading] = useState(false)
  const [dishes, setDishes] = useState<any[]>([])
  const [selectedDishes, setSelectedDishes] = useState<string[]>([])
  const [dishSearch, setDishSearch] = useState("")
  const [formData, setFormData] = useState<Omit<Promotion, "id" | "created_at" | "updated_at">>({
    name: "",
    description: "",
    discount_type: "percentage",
    discount_value: null,
    start_date: new Date().toISOString(),
    end_date: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
    active: true,
  })

  useEffect(() => {
    if (open) {
      loadDishes()
      if (promotion) {
        setFormData({
          name: promotion.name,
          description: promotion.description || "",
          discount_type: promotion.discount_type,
          discount_value: promotion.discount_value,
          start_date: promotion.start_date,
          end_date: promotion.end_date,
          active: promotion.active,
        })
        loadPromotionDishes(promotion.id)
      } else {
        resetForm()
      }
    }
  }, [open, promotion])

  const loadDishes = async () => {
    try {
      const dishesData = await dishService.getAll()
      setDishes(dishesData)
    } catch (error) {
      log.error("Error loading dishes:", { error: String(error) })
    }
  }

  const loadPromotionDishes = async (promotionId: string) => {
    try {
      const dishIds = await promotionService.getPromotionDishes(promotionId)
      setSelectedDishes(dishIds.map((dish: any) => dish.id))
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar platos. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      discount_type: "percentage",
      discount_value: null,
      start_date: new Date().toISOString(),
      end_date: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
      active: true,
    })
    setSelectedDishes([])
    setDishSearch("")
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target

    if (value === "") {
      setFormData((prev) => ({ ...prev, [name]: null }))
      return
    }

    const numValue = Number.parseFloat(value)
    if (!isNaN(numValue)) {
      setFormData((prev) => ({ ...prev, [name]: numValue }))
    }
  }

  const handleDiscountTypeChange = (value: "percentage" | "fixed_amount") => {
    setFormData((prev) => ({ ...prev, discount_type: value }))
  }

  const handleDateChange = (field: "start_date" | "end_date", date: Date | undefined) => {
    if (date) {
      setFormData((prev) => ({ ...prev, [field]: date.toISOString() }))
    }
  }

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, active: checked }))
  }

  const handleDishToggle = (dishId: string) => {
    setSelectedDishes((prev) => (prev.includes(dishId) ? prev.filter((id) => id !== dishId) : [...prev, dishId]))
  }

  const handleSelectAllDishes = () => {
    if (selectedDishes.length === dishes.length) {
      setSelectedDishes([])
    } else {
      setSelectedDishes(dishes.map((dish) => dish.id))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Guardar la promoción
      if (promotion) {
        // Actualizar promoción existente
        await promotionService.updatePromotion(promotion.id, formData)

        // Obtener los platos actuales
        const currentDishes = await promotionService.getPromotionDishes(promotion.id)

        // Platos a eliminar
        const dishesToRemove = currentDishes.filter((dish: any) => !selectedDishes.includes(dish.id))
        if (dishesToRemove.length > 0) {
          await promotionService.removePromotionDishes(promotion.id, dishesToRemove.map((dish: any) => dish.id))
        }

        // Platos a añadir
        const dishesToAdd = selectedDishes.filter((id) => !currentDishes.some((d: any) => d.id === id))
        if (dishesToAdd.length > 0) {
          await promotionService.assignDishesToPromotion(promotion.id, dishesToAdd)
        }
      } else {
        // Crear nueva promoción
        const savedPromotion = await promotionService.createPromotion(formData)

        // Asignar platos a la nueva promoción
        if (selectedDishes.length > 0) {
          await promotionService.assignDishesToPromotion(savedPromotion.id, selectedDishes)
        }
      }

      // Notificar al componente padre que se ha completado la operación
      await onSubmit()

      // Cerrar el diálogo y resetear el formulario
      onOpenChange(false)
      resetForm()
    } catch (error) {
      log.error("Error saving promotion:", { error: String(error) })
    } finally {
      setLoading(false)
    }
  }

  const filteredDishes = dishes.filter((dish) => dish.name.toLowerCase().includes(dishSearch.toLowerCase()))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{promotion ? "Editar Promoción" : "Nueva Promoción"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre de la promoción</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Ej: Descuento de verano"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description || ""}
                onChange={handleChange}
                placeholder="Describe brevemente esta promoción"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de descuento</Label>
                <RadioGroup
                  value={formData.discount_type}
                  onValueChange={(value) => handleDiscountTypeChange(value as "percentage" | "fixed_amount")}
                  className="flex flex-col space-y-1"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="percentage" id="percentage" />
                    <Label htmlFor="percentage" className="cursor-pointer">
                      Porcentaje (%)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="fixed_amount" id="fixed_amount" />
                    <Label htmlFor="fixed_amount" className="cursor-pointer">
                      Monto fijo ($)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="discount_value">
                  {formData.discount_type === "percentage" ? "Porcentaje de descuento" : "Monto de descuento"}
                </Label>
                <div className="relative">
                  {formData.discount_type === "fixed_amount" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  )}
                  <Input
                    id="discount_value"
                    name="discount_value"
                    type="number"
                    value={formData.discount_value ?? ""}
                    onChange={handleNumberChange}
                    min={0}
                    max={formData.discount_type === "percentage" ? 100 : undefined}
                    step={formData.discount_type === "percentage" ? 1 : 0.01}
                    className={formData.discount_type === "fixed_amount" ? "pl-7" : ""}
                    placeholder={formData.discount_type === "percentage" ? "Ej: 15" : "Ej: 5.99"}
                    required
                  />
                  {formData.discount_type === "percentage" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de inicio</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.start_date && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.start_date ? (
                        format(new Date(formData.start_date), "PPP", { locale: es })
                      ) : (
                        <span>Seleccionar fecha</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.start_date ? new Date(formData.start_date) : undefined}
                      onSelect={(date) => handleDateChange("start_date", date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Fecha de fin</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.end_date && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.end_date ? (
                        format(new Date(formData.end_date), "PPP", { locale: es })
                      ) : (
                        <span>Seleccionar fecha</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.end_date ? new Date(formData.end_date) : undefined}
                      onSelect={(date) => handleDateChange("end_date", date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch id="active" checked={formData.active} onCheckedChange={handleSwitchChange} />
              <Label htmlFor="active">Promoción activa</Label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Platos con descuento</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleSelectAllDishes}>
                  {selectedDishes.length === dishes.length ? "Deseleccionar todos" : "Seleccionar todos"}
                </Button>
              </div>

              <div className="mb-2">
                <Input
                  placeholder="Buscar platos..."
                  value={dishSearch}
                  onChange={(e) => setDishSearch(e.target.value)}
                  className="mb-2"
                />
              </div>

              <ScrollArea className="h-[200px] border rounded-md p-4">
                <div className="space-y-2">
                  {filteredDishes.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">No se encontraron platos</p>
                  ) : (
                    filteredDishes.map((dish) => (
                      <div key={dish.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`dish-${dish.id}`}
                          checked={selectedDishes.includes(dish.id)}
                          onCheckedChange={() => handleDishToggle(dish.id)}
                        />
                        <Label htmlFor={`dish-${dish.id}`} className="cursor-pointer">
                          {dish.name}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {promotion ? "Actualizar" : "Crear"} Promoción
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
