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
import { log } from "@/lib/log"
import {
  createPromotion,
  fetchDishes,
  fetchPromotionDishes,
  setPromotionDishes,
  updatePromotion,
  type DishDto,
  type PromotionDto,
} from "@/lib/api/catalog"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {toast} from "@/components/ui/use-toast";

interface PromotionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  promotion: PromotionDto | null
  onSubmit: () => Promise<void> // Cambiado para no recibir parámetros
}

/**
 * Form state of a product_discount (the only kind this form edits until the
 * new editor, T6); `discountValue` is null while the field is empty and a null
 * `endDate` means no end.
 */
type PromotionDraft = Pick<PromotionDto, "name" | "description" | "startDate" | "endDate" | "active" | "discountValue"> & {
  discountType: "percentage" | "fixed_amount"
}

const emptyDraft = (): PromotionDraft => ({
  name: "",
  description: "",
  discountType: "percentage",
  discountValue: null,
  startDate: new Date().toISOString(),
  endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
  active: true,
})

export function PromotionForm({ open, onOpenChange, promotion, onSubmit }: PromotionFormProps) {
  const [loading, setLoading] = useState(false)
  const [dishes, setDishes] = useState<DishDto[]>([])
  const [selectedDishes, setSelectedDishes] = useState<string[]>([])
  const [dishSearch, setDishSearch] = useState("")
  const [formData, setFormData] = useState<PromotionDraft>(emptyDraft)

  useEffect(() => {
    if (open) {
      loadDishes()
      if (promotion) {
        setFormData({
          name: promotion.name,
          description: promotion.description || "",
          discountType: promotion.discountType ?? "percentage",
          discountValue: promotion.discountValue,
          startDate: promotion.startDate,
          endDate: promotion.endDate,
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
      const dishesData = await fetchDishes()
      setDishes(dishesData)
    } catch (error) {
      log.error("Error loading dishes:", { error: String(error) })
    }
  }

  const loadPromotionDishes = async (promotionId: string) => {
    try {
      const assigned = await fetchPromotionDishes(promotionId)
      setSelectedDishes(assigned.map((dish) => dish.id))
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar platos. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  const resetForm = () => {
    setFormData(emptyDraft())
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
    setFormData((prev) => ({ ...prev, discountType: value }))
  }

  const handleDateChange = (field: "startDate" | "endDate", date: Date | undefined) => {
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
    if (formData.discountValue == null || formData.discountValue <= 0) {
      toast({
        title: "Error",
        description: "El valor del descuento debe ser mayor que 0",
        variant: "destructive",
      })
      return
    }
    setLoading(true)

    try {
      // New promotions are automatic product discounts; an edit keeps the kind,
      // mode and buy_x_pay_y percent the promotion already has.
      const body = {
        kind: promotion?.kind ?? ("product_discount" as const),
        mode: promotion?.mode ?? ("automatic" as const),
        restDiscountPercent: promotion?.restDiscountPercent ?? null,
        name: formData.name,
        description: formData.description ? formData.description : null,
        discountType: formData.discountType,
        discountValue: formData.discountValue,
        startDate: formData.startDate,
        endDate: formData.endDate,
        active: formData.active,
      }
      const saved = promotion ? await updatePromotion(promotion.id, body) : await createPromotion(body)

      // The final set, replaced atomically by the server (T7b).
      await setPromotionDishes(saved.id, selectedDishes)

      // Notificar al componente padre que se ha completado la operación
      await onSubmit()

      // Cerrar el diálogo y resetear el formulario
      onOpenChange(false)
      resetForm()
    } catch (error) {
      log.error("Error saving promotion:", { error: String(error) })
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar la promoción.",
        variant: "destructive",
      })
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
                  value={formData.discountType}
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
                  {formData.discountType === "percentage" ? "Porcentaje de descuento" : "Monto de descuento"}
                </Label>
                <div className="relative">
                  {formData.discountType === "fixed_amount" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  )}
                  <Input
                    id="discount_value"
                    name="discountValue"
                    type="number"
                    value={formData.discountValue ?? ""}
                    onChange={handleNumberChange}
                    min={0}
                    max={formData.discountType === "percentage" ? 100 : undefined}
                    step={formData.discountType === "percentage" ? 1 : 0.01}
                    className={formData.discountType === "fixed_amount" ? "pl-7" : ""}
                    placeholder={formData.discountType === "percentage" ? "Ej: 15" : "Ej: 5.99"}
                    required
                  />
                  {formData.discountType === "percentage" && (
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
                        !formData.startDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.startDate ? (
                        format(new Date(formData.startDate), "PPP", { locale: es })
                      ) : (
                        <span>Seleccionar fecha</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.startDate ? new Date(formData.startDate) : undefined}
                      onSelect={(date) => handleDateChange("startDate", date)}
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
                        !formData.endDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.endDate ? (
                        format(new Date(formData.endDate), "PPP", { locale: es })
                      ) : (
                        <span>Seleccionar fecha</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.endDate ? new Date(formData.endDate) : undefined}
                      onSelect={(date) => handleDateChange("endDate", date)}
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
