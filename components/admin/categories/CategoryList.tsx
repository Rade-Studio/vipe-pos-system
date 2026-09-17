"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Edit, Trash2 } from "lucide-react"
import { categoryService } from "@/lib/supabase/service"
import type { Category } from "@/types"
import { log } from "@/lib/log"
import { CategoryForm } from "../menu/CategoryForm"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

export function CategoryList() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    try {
      setLoading(true)
      const data = await categoryService.getAll()
      setCategories(data)
    } catch (error) {
      log.error("Error loading categories:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar las categorías",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddNew = () => {
    setEditingCategory(null)
    setShowForm(true)
  }

  const handleEdit = (category: Category) => {
    setEditingCategory(category)
    setShowForm(true)
  }

  const handleDelete = (category: Category) => {
    setCategoryToDelete(category)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!categoryToDelete) return

    try {
      await categoryService.delete(categoryToDelete.id)
      toast({
        title: "Categoría eliminada",
        description: "La categoría ha sido eliminada correctamente",
      })
      loadCategories()
    } catch (error) {
      log.error("Error deleting category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar la categoría",
      })
    } finally {
      setDeleteDialogOpen(false)
      setCategoryToDelete(null)
    }
  }

  const handleFormSubmit = async (category: any) => {
    try {
      if (editingCategory) {
        await categoryService.update(editingCategory.id, category)
        toast({
          title: "Categoría actualizada",
          description: "La categoría ha sido actualizada correctamente",
        })
      } else {
        await categoryService.create(category)
        toast({
          title: "Categoría creada",
          description: "La categoría ha sido creada correctamente",
        })
      }
      setShowForm(false)
      loadCategories()
    } catch (error) {
      log.error("Error saving category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo guardar la categoría",
      })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Categorías</CardTitle>
        <Button onClick={handleAddNew}>
          <Plus className="mr-2 h-4 w-4" />
          <span>Nueva Categoría</span>
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
                      <Skeleton className="h-4 w-16" />
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium">
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {[1, 2, 3, 4].map((i) => (
                    <tr key={i} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4 align-middle">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="p-4 align-middle">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex justify-end gap-2">
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
                <TableHead>Icono</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8">
                    No hay categorías disponibles
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>{category.icon}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(category)}>
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Editar</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(category)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Modal para crear/editar categoría */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Editar Categoría" : "Nueva Categoría"}</DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Modifica los detalles de la categoría existente."
                : "Completa los campos para crear una nueva categoría."}
            </DialogDescription>
          </DialogHeader>
          <CategoryForm
            category={editingCategory}
            onSuccess={() => {
              setShowForm(false)
              loadCategories()
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente la categoría{" "}
              <span className="font-bold">{categoryToDelete?.name}</span>.
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
