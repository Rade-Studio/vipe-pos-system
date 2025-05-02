"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import { ImageUpload } from "@/components/ui/image-upload"
import { Loader2, Trash2, RefreshCw } from "lucide-react"
import Image from "next/image"
import { storageService } from "@/lib/supabase/storage-service"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface DishFormProps {
  dish?: any
  categories: any[]
  onSuccess: () => void
  isNewDish?: boolean
}

// Estado inicial del formulario
const initialFormState = {
  name: "",
  description: "",
  price: "",
  category_id: "",
  image_url: "",
  active: true,
  allow_comments: false,
}

export function DishForm({ dish, categories, onSuccess, isNewDish = false }: DishFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ ...initialFormState })
  const [imageError, setImageError] = useState(false)
  const [deletingImage, setDeletingImage] = useState(false)
  const previousDishIdRef = useRef<string | number | null>(null)
  const originalImageUrlRef = useRef<string>("")

  // Efecto para manejar la inicialización y limpieza del formulario
  useEffect(() => {
    // Caso 1: Crear nuevo plato (explícitamente indicado por isNewDish)
    if (isNewDish) {
      console.log("Creando nuevo plato (isNewDish=true), limpiando formulario")
      setFormData({ ...initialFormState })
      originalImageUrlRef.current = ""
      return
    }

    // Caso 2: Cambio de plato a editar a nuevo plato (dish cambia a undefined/null)
    const currentDishId = dish?.id || null
    if (previousDishIdRef.current && !currentDishId) {
      console.log("Transición de editar a nuevo plato, limpiando formulario")
      setFormData({ ...initialFormState })
      previousDishIdRef.current = null
      originalImageUrlRef.current = ""
      return
    }

    // Caso 3: Editar un plato (dish tiene valor)
    if (dish) {
      console.log("Cargando datos del plato para editar:", dish)
      previousDishIdRef.current = dish.id

      // Guardar la URL original de la imagen para poder eliminarla después
      if (dish.image_url) {
        originalImageUrlRef.current = dish.image_url
      }

      // Asegurarse de que category_id sea un string y exista en las categorías disponibles
      let categoryId = ""
      if (dish.category_id) {
        categoryId = String(dish.category_id)
        const categoryExists = categories.some((cat) => String(cat.id) === categoryId)
        if (!categoryExists) {
          console.warn(`La categoría con ID ${categoryId} no existe en las opciones disponibles`)
        }
      }

      // Verificar si la imagen es accesible
      if (dish.image_url) {
        storageService
          .isImageAccessible(dish.image_url)
          .then((isAccessible) => {
            if (!isAccessible) {
              console.warn("La imagen no es accesible:", dish.image_url)
              setImageError(true)
              // Usar un placeholder en su lugar
              const placeholderUrl = storageService.getPlaceholderUrl(dish.name)
              setFormData((prev) => ({ ...prev, image_url: placeholderUrl }))
            }
          })
          .catch(() => {
            // En caso de error, mantener la URL original
          })
      }

      // Actualizar el formulario con los datos del plato
      setFormData({
        name: dish.name || "",
        description: dish.description || "",
        price: dish.price ? dish.price.toString() : "",
        category_id: categoryId,
        image_url: dish.image_url || "",
        active: dish.active !== undefined ? dish.active : true,
        allow_comments: dish.allow_comments !== undefined ? dish.allow_comments : false,
      })
    } else {
      // Caso 4: Inicialización inicial sin plato (nuevo plato por defecto)
      console.log("Inicialización sin plato, limpiando formulario")
      setFormData({ ...initialFormState })
      originalImageUrlRef.current = ""
    }
  }, [dish, categories, isNewDish])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }))
  }

  const handleImageUpload = (url: string) => {
    console.log("URL de imagen recibida:", url)
    setFormData((prev) => ({ ...prev, image_url: url }))
    setImageError(false)
  }

  const handleDeleteImage = async () => {
    if (!formData.image_url || formData.image_url.includes("placeholder.svg")) {
      // Si no hay imagen o es un placeholder, simplemente limpiar el estado
      setFormData((prev) => ({ ...prev, image_url: "" }))
      setImageError(false)
      return
    }

    setDeletingImage(true)
    try {
      console.log("Eliminando imagen:", formData.image_url)

      // Intentar eliminar la imagen del bucket
      await storageService.deleteImage(formData.image_url)

      // Limpiar la URL de la imagen en el estado
      setFormData((prev) => ({ ...prev, image_url: "" }))
      setImageError(false)

      toast({
        title: "Imagen eliminada",
        description: "La imagen ha sido eliminada correctamente.",
      })
    } catch (error) {
      console.error("Error al eliminar la imagen:", error)

      // Incluso si hay un error, limpiar la URL en el estado
      setFormData((prev) => ({ ...prev, image_url: "" }))

      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar la imagen del servidor, pero se ha quitado del formulario.",
      })
    } finally {
      setDeletingImage(false)
    }
  }

  const handleChangeImage = async () => {
    // Si hay una imagen actual, eliminarla primero
    if (formData.image_url && !formData.image_url.includes("placeholder.svg")) {
      await handleDeleteImage()
    } else {
      // Si no hay imagen o es un placeholder, simplemente limpiar el estado
      setFormData((prev) => ({ ...prev, image_url: "" }))
      setImageError(false)
    }
  }

  const handleImageError = () => {
    console.warn("Error al cargar la imagen:", formData.image_url)
    setImageError(true)

    // Si hay un error al cargar la imagen, usar un placeholder
    const placeholderUrl = storageService.getPlaceholderUrl(formData.name)
    setFormData((prev) => ({ ...prev, image_url: placeholderUrl }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const price = Number.parseFloat(formData.price)
      if (isNaN(price)) {
        throw new Error("El precio debe ser un número válido")
      }

      const dishData = {
        name: formData.name,
        description: formData.description,
        price,
        category_id: formData.category_id,
        image_url: formData.image_url,
        active: formData.active,
        allow_comments: formData.allow_comments,
      }

      let error

      if (dish) {
        // Si la imagen ha cambiado y había una imagen anterior, eliminar la imagen anterior
        if (originalImageUrlRef.current && originalImageUrlRef.current !== formData.image_url) {
          try {
            await storageService.deleteImage(originalImageUrlRef.current)
            console.log("Imagen anterior eliminada:", originalImageUrlRef.current)
          } catch (deleteError) {
            console.error("Error al eliminar imagen anterior:", deleteError)
            // No interrumpir el flujo principal si falla la eliminación
          }
        }

        // Update existing dish
        const { error: updateError } = await supabase.from("dishes").update(dishData).eq("id", dish.id)
        error = updateError
      } else {
        // Insert new dish
        const { error: insertError } = await supabase.from("dishes").insert(dishData)
        error = insertError
      }

      if (error) throw error

      toast({
        title: dish ? "Plato actualizado" : "Plato creado",
        description: dish
          ? `El plato ${formData.name} ha sido actualizado correctamente.`
          : `El plato ${formData.name} ha sido creado correctamente.`,
      })

      // Limpiar el formulario después de un envío exitoso
      if (!dish) {
        setFormData({ ...initialFormState })
        originalImageUrlRef.current = ""
      }

      onSuccess()
    } catch (error: any) {
      console.error("Error saving dish:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al guardar el plato: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      key={`dish-form-${dish?.id || "new"}-${isNewDish ? "new" : "edit"}`}
      onSubmit={handleSubmit}
      className="space-y-6 py-2"
    >
      {/* Primera fila: Nombre y Precio */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">
            Nombre del plato
          </Label>
          <Input
            id="name"
            name="name"
            key="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="Ej: Ensalada César"
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="price" className="text-sm font-medium">
            Precio
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="price"
              name="price"
              type="number"
              key="price"
              step="1"
              min="0"
              value={formData.price}
              onChange={handleChange}
              required
              placeholder="0.00"
              className="pl-7"
            />
          </div>
        </div>
      </div>

      {/* Segunda fila: Categoría y Descripción */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="category_id" className="text-sm font-medium">
            Categoría
          </Label>
          <Select
            key={`category-select-${formData.category_id || "empty"}-${Date.now()}`}
            defaultValue={formData.category_id}
            value={formData.category_id}
            onValueChange={(value) => {
              handleSelectChange("category_id", value)
            }}
            required
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecciona una categoría" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={String(category.id)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="text-sm font-medium">
            Descripción
          </Label>
          <Textarea
            id="description"
            name="description"
            key="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Breve descripción del plato..."
            rows={3}
            className="resize-none"
          />
        </div>
      </div>

      {/* Tercera fila: Imagen y Opciones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Label className="text-sm font-medium">Imagen del plato</Label>
          </div>

          <Card className="overflow-hidden border rounded-lg">
            <CardContent className="p-0">
              {formData.image_url ? (
                <div className="relative">
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={formData.image_url || "/placeholder.svg"}
                      alt={formData.name || "Vista previa"}
                      fill
                      className="object-cover rounded-t-lg"
                      sizes="(max-width: 768px) 100vw, 400px"
                      onError={handleImageError}
                    />
                    {imageError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                        <p className="text-sm text-gray-500 dark:text-gray-400">No se pudo cargar la imagen</p>
                      </div>
                    )}
                  </div>

                  <div className="absolute top-2 right-2 flex gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-red-500/90 hover:bg-red-600 shadow-md"
                            onClick={handleDeleteImage}
                            disabled={deletingImage}
                          >
                            {deletingImage ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Eliminar imagen</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-gray-200/90 hover:bg-gray-300 shadow-md dark:bg-gray-700 dark:hover:bg-gray-600"
                            onClick={handleChangeImage}
                            disabled={deletingImage}
                          >
                            {deletingImage ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Cambiar imagen</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              ) : (
                <div className="aspect-[4/3] flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <ImageUpload
                    value={formData.image_url}
                    onChange={handleImageUpload}
                    bucketName="dishes"
                    maxWidth={600}
                    maxHeight={450}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border rounded-lg shadow-sm">
            <CardContent className="p-4 space-y-4">
              <h3 className="text-sm font-medium mb-2">Opciones del plato</h3>

              <div className="flex items-center justify-between py-2 border-b">
                <div className="space-y-0.5">
                  <Label htmlFor="active" className="text-sm">
                    Activo
                  </Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">El plato estará disponible para ordenar</p>
                </div>
                <Switch
                  id="active"
                  checked={formData.active}
                  onCheckedChange={(checked) => handleSwitchChange("active", checked)}
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5">
                  <Label htmlFor="allow_comments" className="text-sm">
                    Permitir comentarios
                  </Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Los clientes podrán añadir instrucciones especiales
                  </p>
                </div>
                <Switch
                  id="allow_comments"
                  checked={formData.allow_comments}
                  onCheckedChange={(checked) => handleSwitchChange("allow_comments", checked)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center pt-4">
            <Button type="submit" className="w-full" disabled={loading || deletingImage} size="lg">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dish ? "Actualizar Plato" : "Crear Plato"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
