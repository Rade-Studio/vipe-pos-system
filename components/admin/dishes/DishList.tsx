"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Edit, Trash2, BookOpen } from "lucide-react"
import type { Dish, Category } from "@/types"
import { DishForm } from "./DishForm"
import { useToast } from "@/hooks/use-toast"
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
import { formatCurrency } from "@/utils/helpers"
import { RecipeManager } from "./RecipeManager"
import { Skeleton } from "@/components/ui/skeleton"
import {repositories} from "@/lib";

export function DishList() {
  const [dishes, setDishes] = useState<Dish[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dishToDelete, setDishToDelete] = useState<Dish | null>(null)
  const [showRecipeManager, setShowRecipeManager] = useState(false)
  const [selectedDishForRecipe, setSelectedDishForRecipe] = useState<Dish | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [dishesData, categoriesData] = await Promise.all([repositories.dishes.getAll(), repositories.categories.getAll()])
      setDishes(dishesData)
      setCategories(categoriesData)
    } catch (error) {
      console.error("Error loading data:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar los datos",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddNew = () => {
    setEditingDish(null)
    setShowForm(true)
  }

  const handleEdit = (dish: Dish) => {
    setEditingDish(dish)
    setShowForm(true)
  }

  const handleDelete = (dish: Dish) => {
    setDishToDelete(dish)
    setDeleteDialogOpen(true)
  }

  const handleManageRecipe = (dish: Dish) => {
    setSelectedDishForRecipe(dish)
    setShowRecipeManager(true)
  }

  const confirmDelete = async () => {
    if (!dishToDelete) return

    try {
      await dishService.delete(dishToDelete.id)
      toast({
        title: "Plato eliminado",
        description: "El plato ha sido eliminado correctamente",
      })
      loadData()
    } catch (error) {
      console.error("Error deleting dish:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el plato",
      })
    } finally {
      setDeleteDialogOpen(false)
      setDishToDelete(null)
    }
  }

  const handleFormSubmit = async (dish: Omit<Dish, "id" | "createdAt">) => {
    try {
      if (editingDish) {
        await dishService.update(editingDish.id, dish)
        toast({
          title: "Plato actualizado",
          description: "El plato ha sido actualizado correctamente",
        })
      } else {
        await dishService.create(dish)
        toast({
          title: "Plato creado",
          description: "El plato ha sido creado correctamente",
        })
      }
      setShowForm(false)
      loadData()
    } catch (error) {
      console.error("Error saving dish:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo guardar el plato",
      })
    }
  }

  const getCategoryName = (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId)
    return category ? category.name : "Sin categoría"
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Platos</CardTitle>
        <Button onClick={handleAddNew}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Plato
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="w-full">
            <div className="rounded-md border">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50">
                    <th className="h-12 px-4 text-left align-middle font-medium">
                      <Skeleton className="h-4 w-20" />
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium">
                      <Skeleton className="h-4 w-24" />
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium">
                      <Skeleton className="h-4 w-16" />
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium">
                      <Skeleton className="h-4 w-24" />
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
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="p-4 align-middle">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="p-4 align-middle">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="p-4 align-middle">
                        <Skeleton className="h-6 w-24 rounded-full" />
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex justify-end gap-2">
                          <Skeleton className="h-8 w-20 rounded-md" />
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
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Disponible</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dishes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    No hay platos disponibles
                  </TableCell>
                </TableRow>
              ) : (
                dishes.map((dish) => (
                  <TableRow key={dish.id}>
                    <TableCell className="font-medium">{dish.name}</TableCell>
                    <TableCell>{getCategoryName(dish.categoryId)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(dish.price)}</TableCell>
                    <TableCell>
                      <Badge variant={dish.available ? "default" : "destructive"}>
                        {dish.available ? "Disponible" : "No disponible"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleManageRecipe(dish)} className="mr-2">
                        <BookOpen className="h-4 w-4 mr-2" />
                        Receta
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(dish)} title="Editar plato">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(dish)} title="Eliminar plato">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <DishForm
        open={showForm}
        onOpenChange={setShowForm}
        dish={editingDish}
        categories={categories}
        onSubmit={handleFormSubmit}
      />

      <RecipeManager
        open={showRecipeManager}
        onOpenChange={setShowRecipeManager}
        dish={selectedDishForRecipe}
        onSuccess={() => {
          setShowRecipeManager(false)
          loadData()
        }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el plato{" "}
              <span className="font-bold">{dishToDelete?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
