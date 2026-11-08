"use client"

import type React from "react"

import { useState, useEffect, useId, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
  createDish,
  fetchDishModifierGroups,
  fetchModifierGroups,
  setDishModifierGroups,
  updateDish,
  type CategoryDto,
  type DishDto,
  type ModifierGroupDto,
} from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { ImageUpload } from "@/components/ui/image-upload"
import { BookOpen, ExternalLink, Loader2, Trash2, RefreshCw } from "lucide-react"
import Image from "next/image"
import { deleteImage, getPlaceholderUrl, isImageAccessible, isPlaceholderUrl } from "@/lib/api/storage"
import { log } from "@/lib/log"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DishModifierGroups } from "./DishModifierGroups"

interface DishFormProps {
  dish?: DishDto | null
  categories: CategoryDto[]
  /** Every subcategory; the picker offers those of the chosen category. */
  subcategories?: SubcategoryDto[]
  /** Category a new dish starts in (the menu tree's selected category). */
  defaultCategoryId?: string
  /** Subcategory a new dish starts in (the Platos tab filter). */
  defaultSubcategoryId?: string
  onSuccess: () => void
  /** Shows "Cancelar" next to the save button. */
  onCancel?: () => void
  /** Opens the dish's recipe in Fórmulas; without it an existing dish shows no Fórmula block. */
  onOpenFormula?: () => void
  /** The draft menu says the dish is out of stock (read-only here). */
  soldOut?: boolean
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
}

export function DishForm({
  dish,
  categories,
  subcategories = [],
  defaultCategoryId,
  defaultSubcategoryId,
  onSuccess,
  onCancel,
  onOpenFormula,
  soldOut = false,
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
  // F7: every modifier group, and the ones this dish offers in order (saved apart, PUT .../modifier-groups).
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupDto[]>([])
  const [groupIds, setGroupIds] = useState<string[]>([])
  const savedGroupIdsRef = useRef<string[]>([])
  const newDishState = () => ({
    ...initialFormState,
    category_id: defaultCategoryId ?? "",
    subcategory_id: (defaultCategoryId && defaultSubcategoryId) || "",
  })
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
      })
      setSubcategoryPending(false)
    } else {
      // Caso 4: Inicialización inicial sin plato (nuevo plato por defecto)
      log.info("Inicialización sin plato, limpiando formulario")
      setFormData(newDishState())
      setSubcategoryPending(false)
      originalImageUrlRef.current = ""
    }
    // `newDishState` only reads `defaultCategoryId` and `defaultSubcategoryId`.
  }, [dish, categories, isNewDish, defaultCategoryId, defaultSubcategoryId])

  useEffect(() => {
    let live = true
    fetchModifierGroups({ includeInactive: true })
      .then((groups) => live && setModifierGroups(groups))
      .catch((error) => log.error("Error fetching the modifier groups:", { error: String(error) }))
    return () => {
      live = false
    }
  }, [])

  // The dish's own list includes inactive groups, which `dish.modifierGroups` leaves out.
  const editedDishId = !isNewDish && dish ? dish.id : null
  useEffect(() => {
    const initial = editedDishId && dish ? (dish.modifierGroups ?? []).map((g) => g.id) : []
    setGroupIds(initial)
    savedGroupIdsRef.current = initial
    if (!editedDishId) return
    let live = true
    fetchDishModifierGroups(editedDishId)
      .then((ids) => {
        if (!live) return
        setGroupIds(ids)
        savedGroupIdsRef.current = ids
      })
      .catch((error) => log.error("Error fetching the dish modifier groups:", { error: String(error) }))
    return () => {
      live = false
    }
    // Reloads per dish, not when the parent passes a refreshed copy of it.
  }, [editedDishId])

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
      }
      const groupsChanged = groupIds.join() !== savedGroupIdsRef.current.join()

      if (dish) {
        await updateDish(dish.id, dishData)
        if (groupsChanged) savedGroupIdsRef.current = await setDishModifierGroups(dish.id, groupIds)

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
        const created = await createDish(dishData)
        if (groupsChanged) await setDishModifierGroups(created.id, groupIds)
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
        setGroupIds([])
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

  const imageButton = "h-11 w-11 rounded-full shadow-md"

  return (
    <form
      key={`dish-form-${dish?.id || "new"}-${isNewDish ? "new" : "edit"}`}
      onSubmit={handleSubmit}
      aria-label={dish ? `Editar ${dish.name}` : "Nuevo plato"}
      className="grid min-w-0 gap-4 pt-1"
    >
      {/* Sections keep the dialog gutter; the footer spans the full width under them. */}
      <div className="grid min-w-0 gap-4 px-4 sm:px-6">
        <p className="text-[13px] text-muted-fg">
          <span aria-hidden className="text-status-danger-fg">*</span> <span>Obligatorio</span>
        </p>

        <FormSection title="Datos">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="name" className={required}>
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
                className="min-h-11 w-full"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="price" className={required}>
                Precio
              </Label>
              <div className="relative">
                <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg">
                  $
                </span>
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
                  placeholder="0"
                  className="min-h-11 pl-7"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="category_id" className={required}>
                Categoría
              </Label>
              <Select
                key={`category-select-${formData.category_id || "empty"}-${Date.now()}`}
                defaultValue={formData.category_id}
                value={formData.category_id}
                onValueChange={handleCategoryChange}
                required
              >
                <SelectTrigger id="category_id" className="min-h-11 w-full">
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

            <div className="min-w-0 space-y-2">
              <Label htmlFor="subcategory_id">
                Subcategoría
              </Label>
              <Select
                value={subcategoryPending ? "" : formData.subcategory_id || NO_SUBCATEGORY}
                onValueChange={handleSubcategoryChange}
                disabled={!formData.category_id}
              >
                <SelectTrigger
                  id="subcategory_id"
                  className="min-h-11 w-full"
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
                  <p className="text-xs text-muted-fg">Esta categoría no tiene subcategorías: el mesero ve el plato directo.</p>
                )
              )}
            </div>

            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor="description">Descripción</Label>
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
        </FormSection>

        <FormSection title="Imagen">
          <Card className="overflow-hidden rounded-lg border sm:max-w-sm">
            <CardContent className="p-0">
              {formData.image_url ? (
                <div className="relative">
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={imageError ? getPlaceholderUrl(formData.name) : formData.image_url}
                      alt={formData.name || "Vista previa"}
                      fill
                      className="rounded-t-lg object-cover"
                      sizes="(max-width: 640px) 100vw, 384px"
                      onError={handleImageError}
                    />
                    {imageError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
                        <p className="text-sm text-muted-fg">No se pudo cargar la imagen</p>
                      </div>
                    )}
                  </div>

                  <div className="absolute right-2 top-2 flex gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className={imageButton}
                            onClick={handleDeleteImage}
                            disabled={deletingImage}
                            aria-label="Eliminar imagen"
                          >
                            {deletingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
                            className={imageButton}
                            onClick={handleChangeImage}
                            disabled={deletingImage}
                            aria-label="Cambiar imagen"
                          >
                            {deletingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-surface-2">
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
        </FormSection>

        <FormSection title="Disponibilidad">
          <SwitchRow
            id="active"
            label="Activo"
            hint="El plato estará disponible para ordenar."
            checked={formData.active}
            onChange={(checked) => handleSwitchChange("active", checked)}
          />
          {soldOut && (
            <p className="rounded-xl border border-status-warning-line bg-status-warning-bg p-3 text-[13px] text-status-warning-fg">
              <b>Agotado ahora</b> · el inventario no tiene stock suficiente. Se libera solo cuando entra stock; no se cambia aquí.
            </p>
          )}
        </FormSection>

        {(!dish || onOpenFormula) && (
          <FormSection title="Fórmula">
            {dish && onOpenFormula ? (
              <button
                type="button"
                onClick={onOpenFormula}
                className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-card p-2.5 text-left hover:bg-surface-2 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <BookOpen className="h-5 w-5 shrink-0 text-muted-fg" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b className="block text-sm font-semibold">Abrir en Fórmulas</b>
                  <span className="block break-words text-xs text-muted-fg [overflow-wrap:anywhere]">
                    Ingredientes y cantidades de {dish.name}
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
              </button>
            ) : (
              <p className="text-sm text-muted-fg">Guarda el plato para vincular su fórmula en Fórmulas.</p>
            )}
          </FormSection>
        )}

        <DishModifierGroups groups={modifierGroups} value={groupIds} onChange={setGroupIds} />

        <FormSection title="Opciones">
          <SwitchRow
            id="allow_comments"
            label="Permitir comentarios"
            hint="Los clientes podrán añadir instrucciones especiales."
            checked={formData.allow_comments}
            onChange={(checked) => handleSwitchChange("allow_comments", checked)}
          />
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-background px-4 py-3 sm:px-6">
        {onCancel && (
          <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="min-h-11" disabled={loading || deletingImage || subcategoryPending}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {dish ? "Guardar cambios" : "Crear plato"}
        </Button>
      </div>
    </form>
  )
}

/** Marks a field label as required; the "*" is decoration, `required` on the control carries the rule. */
const required = "after:ml-0.5 after:text-status-danger-fg after:content-['*']"

/** One titled block of the dish dialog. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="grid min-w-0 gap-3 rounded-lg border p-4 shadow-sm">
      <h3 id={titleId} className="text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-fg">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
