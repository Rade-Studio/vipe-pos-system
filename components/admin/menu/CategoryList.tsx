"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { SectionHeader, Toolbar } from "@/components/admin/common/Panel"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import { deleteCategory, type CategoryDto } from "@/lib/api/catalog"
import { ApiError } from "@/lib/api/errors"
import {
  ADMIN_LIST_STALE_MS,
  catalogKeys,
  errorMessage,
  fetchCategories,
  invalidateCatalogReaders,
} from "@/lib/admin/catalog"
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
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<CategoryDto | null>(null)

  // T9 (S1): a cached read. Radix unmounts this sub-tab on every tab switch,
  // so the old `useEffect` + local state re-read the whole list (and blanked it
  // behind "Cargando categorías...") on every visit. `DishList` reads the SAME
  // key, so the Menú tab now fetches `categories` once per visit, not twice.
  const {
    data: categories = [],
    isLoading,
    isError,
    error,
  } = useQuery<CategoryDto[]>({
    queryKey: catalogKeys.categories,
    queryFn: fetchCategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })

  useEffect(() => {
    if (!isError) return
    log.error("Error fetching categories:", { error: String(error) })
    toast({
      variant: "destructive",
      title: "Error",
      description: `Error al cargar las categorías: ${errorMessage(error)}`,
    })
  }, [isError, error, toast])

  const handleEdit = (category: CategoryDto) => {
    setSelectedCategory(category)
    setOpenDialog(true)
  }

  const handleDelete = async () => {
    if (!selectedCategory) return

    try {
      // The API refuses with 409 while dishes still reference the category.
      await deleteCategory(selectedCategory.id)

      toast({
        title: "Categoría eliminada",
        description: `La categoría ${selectedCategory.name} ha sido eliminada correctamente.`,
      })

      // This list's key plus the POS/delivery menus: no reload, no blanking.
      void invalidateCatalogReaders(queryClient, catalogKeys.categories)
    } catch (error) {
      log.error("Error deleting category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof ApiError && error.status === 409
            ? `No se puede eliminar la categoría porque tiene platos asociados. (${error.message})`
            : `Error al eliminar la categoría: ${errorMessage(error)}`,
      })
    } finally {
      setOpenDeleteDialog(false)
      setSelectedCategory(null)
    }
  }

  const confirmDelete = (category: CategoryDto) => {
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
      return <IconComponent className="h-4 w-4 text-muted-foreground" />
    }
    return null
  }

  return (
    <section className="min-w-0 space-y-3">
      <SectionHeader title="Categorías" description="Agrupan los platos en la carta y en la toma de pedidos." />
      <Toolbar
        actions={
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
                void invalidateCatalogReaders(queryClient, catalogKeys.categories)
                handleDialogClose()
              }}
            />
          </DialogContent>
        </Dialog>
        }
      >
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar categorías..."
            aria-label="Buscar categorías"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </Toolbar>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando categorías...</p>
        ) : filteredCategories.length === 0 ? (
          <EmptyState
            title={searchTerm ? "No se encontraron categorías con ese término de búsqueda" : "No hay categorías registradas"}
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Icono</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden md:table-cell">Descripción</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.icon && renderIcon(category.icon)}</TableCell>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{category.description || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={category.active ? "secondary" : "outline"}>
                        {category.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
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
    </section>
  )
}
