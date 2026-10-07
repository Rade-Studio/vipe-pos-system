"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import { log } from "@/lib/log"
import { Edit, Plus, Search, Trash, BookOpen } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { DishForm } from "./DishForm"
import { formatCurrency } from "@/utils/helpers"
import { RecipeManager } from "@/components/admin/dishes/RecipeManager"
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"

export function DishList() {
  const { toast } = useToast()
  const [dishes, setDishes] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [selectedDish, setSelectedDish] = useState<any>(null)
  const [openRecipeDialog, setOpenRecipeDialog] = useState(false)
  const [recipeSelectedDish, setRecipeSelectedDish] = useState<any>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch dishes
      const { data: dishesData, error: dishesError } = await supabase.from("dishes").select("*").order("name")

      if (dishesError) throw dishesError

      // Fetch categories
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("categories")
        .select("*")
        .order("name")

      if (categoriesError) throw categoriesError

      setDishes(dishesData || [])
      setCategories(categoriesData || [])
    } catch (error: any) {
      log.error("Error fetching data:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar los datos: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleEdit = (dish: any) => {
    setSelectedDish(dish)
    setOpenDialog(true)
  }

  const handleDelete = async () => {
    if (!selectedDish) return

    try {
      const { error } = await supabase.from("dishes").delete().eq("id", selectedDish.id)

      if (error) throw error

      toast({
        title: "Plato eliminado",
        description: `El plato ${selectedDish.name} ha sido eliminado correctamente.`,
      })

      fetchData()
    } catch (error: any) {
      log.error("Error deleting dish:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al eliminar el plato: ${error.message}`,
      })
    } finally {
      setOpenDeleteDialog(false)
      setSelectedDish(null)
    }
  }

  const confirmDelete = (dish: any) => {
    setSelectedDish(dish)
    setOpenDeleteDialog(true)
  }

  const handleDialogClose = () => {
    setOpenDialog(false)
    if (!openDialog) {
      setSelectedDish(null)
    }
  }

  const filteredDishes = useMemo(() => {
    return dishes.filter((dish) => dish.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [dishes, searchTerm])

  // Usar el hook de paginación
  const { currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData } = usePagination({
    data: filteredDishes,
    initialItemsPerPage: 10,
  })

  const getCategoryName = (categoryId: string) => {
    const category = categories.find((cat) => cat.id === categoryId)
    return category ? category.name : "-"
  }

  const handleManageRecipe = (dish: any) => {
    setRecipeSelectedDish(dish)
    setOpenRecipeDialog(true)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Platos del Menú</CardTitle>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() => {
                setSelectedDish(null)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Plato
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{selectedDish ? "Editar Plato" : "Nuevo Plato"}</DialogTitle>
            </DialogHeader>
            <DishForm
              dish={selectedDish}
              categories={categories}
              onSuccess={() => {
                fetchData()
                handleDialogClose()
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="flex items-center mb-4">
          <Search className="mr-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar platos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {loading ? (
          <div className="text-center py-4">Cargando platos...</div>
        ) : filteredDishes.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            {searchTerm ? "No se encontraron platos con ese término de búsqueda" : "No hay platos registrados"}
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedData.map((dish) => (
                    <TableRow key={dish.id}>
                      <TableCell className="font-medium">{dish.name}</TableCell>
                      <TableCell>{getCategoryName(dish.category_id)}</TableCell>
                      <TableCell>{formatCurrency(dish.price)}</TableCell>
                      <TableCell>
                        <Badge variant={dish.active ? "default" : "secondary"}>
                          {dish.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleManageRecipe(dish)} className="mr-1">
                          <BookOpen className="h-4 w-4 mr-1" />
                          Receta
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(dish)}>
                          <Edit className="h-4 w-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => confirmDelete(dish)}>
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
                Mostrando {paginatedData.length} de {filteredDishes.length} platos
              </div>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          </>
        )}

        {/* Diálogo para gestionar recetas */}
        <Dialog open={openRecipeDialog} onOpenChange={setOpenRecipeDialog}>
          <DialogContent className="sm:max-w-[700px]">
            <DialogHeader>
              <DialogTitle>Gestionar Receta: {recipeSelectedDish?.name}</DialogTitle>
            </DialogHeader>
            {recipeSelectedDish && (
              <RecipeManager
                open={openRecipeDialog}
                onOpenChange={setOpenRecipeDialog}
                dish={recipeSelectedDish}
                onSuccess={() => {
                  fetchData()
                  setOpenRecipeDialog(false)
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={openDeleteDialog} onOpenChange={setOpenDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará permanentemente el plato <strong>{selectedDish?.name}</strong> y no se puede
                deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
