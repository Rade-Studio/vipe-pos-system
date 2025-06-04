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
import { IconSelector } from "@/components/ui/icon-selector"

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


export function CategoryForm({ category, onSuccess }: CategoryFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

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
                  <FormControl>
                    <IconSelector
                      selectedIcon={field.value}
                      onSelectIcon={(icon) => form.setValue("icon", icon)}
                    />
                  </FormControl>
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
