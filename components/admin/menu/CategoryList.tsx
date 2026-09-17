"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import { Edit, Plus, Search, Trash } from "lucide-react"
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
import { CategoryForm } from "./CategoryForm"
import * as LucideIcons from "lucide-react"

export function CategoryList() {
  const { toast } = useToast()
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<any>(null)

  const fetchCategories = async () => {
    setLoading(true)
    try {
      // Ya no necesitamos crear el cliente aquí, ya lo importamos
      const { data, error } = await supabase.from("categories").select("*").order("name")

      if (error) throw error

      setCategories(data || [])
    } catch (error: any) {
      log.error("Error fetching categories:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar las categorías: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  const handleEdit = (category: any) => {
    setSelectedCategory(category)
    setOpenDialog(true)
  }

  const handleDelete = async () => {
    if (!selectedCategory) return

    try {
      // Ya no necesitamos crear el cliente aquí, ya lo importamos

      // Primero verificar si hay platos asociados a esta categoría
      const { data: dishes, error: dishesError } = await supabase
        .from("dishes")
        .select("id")
        .eq("category_id", selectedCategory.id)
        .limit(1)

      if (dishesError) throw dishesError

      if (dishes && dishes.length > 0) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se puede eliminar la categoría porque tiene platos asociados.",
        })
        setOpenDeleteDialog(false)
        return
      }

      // Si no hay platos, proceder con la eliminación
      const { error } = await supabase.from("categories").delete().eq("id", selectedCategory.id)

      if (error) throw error

      toast({
        title: "Categoría eliminada",
        description: `La categoría ${selectedCategory.name} ha sido eliminada correctamente.`,
      })

      fetchCategories()
    } catch (error: any) {
      log.error("Error deleting category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al eliminar la categoría: ${error.message}`,
      })
    } finally {
      setOpenDeleteDialog(false)
      setSelectedCategory(null)
    }
  }

  const confirmDelete = (category: any) => {
    setSelectedCategory(category)
    setOpenDeleteDialog(true)
  }

  const handleDialogClose = () => {
    setOpenDialog(false)
    setSelectedCategory(null)
  }

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Renderizar el icono de la categoría
  const renderIcon = (iconName: string) => {
    const IconComponent = (LucideIcons as any)[iconName]
    if (IconComponent) {
      return <IconComponent className="h-5 w-5" />
    }
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Categorías del Menú</CardTitle>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() => {
                setSelectedCategory(null)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva Categoría
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{selectedCategory ? "Editar Categoría" : "Nueva Categoría"}</DialogTitle>
            </DialogHeader>
            <CategoryForm
              category={selectedCategory}
              onSuccess={() => {
                fetchCategories()
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
            placeholder="Buscar categorías..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {loading ? (
          <div className="text-center py-4">Cargando categorías...</div>
        ) : filteredCategories.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            {searchTerm ? "No se encontraron categorías con ese término de búsqueda" : "No hay categorías registradas"}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Icono</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.icon && renderIcon(category.icon)}</TableCell>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>{category.description || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={category.active ? "success" : "secondary"}>
                        {category.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(category)}>
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Editar</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => confirmDelete(category)}>
                        <Trash className="h-4 w-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <AlertDialog open={openDeleteDialog} onOpenChange={setOpenDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará permanentemente la categoría <strong>{selectedCategory?.name}</strong> y no se
                puede deshacer.
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
