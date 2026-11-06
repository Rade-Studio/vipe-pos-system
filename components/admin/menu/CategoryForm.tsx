"use client"

import { useState, useEffect } from "react"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { createCategory, updateCategory, type CategoryDto } from "@/lib/api/catalog"
import { ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import * as LucideIcons from "lucide-react"
import { CATEGORY_COLORS } from "@/lib/admin/catalog"
import { colorClasses, lucideIcon } from "./tones"

// Esquema de validación para el formulario
const categorySchema = z.object({
  name: z.string().min(1, { message: "El nombre es obligatorio" }),
  description: z.string().optional(),
  icon: z.string().min(1, { message: "Selecciona un icono" }),
  active: z.boolean().default(true),
  color: z.enum(["neutral", "yellow", "orange", "sky", "violet", "emerald", "rose"]).default("neutral"),
})

type CategoryFormValues = z.infer<typeof categorySchema>

interface CategoryFormProps {
  category?: CategoryDto | null
  onSuccess?: () => void
  /** One column whatever the viewport (the menu tree inspector is narrow). */
  compact?: boolean
}

// Lista de iconos de cocina/restaurante disponibles en Lucide
const kitchenIcons = [
  "Coffee",
  "UtensilsCrossed",
  "Utensils",
  "ChefHat",
  "Apple",
  "Beer",
  "Beef",
  "Cake",
  "Cherry",
  "Cookie",
  "Croissant",
  "Egg",
  "Fish",
  "Flame",
  "IceCream",
  "Lemon",
  "Milk",
  "Pizza",
  "Salad",
  "Sandwich",
  "Soup",
  "Wine",
  "Banana",
  "Carrot",
  "Cheese",
  "Drumstick",
  "Hamburger",
  "Popcorn",
  "Taco",
  "Vegetable",
  "Wheat",
  "Cocktail",
  "Coffee",
  "Dessert",
  "Drink",
  "Fruit",
  "GlassWater",
  "Grape",
  "IceCream2",
  "Martini",
  "Meat",
  "Orange",
  "Pasta",
  "Pepper",
  "Pie",
  "Rice",
  "Salad",
  "Sushi",
  "Tea",
  "Tomato",
  "Watermelon",
  "Bread",
  "Broccoli",
  "Candy",
  "Chili",
  "Chocolate",
  "Coconut",
  "CupSoda",
  "Donut",
  "Fridge",
  "Grill",
  "HotDog",
  "IceCreams",
  "Kebab",
  "Lollipop",
  "Microwave",
  "Mug",
  "Mushroom",
  "Noodles",
  "Oven",
  "Pear",
  "Pineapple",
  "Potato",
  "Pretzel",
  "Refrigerator",
  "Sausage",
  "Shrimp",
  "Steak",
  "Strawberry",
  "Toaster",
  "Waffle",
  "Yogurt",
]

// Filtrar solo los iconos que existen en Lucide
const validIcons = kitchenIcons.filter((icon) => Boolean((LucideIcons as any)[icon]))

/** The icon is validated as required above; an empty description is stored as null. */
function categoryBody(data: CategoryFormValues) {
  return {
    name: data.name,
    description: data.description ? data.description : null,
    icon: data.icon,
    active: data.active,
    color: data.color,
  }
}

export function CategoryForm({ category, onSuccess, compact = false }: CategoryFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Inicializar el formulario con los valores por defecto o los valores de la categoría existente
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema) as any,
    defaultValues: {
      name: category?.name || "",
      description: category?.description || "",
      icon: category?.icon || "",
      active: category?.active !== undefined ? category.active : true,
      color: category?.color ?? "neutral",
    },
  })

  // Actualizar el formulario cuando cambia la categoría seleccionada
  useEffect(() => {
    if (category) {
      form.reset({
        name: category.name || "",
        description: category.description || "",
        icon: category.icon || "",
        active: category.active !== undefined ? category.active : true,
        color: category.color ?? "neutral",
      })
    } else {
      form.reset({
        name: "",
        description: "",
        icon: "",
        active: true,
        color: "neutral",
      })
    }
  }, [category, form])

  const onSubmit = async (data: CategoryFormValues) => {
    setLoading(true)
    try {
      if (category) {
        // Actualizar categoría existente
        await updateCategory(category.id, categoryBody(data))

        toast({
          title: "Categoría actualizada",
          description: `La categoría ${data.name} ha sido actualizada correctamente.`,
        })
      } else {
        // Crear nueva categoría
        await createCategory(categoryBody(data))

        toast({
          title: "Categoría creada",
          description: `La categoría ${data.name} ha sido creada correctamente.`,
        })
      }

      // Resetear el formulario y llamar al callback de éxito
      form.reset()
      if (onSuccess) onSuccess()
    } catch (error: any) {
      log.error("Error saving category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al guardar la categoría: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-6">
        <div className={cn("grid grid-cols-1 gap-6", !compact && "md:grid-cols-2")}>
          {/* Primera columna */}
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre de la categoría" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descripción de la categoría (opcional)"
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Segunda columna */}
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Icono</FormLabel>
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" role="combobox" aria-expanded={open} className="justify-between">
                          {field.value ? (
                            <div className="flex items-center">
                              {(() => {
                                const IconComponent = lucideIcon(field.value)
                                return IconComponent ? <IconComponent className="h-5 w-5" /> : "Seleccionar icono"
                              })()}
                            </div>
                          ) : (
                            "Seleccionar icono"
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[300px] max-h-[400px]">
                      <Command>
                        <CommandInput placeholder="Buscar icono..." />
                        <CommandList className="max-h-[350px] overflow-y-auto">
                          <CommandEmpty>No se encontraron iconos.</CommandEmpty>
                          <CommandGroup>
                            <div className="grid grid-cols-5 gap-2 p-2">
                              {validIcons.map((icon) => {
                                const IconComponent = (LucideIcons as any)[icon]
                                return (
                                  <CommandItem
                                    key={icon}
                                    value={icon}
                                    onSelect={(value) => {
                                      form.setValue("icon", value)
                                      setOpen(false)
                                    }}
                                    className="flex flex-col items-center justify-center p-2 h-14 w-full"
                                  >
                                    <div
                                      className={cn(
                                        "flex items-center justify-center rounded-md p-2 w-full h-full",
                                        field.value === icon ? "bg-primary/20" : "hover:bg-accent",
                                      )}
                                    >
                                      <IconComponent className="h-6 w-6" />
                                    </div>
                                  </CommandItem>
                                )
                              })}
                            </div>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="category-color-label">Color</FormLabel>
                  <RadioGroupPrimitive.Root
                    aria-labelledby="category-color-label"
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex flex-wrap gap-2"
                  >
                    {CATEGORY_COLORS.map((option) => (
                      <RadioGroupPrimitive.Item
                        key={option.value}
                        value={option.value}
                        aria-label={option.label}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-card py-1 pl-1.5 pr-3 text-sm",
                          "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus",
                          "data-[state=checked]:border-brand data-[state=checked]:bg-brand-tint data-[state=checked]:shadow-[inset_0_0_0_1px_var(--accent)]",
                        )}
                      >
                        <span aria-hidden className={cn("h-7 w-7 rounded-full border-2", colorClasses(option.value).swatch)} />
                        <span aria-hidden>{option.label}</span>
                      </RadioGroupPrimitive.Item>
                    ))}
                  </RadioGroupPrimitive.Root>
                  <p className="text-xs text-muted-foreground">El color del botón de la categoría en la toma de pedidos.</p>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 mt-6">
                  <div className="space-y-0.5">
                    <FormLabel>Estado</FormLabel>
                    <div className="text-sm text-muted-foreground">
                      Determina si la categoría está activa y visible en el menú
                    </div>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando..." : category ? "Actualizar" : "Crear"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
