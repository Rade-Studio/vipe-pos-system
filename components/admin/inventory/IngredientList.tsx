"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IngredientForm } from "./IngredientForm"
import { StockTransactionForm } from "./StockTransactionForm"
import { log } from "@/lib/log"
import { useToast } from "@/hooks/use-toast"
import { ingredientService } from "@/lib/supabase"
import { AlertCircle, Edit, Plus, Search, Trash, Package, Filter } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StockTransactionsList } from "./StockTransactionsList"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ingredientCategoryService } from "@/lib/supabase"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/helpers"
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"

export function IngredientList() {
  const { toast } = useToast()
  const [ingredients, setIngredients] = useState<any[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [showLowStock, setShowLowStock] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)
  const [openStockDialog, setOpenStockDialog] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [selectedIngredient, setSelectedIngredient] = useState<any>(null)
  const [activeTab, setActiveTab] = useState("ingredients")

  const fetchIngredients = async () => {
    setLoading(true)
    try {
      // Primero obtenemos las categorías
      const categoriesData = await ingredientCategoryService.getAll()

      // Luego obtenemos los ingredientes
      const data = await ingredientService.getAll()

      // Enriquecemos los ingredientes con los nombres de las categorías
      const enrichedIngredients = data.map((ingredient) => {
        const category = categoriesData.find((cat) => cat.id === ingredient.category_id)
        return {
          ...ingredient,
          category: category?.name || "Sin categoría",
        }
      })

      setIngredients(enrichedIngredients)

      // Extraer categorías únicas para el filtro
      const uniqueCategories = Array.from(new Set(categoriesData.map((cat) => cat.name))).filter(Boolean) as string[]

      setCategories(uniqueCategories)
    } catch (error: any) {
      log.error("Error fetching ingredients:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar los ingredientes: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIngredients()
  }, [])

  const handleEdit = (ingredient: any) => {
    setSelectedIngredient(ingredient)
    setOpenDialog(true)
  }

  const handleStockTransaction = (ingredient: any) => {
    setSelectedIngredient(ingredient)
    setOpenStockDialog(true)
  }

  const handleDelete = async () => {
    if (!selectedIngredient) return

    try {
      await ingredientService.delete(selectedIngredient.id)

      toast({
        title: "Ingrediente eliminado",
        description: `El ingrediente ${selectedIngredient.name} ha sido eliminado correctamente.`,
      })

      fetchIngredients()
    } catch (error: any) {
      log.error("Error deleting ingredient:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al eliminar el ingrediente: ${error.message}`,
      })
    } finally {
      setOpenDeleteDialog(false)
      setSelectedIngredient(null)
    }
  }

  const confirmDelete = (ingredient: any) => {
    setSelectedIngredient(ingredient)
    setOpenDeleteDialog(true)
  }

  const handleDialogClose = () => {
    setOpenDialog(false)
    setSelectedIngredient(null)
  }

  const handleStockDialogClose = () => {
    setOpenStockDialog(false)
    setSelectedIngredient(null)
  }

  // Aplicar filtros a los ingredientes
  const filteredIngredients = useMemo(() => {
    return ingredients.filter((ingredient) => {
      // Filtro por término de búsqueda
      const matchesSearch = ingredient.name.toLowerCase().includes(searchTerm.toLowerCase())

      // Filtro por categoría
      const matchesCategory = categoryFilter === "all" || ingredient.category === categoryFilter

      // Filtro por stock mínimo
      const matchesLowStock = !showLowStock || ingredient.stock <= ingredient.min_stock

      return matchesSearch && matchesCategory && matchesLowStock
    })
  }, [ingredients, searchTerm, categoryFilter, showLowStock])

  // Usar el hook de paginación
  const { currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData } = usePagination({
    data: filteredIngredients,
    initialItemsPerPage: 10,
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Inventario de Ingredientes</CardTitle>
        <div className="flex space-x-2">
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => {
                  setSelectedIngredient(null)
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Ingrediente
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{selectedIngredient ? "Editar Ingrediente" : "Nuevo Ingrediente"}</DialogTitle>
              </DialogHeader>
              <IngredientForm
                ingredient={selectedIngredient}
                onSuccess={() => {
                  fetchIngredients()
                  handleDialogClose()
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ingredients" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="ingredients">Ingredientes</TabsTrigger>
            <TabsTrigger value="transactions">Transacciones de Stock</TabsTrigger>
          </TabsList>

          <TabsContent value="ingredients">
            <div className="flex flex-col space-y-4 mb-4">
              {/* Barra de búsqueda */}
              <div className="flex items-center">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar ingredientes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
                />
              </div>

              {/* Filtros */}
              <div className="flex flex-wrap items-center gap-4 bg-muted/50 p-4 rounded-md">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filtros:</span>
                </div>

                {/* Filtro por categoría */}
                <div className="flex items-center gap-2">
                  <span className="text-sm">Categoría:</span>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Todas las categorías" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las categorías</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Filtro por stock mínimo */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="lowStock"
                    checked={showLowStock}
                    onCheckedChange={(checked) => setShowLowStock(checked === true)}
                  />
                  <Label htmlFor="lowStock" className="text-sm">
                    Mostrar solo stock bajo mínimo
                  </Label>
                </div>

                {/* Botón para limpiar filtros */}
                {(categoryFilter !== "all" || showLowStock || searchTerm) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCategoryFilter("all")
                      setShowLowStock(false)
                      setSearchTerm("")
                    }}
                  >
                    Limpiar filtros
                  </Button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="rounded-md border">
                <div className="p-4">
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
                <div className="relative w-full overflow-auto">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors hover:bg-muted/50">
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-20" />
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-16" />
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-16" />
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-24" />
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-16" />
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium">
                          <Skeleton className="h-4 w-20" />
                        </th>
                        <th className="h-12 px-4 text-right align-middle font-medium">
                          <Skeleton className="h-4 w-20 ml-auto" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="border-b transition-colors hover:bg-muted/50">
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-24" />
                          </td>
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-10" />
                          </td>
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-16" />
                          </td>
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-10" />
                          </td>
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-16" />
                          </td>
                          <td className="p-4 align-middle">
                            <Skeleton className="h-4 w-20" />
                          </td>
                          <td className="p-4 align-middle text-right">
                            <div className="flex justify-end gap-2">
                              <Skeleton className="h-8 w-8 rounded-full" />
                              <Skeleton className="h-8 w-8 rounded-full" />
                              <Skeleton className="h-8 w-8 rounded-full" />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : filteredIngredients.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                {searchTerm || categoryFilter !== "all" || showLowStock
                  ? "No se encontraron ingredientes con los filtros aplicados"
                  : "No hay ingredientes registrados"}
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead>Stock Mínimo</TableHead>
                        <TableHead>Costo</TableHead>
                        <TableHead>Categoría</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedData.map((ingredient) => (
                        <TableRow key={ingredient.id}>
                          <TableCell className="font-medium">{ingredient.name}</TableCell>
                          <TableCell>
                            <span
                              className={
                                ingredient.stock <= ingredient.min_stock
                                  ? "text-red-500 font-medium flex items-center"
                                  : ""
                              }
                            >
                              {ingredient.stock <= ingredient.min_stock && <AlertCircle className="h-4 w-4 mr-1" />}
                              {ingredient.stock}
                            </span>
                          </TableCell>
                          <TableCell>{ingredient.unit}</TableCell>
                          <TableCell>{ingredient.min_stock}</TableCell>
                          <TableCell className="text-right">{formatCurrency(ingredient.cost)}</TableCell>
                          <TableCell>
                            {ingredient.category ||
                              (ingredient.category_id ? "Categoría no encontrada" : "Sin categoría")}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => handleStockTransaction(ingredient)}>
                              <Package className="h-4 w-4" />
                              <span className="sr-only">Stock</span>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(ingredient)}>
                              <Edit className="h-4 w-4" />
                              <span className="sr-only">Editar</span>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => confirmDelete(ingredient)}>
                              <Trash className="h-4 w-4" />
                              <span className="sr-only">Eliminar</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Paginación */}
                <div className="flex items-center justify-between mt-4">
                  <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]} />
                  <div className="text-sm text-muted-foreground">
                    Mostrando {paginatedData.length} de {filteredIngredients.length} ingredientes
                  </div>
                  <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                </div>
              </>
            )}

            <Dialog open={openStockDialog} onOpenChange={setOpenStockDialog}>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>Registrar Transacción de Stock</DialogTitle>
                </DialogHeader>
                <StockTransactionForm
                  ingredientId={selectedIngredient?.id}
                  onSuccess={() => {
                    fetchIngredients()
                    handleStockDialogClose()
                  }}
                />
              </DialogContent>
            </Dialog>

            <AlertDialog open={openDeleteDialog} onOpenChange={setOpenDeleteDialog}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción eliminará permanentemente el ingrediente <strong>{selectedIngredient?.name}</strong> y
                    no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="transactions">
            <StockTransactionsList />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
