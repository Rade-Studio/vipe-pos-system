"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { supabase } from "@/lib/supabase"
import { ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import * as LucideIcons from "lucide-react"

// Esquema de validación para el formulario
const categorySchema = z.object({
  name: z.string().min(1, { message: "El nombre es obligatorio" }),
  description: z.string().optional(),
  icon: z.string().optional(),
  active: z.boolean().default(true),
})

type CategoryFormValues = z.infer<typeof categorySchema>

interface CategoryFormProps {
  category?: any
  onSuccess?: () => void
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

export function CategoryForm({ category, onSuccess }: CategoryFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Inicializar el formulario con los valores por defecto o los valores de la categoría existente
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name || "",
      description: category?.description || "",
      icon: category?.icon || "",
      active: category?.active !== undefined ? category.active : true,
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
      })
    } else {
      form.reset({
        name: "",
        description: "",
        icon: "",
        active: true,
      })
    }
  }, [category, form])

  const onSubmit = async (data: CategoryFormValues) => {
    setLoading(true)
    try {
      if (category) {
        // Actualizar categoría existente
        const { error } = await supabase.from("categories").update(data).eq("id", category.id)

        if (error) throw error

        toast({
          title: "Categoría actualizada",
          description: `La categoría ${data.name} ha sido actualizada correctamente.`,
        })
      } else {
        // Crear nueva categoría
        const { error } = await supabase.from("categories").insert([data])

        if (error) throw error

        toast({
          title: "Categoría creada",
          description: `La categoría ${data.name} ha sido creada correctamente.`,
        })
      }

      // Resetear el formulario y llamar al callback de éxito
      form.reset()
      if (onSuccess) onSuccess()
    } catch (error: any) {
      console.error("Error saving category:", error)
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                                const IconComponent = field.value ? (LucideIcons as any)[field.value] : null
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
                    <PopoverContent className="p-0 w-[300px]">
                      <Command>
                        <CommandInput placeholder="Buscar icono..." />
                        <ScrollArea className="h-[350px]">
                          <CommandList className="max-h-none">
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
                        </ScrollArea>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
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
