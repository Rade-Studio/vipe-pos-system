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
import { createDish, updateDish, type CategoryDto, type DishDto } from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { ImageUpload } from "@/components/ui/image-upload"
import { Loader2, Trash2, RefreshCw, Plus, X } from "lucide-react"
import Image from "next/image"
import { deleteImage, getPlaceholderUrl, isImageAccessible, isPlaceholderUrl } from "@/lib/api/storage"
import { log } from "@/lib/log"
import { checkQuickNote, QUICK_NOTES_MAX } from "@/lib/admin/catalog"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface DishFormProps {
  dish?: DishDto | null
  categories: CategoryDto[]
  /** Every subcategory; the picker offers those of the chosen category. */
  subcategories?: SubcategoryDto[]
  /** Category a new dish starts in (the menu tree's selected category). */
  defaultCategoryId?: string
  onSuccess: () => void
  isNewDish?: boolean
}

/** Radix Select items cannot carry an empty value. */
const NO_SUBCATEGORY = "__none__"

// Estado inicial del formulario
const initialFormState = {
  name: "",
  description: "",
  price: "",
  category_id: "",
  subcategory_id: "",
  image_url: "",
  active: true,
  allow_comments: false,
  quick_notes: [] as string[],
}

export function DishForm({
  dish,
  categories,
  subcategories = [],
  defaultCategoryId,
  onSuccess,
  isNewDish = false,
}: DishFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ ...initialFormState })
  const [imageError, setImageError] = useState(false)
  const [deletingImage, setDeletingImage] = useState(false)
  // Set when a category change cleared the subcategory: the API refuses a dish
  // left in a subcategory of its old category, so the admin picks one (or none).
  const [subcategoryPending, setSubcategoryPending] = useState(false)
  // T27: the chip being typed and why it was refused (the API's own message).
  const [noteDraft, setNoteDraft] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const newDishState = () => ({ ...initialFormState, category_id: defaultCategoryId ?? "" })
  const previousDishIdRef = useRef<string | number | null>(null)
  const originalImageUrlRef = useRef<string>("")

  // Efecto para manejar la inicialización y limpieza del formulario
  useEffect(() => {
    // Caso 1: Crear nuevo plato (explícitamente indicado por isNewDish)
    if (isNewDish) {
      log.info("Creando nuevo plato (isNewDish=true), limpiando formulario")
      setFormData(newDishState())
      setSubcategoryPending(false)
      originalImageUrlRef.current = ""
      return
    }

    // Caso 2: Cambio de plato a editar a nuevo plato (dish cambia a undefined/null)
    const currentDishId = dish?.id || null
    if (previousDishIdRef.current && !currentDishId) {
      log.info("Transición de editar a nuevo plato, limpiando formulario")
      setFormData(newDishState())
      setSubcategoryPending(false)
      previousDishIdRef.current = null
      originalImageUrlRef.current = ""
      return
    }

    // Caso 3: Editar un plato (dish tiene valor)
    if (dish) {
      log.info("Cargando datos del plato para editar:", { dish })
      previousDishIdRef.current = dish.id

      // Guardar la URL original de la imagen para poder eliminarla después
      if (dish.imageUrl) {
        originalImageUrlRef.current = dish.imageUrl
      }

      // Asegurarse de que category_id sea un string y exista en las categorías disponibles
      let categoryId = ""
      if (dish.categoryId) {
        categoryId = String(dish.categoryId)
        const categoryExists = categories.some((cat) => String(cat.id) === categoryId)
        if (!categoryExists) {
          log.warn(`La categoría con ID ${categoryId} no existe en las opciones disponibles`)
        }
      }

      // Verificar si la imagen es accesible
      if (dish.imageUrl) {
        isImageAccessible(dish.imageUrl)
          .then((isAccessible) => {
            if (!isAccessible) {
              // Display fallback only: `image_url` keeps the stored URL, so a
              // save never replaces (or deletes) an image it merely could not load.
              log.warn("La imagen no es accesible:", { imageUrl: dish.imageUrl })
              setImageError(true)
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
        subcategory_id: dish.subcategoryId || "",
        image_url: dish.imageUrl || "",
        active: dish.active !== undefined ? dish.active : true,
        allow_comments: dish.allowComments !== undefined ? dish.allowComments : false,
        quick_notes: dish.quickNotes ?? [],
      })
      setSubcategoryPending(false)
    } else {
      // Caso 4: Inicialización inicial sin plato (nuevo plato por defecto)
      log.info("Inicialización sin plato, limpiando formulario")
      setFormData(newDishState())
      setSubcategoryPending(false)
      originalImageUrlRef.current = ""
    }
    // `newDishState` only reads `defaultCategoryId`.
  }, [dish, categories, isNewDish, defaultCategoryId])

  const categorySubcategories = subcategories.filter(
    (s) => s.categoryId === formData.category_id && (s.active || s.id === formData.subcategory_id),
  )
  const chosenCategoryName = categories.find((c) => c.id === formData.category_id)?.name ?? ""

  const handleCategoryChange = (value: string) => {
    const current = formData.subcategory_id
    const stillFits = !current || subcategories.some((s) => s.id === current && s.categoryId === value)
    if (stillFits) {
      setFormData((prev) => ({ ...prev, category_id: value }))
      return
    }
    setFormData((prev) => ({ ...prev, category_id: value, subcategory_id: "" }))
    setSubcategoryPending(subcategories.some((s) => s.categoryId === value && s.active))
  }

  // While a choice is pending the picker shows no value, so any pick (even
  // "Sin subcategoría") is a change. Radix echoes "" through its hidden native
  // select (on mount, before the options register); no option carries "".
  const handleSubcategoryChange = (value: string) => {
    if (!value) return
    setFormData((prev) => ({ ...prev, subcategory_id: value === NO_SUBCATEGORY ? "" : value }))
    setSubcategoryPending(false)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }))
  }

  const addQuickNote = () => {
    const result = checkQuickNote(formData.quick_notes, noteDraft)
    if ("error" in result) {
      setNoteError(result.error)
      return
    }
    setFormData((prev) => ({ ...prev, quick_notes: [...prev.quick_notes, result.note] }))
    setNoteDraft("")
    setNoteError(null)
  }

  const removeQuickNote = (note: string) => {
    setFormData((prev) => ({ ...prev, quick_notes: prev.quick_notes.filter((n) => n !== note) }))
    setNoteError(null)
  }

  const handleImageUpload = (url: string) => {
    log.info("URL de imagen recibida:", { url })
    setFormData((prev) => ({ ...prev, image_url: url }))
    setImageError(false)
  }

  const handleDeleteImage = async () => {
    if (!formData.image_url || isPlaceholderUrl(formData.image_url)) {
      // Si no hay imagen o es un placeholder, simplemente limpiar el estado
      setFormData((prev) => ({ ...prev, image_url: "" }))
      setImageError(false)
      return
    }

    setDeletingImage(true)
    try {
      log.info("Eliminando imagen:", { imageUrl: formData.image_url })

      // Intentar eliminar la imagen del bucket
      await deleteImage(formData.image_url)

      // Limpiar la URL de la imagen en el estado
      if (formData.image_url === originalImageUrlRef.current) originalImageUrlRef.current = ""
      setFormData((prev) => ({ ...prev, image_url: "" }))
      setImageError(false)

      toast({
        title: "Imagen eliminada",
        description: "La imagen ha sido eliminada correctamente.",
      })
    } catch (error) {
      log.error("Error al eliminar la imagen:", { error: String(error) })

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

  // Opens the uploader without deleting anything: the current object is only
  // deleted after a save that stores a new successful upload in its place.
  const handleChangeImage = () => {
    setFormData((prev) => ({ ...prev, image_url: "" }))
    setImageError(false)
  }

  const handleImageError = () => {
    log.warn("Error al cargar la imagen:", { imageUrl: formData.image_url })
    setImageError(true)

    // Display fallback only (see the `Image` src); `image_url` is untouched.
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const price = Number.parseFloat(formData.price)
      if (isNaN(price)) {
        throw new Error("El precio debe ser un número válido")
      }

      // camelCase body; empty text and "no category" are stored as null.
      const dishData = {
        name: formData.name,
        description: formData.description || null,
        price,
        categoryId: formData.category_id || null,
        subcategoryId: (formData.category_id && formData.subcategory_id) || null,
        imageUrl: formData.image_url || null,
        active: formData.active,
        allowComments: formData.allow_comments,
        quickNotes: formData.quick_notes,
      }

      if (dish) {
        await updateDish(dish.id, dishData)

        // Only once the dish points at a new successful upload, delete the
        // object it replaced. A failed update keeps the old image.
        const replaced = originalImageUrlRef.current
        if (
          replaced &&
          !isPlaceholderUrl(replaced) &&
          formData.image_url &&
          !isPlaceholderUrl(formData.image_url) &&
          formData.image_url !== replaced
        ) {
          try {
            await deleteImage(replaced)
            originalImageUrlRef.current = formData.image_url
          } catch (deleteError) {
            log.error("Error al eliminar imagen anterior:", { deleteError: String(deleteError) })
          }
        }
      } else {
        await createDish(dishData)
      }

      toast({
        title: dish ? "Plato actualizado" : "Plato creado",
        description: dish
          ? `El plato ${formData.name} ha sido actualizado correctamente.`
          : `El plato ${formData.name} ha sido creado correctamente.`,
      })

      // Limpiar el formulario después de un envío exitoso
      if (!dish) {
        setFormData(newDishState())
        originalImageUrlRef.current = ""
      }

      onSuccess()
    } catch (error: any) {
      log.error("Error saving dish:", { error: String(error) })
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
            onValueChange={handleCategoryChange}
            required
          >
            <SelectTrigger id="category_id" className="w-full">
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

          <Label htmlFor="subcategory_id" className="block pt-2 text-sm font-medium">
            Subcategoría
          </Label>
          <Select
            value={subcategoryPending ? "" : formData.subcategory_id || NO_SUBCATEGORY}
            onValueChange={handleSubcategoryChange}
            disabled={!formData.category_id}
          >
            <SelectTrigger
              id="subcategory_id"
              className="w-full"
              aria-describedby={subcategoryPending ? "subcategory_pending" : undefined}
            >
              <SelectValue placeholder="Elige una subcategoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUBCATEGORY}>Sin subcategoría</SelectItem>
              {categorySubcategories.map((subcategory) => (
                <SelectItem key={subcategory.id} value={subcategory.id}>
                  {subcategory.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {subcategoryPending ? (
            <p id="subcategory_pending" role="alert" className="text-xs text-status-warning-fg">
              Cambiaste la categoría: elige una subcategoría de {chosenCategoryName} o «Sin subcategoría».
            </p>
          ) : (
            formData.category_id &&
            categorySubcategories.length === 0 && (
              <p className="text-xs text-muted-foreground">Esta categoría no tiene subcategorías: el mesero ve el plato directo.</p>
            )
          )}
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
                      src={imageError ? getPlaceholderUrl(formData.name) : formData.image_url}
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
                            className="h-8 w-8 rounded-full shadow-md"
                            onClick={handleDeleteImage}
                            disabled={deletingImage}
                            aria-label="Eliminar imagen"
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
                            aria-label="Cambiar imagen"
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

              <div className="space-y-2 border-t pt-4">
                <div className="space-y-0.5">
                  <Label htmlFor="quick_note" className="text-sm">
                    Nueva nota rápida
                  </Label>
                  <p id="quick_note_help" className="text-xs text-muted-fg">
                    Botones que el mesero toca al agregar el plato (máx. {QUICK_NOTES_MAX}).
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <Input
                    id="quick_note"
                    value={noteDraft}
                    placeholder="Ej: Sin cebolla"
                    aria-describedby={noteError ? "quick_note_error" : "quick_note_help"}
                    aria-invalid={noteError ? true : undefined}
                    onChange={(e) => {
                      setNoteDraft(e.target.value)
                      setNoteError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return
                      e.preventDefault()
                      addQuickNote()
                    }}
                    className="h-11 min-w-0 flex-1 basis-40"
                  />
                  <Button type="button" variant="outline" className="min-h-11 shrink-0 max-sm:flex-1" onClick={addQuickNote}>
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    Agregar nota
                  </Button>
                </div>
                {noteError && (
                  <p id="quick_note_error" role="alert" className="text-xs text-status-danger-fg">
                    {noteError}
                  </p>
                )}
                <ul aria-label="Notas rápidas" className="flex min-w-0 flex-wrap gap-1.5">
                  {formData.quick_notes.map((note) => (
                    <li
                      key={note}
                      className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-pill border border-line bg-surface pl-3 pr-1 text-[13px]"
                    >
                      <span data-note className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {note}
                      </span>
                      <button
                        type="button"
                        aria-label={`Quitar nota ${note}`}
                        onClick={() => removeQuickNote(note)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-pill text-muted-fg hover:text-fg focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center pt-4">
            <Button type="submit" className="w-full" disabled={loading || deletingImage || subcategoryPending} size="lg">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dish ? "Actualizar Plato" : "Crear Plato"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
