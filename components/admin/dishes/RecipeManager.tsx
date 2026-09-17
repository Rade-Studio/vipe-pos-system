"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Plus, Trash2, AlertCircle, RefreshCw, Check, ChevronsUpDown } from "lucide-react"
import { DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { recipeService, ingredientService } from "@/lib/supabase"
import type { Dish, Ingredient, Recipe, RecipeIngredient } from "@/types"
import { log } from "@/lib/log"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useConfigStore } from "@/store/use-config-store"
import { formatCurrency } from "@/utils/helpers"


interface RecipeManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dish: Dish | null
  onSuccess: () => void
}

export function RecipeManager({ open, onOpenChange, dish, onSuccess }: RecipeManagerProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredient[]>([])
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [newIngredient, setNewIngredient] = useState({
    ingredientId: "",
    quantity: 1,
  })
  const [maxServings, setMaxServings] = useState<number | null>(null)
  const [limitingIngredient, setLimitingIngredient] = useState<string | null>(null)
  const [openCombobox, setOpenCombobox] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const { priceSuggestion } = useConfigStore()

  useEffect(() => {
    if (open && dish) {
      loadData()
    } else {
      resetForm()
    }
  }, [open, dish])

  // Efecto para filtrar ingredientes cuando cambia la búsqueda o la lista de ingredientes

  const loadData = async () => {
    if (!dish) return

    try {
      setLoading(true)
      // Cargar ingredientes disponibles
      const ingredientsData = await ingredientService.getAll()
      log.info("Ingredientes cargados:", { ingredientsData })
      setIngredients(ingredientsData)

      // Buscar si ya existe una receta para este plato
      const recipeData = await recipeService.getByDishId(dish.id)

      if (recipeData) {
        setRecipe(recipeData)
        // Cargar los ingredientes de la receta
        const recipeIngredientsData = await recipeService.getRecipeIngredients(recipeData.id)

        // Enriquecer los datos de los ingredientes de la receta con información completa
        const enrichedRecipeIngredients = recipeIngredientsData.map((recipeIng) => {
          const fullIngredient = ingredientsData.find((ing) => ing.id === recipeIng.ingredientId)
          return {
            ...recipeIng,
            ingredient: {
              name: fullIngredient?.name || recipeIng.ingredient?.name || "Desconocido",
              unit: fullIngredient?.unit || recipeIng.ingredient?.unit || "",
              stock: fullIngredient?.stock || 0,
            },
          }
        })

        setRecipeIngredients(enrichedRecipeIngredients)

        // Calcular cuántos platos se pueden preparar con el stock actual
        calculateMaxServings(enrichedRecipeIngredients, ingredientsData)
      } else {
        setRecipe(null)
        setRecipeIngredients([])
        setMaxServings(null)
        setLimitingIngredient(null)
      }
    } catch (error) {
      log.error("Error loading recipe data:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar los datos de la receta",
      })
    } finally {
      setLoading(false)
    }
  }
  // Función para refrescar la lista de ingredientes
  const refreshIngredients = async () => {
    try {
      setRefreshing(true)
      const ingredientsData = await ingredientService.getAll()
      setIngredients(ingredientsData)
      toast({
        title: "Ingredientes actualizados",
        description: "La lista de ingredientes ha sido actualizada",
      })
    } catch (error) {
      log.error("Error refreshing ingredients:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron actualizar los ingredientes",
      })
    } finally {
      setRefreshing(false)
    }
  }
  // Función para calcular el máximo de platos que se pueden preparar
  const calculateMaxServings = (recipeItems: RecipeIngredient[], allIngredients: Ingredient[]) => {
    if (!recipeItems.length) {
      setMaxServings(null)
      setLimitingIngredient(null)
      return
    }

    let minServings = Number.POSITIVE_INFINITY
    let limitingIngName = null

    recipeItems.forEach((item) => {
      const ingredient = allIngredients.find((ing) => ing.id === item.ingredientId)
      if (ingredient) {
        const possibleServings = Math.floor(ingredient.stock / item.quantity)
        if (possibleServings < minServings) {
          minServings = possibleServings
          limitingIngName = ingredient.name
        }
      }
    })

    setMaxServings(minServings === Number.POSITIVE_INFINITY ? 0 : minServings)
    setLimitingIngredient(limitingIngName)
  }
  // Función para resetear el formulario y los estados
  const resetForm = () => {
    setRecipe(null)
    setRecipeIngredients([])
    setNewIngredient({
      ingredientId: "",
      quantity: 1,
    })
    setMaxServings(null)
    setLimitingIngredient(null)
    setSearchQuery("")
  }
  // Función para añadir un ingrediente a la receta
  const handleAddIngredient = async () => {
    if (!dish || !newIngredient.ingredientId || newIngredient.quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor selecciona un ingrediente y una cantidad válida",
      })
      return
    }
    try {
      setLoading(true)

      // Verificar que el ingrediente existe en la lista actual
      const selectedIngredient = ingredients.find((ing) => ing.id === newIngredient.ingredientId)
      if (!selectedIngredient) {
        // Si no se encuentra el ingrediente, intentar recargar la lista
        await refreshIngredients()

        // Verificar nuevamente después de recargar
        const refreshedIngredient = ingredients.find((ing) => ing.id === newIngredient.ingredientId)
        if (!refreshedIngredient) {
          throw new Error(`No se encontró el ingrediente con ID: ${newIngredient.ingredientId}`)
        }
      }

      // Si no existe una receta, crearla primero
      let recipeId = recipe?.id
      if (!recipeId) {
        const newRecipe = await recipeService.create({
          dishId: dish.id,
        })
        setRecipe(newRecipe)
        recipeId = newRecipe.id
      }

      // Verificar si el ingrediente ya existe en la receta
      const existingIngredient = recipeIngredients.find((item) => item.ingredientId === newIngredient.ingredientId)

      if (existingIngredient) {
        log.info("Ingrediente existente encontrado, actualizando cantidad:", { existingIngredient })

        // Actualizar la cantidad del ingrediente existente
        const updatedIngredient = await recipeService.updateRecipeIngredient(existingIngredient.id, {
          quantity: existingIngredient.quantity + newIngredient.quantity,
        })

        // Obtener el ingrediente completo de la lista de ingredientes
        const ingredientDetails = ingredients.find((ing) => ing.id === updatedIngredient.ingredientId)

        // Actualizar el ingrediente en la lista con datos completos
        setRecipeIngredients(
          recipeIngredients.map((item) =>
            item.id === updatedIngredient.id
              ? {
                  ...updatedIngredient,
                  ingredient: {
                    name: ingredientDetails?.name || existingIngredient.ingredient?.name || "Desconocido",
                    unit: ingredientDetails?.unit || existingIngredient.ingredient?.unit || "",
                    stock: ingredientDetails?.stock || 0,
                  },
                }
              : item,
          ),
        )

        toast({
          title: "Ingrediente actualizado",
          description: "Se ha actualizado la cantidad del ingrediente en la receta",
        })
      } else {
        log.info("Añadiendo nuevo ingrediente a la receta:", { newIngredient })

        try {
          // Guardar el ID del ingrediente antes de la llamada a la API
          const ingredientIdToAdd = newIngredient.ingredientId

          // Añadir nuevo ingrediente a la receta
          const addedIngredient = await recipeService.addIngredientToRecipe({
            recipeId,
            ingredientId: ingredientIdToAdd,
            quantity: newIngredient.quantity,
          })

          log.info("Ingrediente añadido:", { addedIngredient })

          // Usar el ID del ingrediente que conocemos, en caso de que la respuesta no lo incluya
          const ingredientId = addedIngredient.ingredientId || ingredientIdToAdd

          if (!ingredientId) {
            throw new Error("No se pudo determinar el ID del ingrediente añadido")
          }

          // Obtener el ingrediente completo de la lista de ingredientes
          const ingredientDetails = ingredients.find((ing) => ing.id === ingredientId)

          // Verificar que se encontró el ingrediente
          if (!ingredientDetails) {
            log.warn(
              "No se encontró el ingrediente después de añadirlo. Usando datos del ingrediente seleccionado.",
            )

            // Usar los datos del ingrediente seleccionado originalmente
            const newRecipeIngredient = {
              id: addedIngredient.id || `temp-${Date.now()}`,
              recipeId: addedIngredient.recipeId || recipeId,
              ingredientId: ingredientId,
              quantity: addedIngredient.quantity || newIngredient.quantity,
              createdAt: addedIngredient.createdAt || new Date().toISOString(),
              ingredient: {
                name: selectedIngredient.name,
                unit: selectedIngredient.unit,
                stock: selectedIngredient.stock,
              },
            }

            setRecipeIngredients([...recipeIngredients, newRecipeIngredient])

            toast({
              title: "Ingrediente añadido",
              description: "El ingrediente ha sido añadido a la receta",
            })
          } else {
            log.info("Detalles del ingrediente encontrado:", { ingredientDetails })

            // Crear un objeto completo con todos los datos necesarios
            const newRecipeIngredient = {
              id: addedIngredient.id || `temp-${Date.now()}`,
              recipeId: addedIngredient.recipeId || recipeId,
              ingredientId: ingredientId,
              quantity: addedIngredient.quantity || newIngredient.quantity,
              createdAt: addedIngredient.createdAt || new Date().toISOString(),
              ingredient: {
                name: ingredientDetails.name,
                unit: ingredientDetails.unit,
                stock: ingredientDetails.stock,
              },
            }

            setRecipeIngredients([...recipeIngredients, newRecipeIngredient])

            toast({
              title: "Ingrediente añadido",
              description: "El ingrediente ha sido añadido a la receta",
            })
          }

          // Recargar datos para asegurar consistencia
          loadData()
        } catch (error: any) {
          log.error("Error al añadir ingrediente:", { error: String(error) })

          // Si el error es por duplicado, intentar actualizar en su lugar
          if (error.message && error.message.includes("duplicate key value")) {
            log.info("Error de duplicado detectado, intentando actualizar en su lugar")

            // Recargar los ingredientes de la receta para obtener el ID del ingrediente existente
            const recipeIngredientsData = await recipeService.getRecipeIngredients(recipeId)
            const duplicateIngredient = recipeIngredientsData.find(
              (item) => item.ingredientId === newIngredient.ingredientId,
            )

            if (duplicateIngredient) {
              // Actualizar la cantidad del ingrediente existente
              const updatedIngredient = await recipeService.updateRecipeIngredient(duplicateIngredient.id, {
                quantity: duplicateIngredient.quantity + newIngredient.quantity,
              })

              // Recargar todos los datos para asegurar consistencia
              await loadData()

              toast({
                title: "Ingrediente actualizado",
                description: "Se ha actualizado la cantidad del ingrediente en la receta",
              })
            } else {
              throw new Error("No se pudo encontrar el ingrediente duplicado")
            }
          } else {
            throw error
          }
        }
      }

      // Resetear el formulario de nuevo ingrediente
      setNewIngredient({
        ingredientId: "",
        quantity: 1,
      })
      setSearchQuery("")
      setOpenCombobox(false)

      // Recalcular el máximo de platos que se pueden preparar con los datos actualizados
      calculateMaxServings(recipeIngredients, ingredients)
    } catch (error) {
      log.error("Error adding ingredient:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error al añadir ingrediente",
        description: error instanceof Error ? error.message : "No se pudo añadir el ingrediente a la receta",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveIngredient = async (ingredientId: string) => {
    try {
      setLoading(true)
      await recipeService.removeIngredientFromRecipe(ingredientId)

      const updatedIngredients = recipeIngredients.filter((item) => item.id !== ingredientId)
      setRecipeIngredients(updatedIngredients)

      // Recalcular el máximo de platos que se pueden preparar
      calculateMaxServings(updatedIngredients, ingredients)

      toast({
        title: "Ingrediente eliminado",
        description: "El ingrediente ha sido eliminado de la receta",
      })
    } catch (error) {
      log.error("Error removing ingredient:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el ingrediente de la receta",
      })
    } finally {
      setLoading(false)
    }
  }

  const calculateTotalCost = () => {
    return recipeIngredients.reduce((total, item) => {
      const ingredientData = ingredients.find((ing) => ing.id === item.ingredientId)
      const cost = ingredientData?.cost || 0
      return total + cost * item.quantity
    }, 0)
  }

  return (
    <>
      {loading && (
        <div className="flex justify-center items-center py-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2">Cargando datos...</span>
        </div>
      )}

      {!loading && (
        <div className="space-y-4 max-h-[80vh] overflow-y-auto px-1">
          {maxServings !== null && (
            <Alert
              className={`
    ${
      maxServings === 0
        ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-950"
        : maxServings < 5
          ? "border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-amber-950"
          : "border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-950"
    }
    border-l-4 dark:text-white text-sm
  `}
            >
              <AlertCircle
                className={
                  maxServings === 0
                    ? "text-red-500 dark:text-red-400"
                    : maxServings < 5
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-green-500 dark:text-green-400"
                }
              />
              <AlertTitle className="font-bold text-base">
                {maxServings === 0 ? "No hay suficientes ingredientes" : `Se pueden preparar ${maxServings} platos`}
              </AlertTitle>
              <AlertDescription className="mt-1">
                {limitingIngredient && maxServings < 10 && `El ingrediente limitante es: ${limitingIngredient}`}
                {maxServings === 0 && " Necesitas añadir más ingredientes al inventario para poder preparar este plato."}
                {maxServings > 0 &&
                  maxServings < 5 &&
                  "El stock de ingredientes está bajo. Considera reabastecer pronto."}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Ingredientes de la receta</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshIngredients}
              disabled={refreshing}
              className="flex items-center gap-1"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar ingredientes
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ingredientId">Ingrediente</Label>
              <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openCombobox}
                    className="w-full justify-between"
                  >
                    {newIngredient.ingredientId
                      ? ingredients.find((ing) => ing.id === newIngredient.ingredientId)?.name ||
                        "Seleccionar ingrediente"
                      : "Seleccionar ingrediente"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Buscar ingrediente..."
                      value={searchQuery}
                      onValueChange={(value) => {
                        setSearchQuery(value)
                      }}
                      className="h-9"
                    />
                    <CommandList>
                      <CommandEmpty>No se encontraron ingredientes.</CommandEmpty>
                      <CommandGroup>
                        {ingredients
                          .filter((ingredient) => {
                            if (!searchQuery.trim()) return true
                            const normalizedQuery = searchQuery.toLowerCase().trim()
                            return ingredient.name.toLowerCase().startsWith(normalizedQuery)
                          })
                          .map((ingredient) => (
                            <CommandItem
                              key={ingredient.id}
                              value={ingredient.id}
                              onSelect={() => {
                                setNewIngredient({ ...newIngredient, ingredientId: ingredient.id })
                                setOpenCombobox(false)
                              }}
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center">
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      newIngredient.ingredientId === ingredient.id ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <span>{ingredient.name.toUpperCase()}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Badge variant={ingredient.stock < 5 ? "destructive" : "outline"} className="ml-2">
                                    {ingredient.stock} {ingredient.unit}
                                  </Badge>
                                  {ingredient.cost && (
                                    <span className="text-xs text-muted-foreground">
                                      ${ingredient.cost.toFixed(2)}/{ingredient.unit}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Cantidad</Label>
              <div className="flex items-center space-x-2">
                <Input
                  id="quantity"
                  type="number"
                  value={newIngredient.quantity}
                  onChange={(e) =>
                    setNewIngredient({
                      ...newIngredient,
                      quantity: Number.parseFloat(e.target.value),
                    })
                  }
                />
                <span className="text-sm text-gray-500 dark:text-gray-400 min-w-16">
                  {newIngredient.ingredientId &&
                    (ingredients.find((ing) => ing.id === newIngredient.ingredientId)?.unit || "")}
                </span>
              </div>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleAddIngredient}
                disabled={loading || refreshing || !newIngredient.ingredientId || newIngredient.quantity <= 0}
                className="w-full"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Plus className="mr-2 h-4 w-4" />
                Añadir Ingrediente
              </Button>
            </div>
          </div>

          <div className="mt-4 mb-2">
            <h4 className="text-sm font-medium mb-2">Ingredientes comunes (clic para añadir rápidamente)</h4>
            <div className="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto p-1">
              {ingredients
                .filter((ing) =>
                  ["sal", "aceite", "pimienta", "ajo", "cebolla", "agua"].some((common) =>
                    ing.name.toLowerCase().includes(common.toLowerCase()),
                  ),
                )
                .slice(0, 8)
                .map((ing) => (
                  <Badge
                    key={ing.id}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/10"
                    onClick={() => {
                      setNewIngredient({ ingredientId: ing.id, quantity: 1 })
                    }}
                  >
                    {ing.name} ({ing.stock} {ing.unit})
                  </Badge>
                ))}
            </div>
          </div>

          <div className="border rounded-md overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto">
              <div className="min-w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingrediente</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>Stock Disponible</TableHead>
                      <TableHead>Costo</TableHead>
                      <TableHead className="w-[80px]">Eliminar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipeIngredients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-4">
                          No hay ingredientes en la receta
                        </TableCell>
                      </TableRow>
                    ) : (
                      recipeIngredients.map((item) => {
                        // Buscar el ingrediente completo en la lista de ingredientes
                        const ingredientData = ingredients.find((ing) => ing.id === item.ingredientId)

                        // Usar los datos del ingrediente encontrado o los datos del item
                        const ingredientName = ingredientData?.name || item.ingredient?.name || "Desconocido"
                        const ingredientUnit = ingredientData?.unit || item.ingredient?.unit || ""
                        const stock = ingredientData?.stock || item.ingredient?.stock || 0
                        const isLow = stock < item.quantity
                        const cost = ingredientData?.cost || 0
                        const itemCost = cost * item.quantity

                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{ingredientName}</TableCell>
                            <TableCell>
                              {item.quantity} {ingredientUnit}
                            </TableCell>
                            <TableCell>
                              <Badge variant={isLow ? "destructive" : "outline"}>
                                {stock} {ingredientUnit}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {itemCost > 0 ? (
                                <span>${itemCost.toFixed(2)}</span>
                              ) : (
                                <span className="text-muted-foreground text-xs">No disponible</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveIngredient(item.id)}
                                disabled={loading}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                    {recipeIngredients.length > 0 && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={3} className="text-right font-medium">
                          Costo total estimado:
                        </TableCell>
                        <TableCell colSpan={2} className="font-bold">
                          ${calculateTotalCost().toFixed(2)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {recipeIngredients.length > 0 && (
            <div className="mt-4 p-3 bg-muted/30 rounded-lg">
              <div className="flex flex-col sm:flex-row justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">Precio de venta sugerido: </span>
                  <span className="font-bold">{formatCurrency(calculateTotalCost() * (priceSuggestion / 100))}</span>
                  <span className="text-xs text-muted-foreground ml-1">(margen del {priceSuggestion}%)</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Precio actual: </span>
                  <span className="font-bold">{formatCurrency(dish?.price || 0)}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </div>
      )}
    </>
  )
}
