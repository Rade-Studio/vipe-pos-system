"use client"

import { useState, useEffect } from "react"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaiterForm } from "./WaiterForm"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Edit, Trash, Plus } from "lucide-react"
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
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"

interface Waiter {
  id: string
  full_name: string
  username: string
  email: string | null
  active: boolean
}

export function WaiterList() {
  const { toast } = useToast()
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedWaiter, setSelectedWaiter] = useState<Waiter | undefined>(undefined)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [waiterToDelete, setWaiterToDelete] = useState<Waiter | null>(null)

  const fetchWaiters = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("role", "waiter").order("full_name")

      if (error) throw error

      setWaiters(data || [])
    } catch (error: any) {
      log.error("Error fetching waiters:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudieron cargar los meseros",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWaiters()
  }, [])

  const handleAddWaiter = () => {
    setSelectedWaiter(undefined)
    setIsFormOpen(true)
  }

  const handleEditWaiter = (waiter: Waiter) => {
    setSelectedWaiter(waiter)
    setIsFormOpen(true)
  }

  const handleDeleteWaiter = (waiter: Waiter) => {
    setWaiterToDelete(waiter)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!waiterToDelete) return

    try {
      const { error } = await supabase.from("profiles").delete().eq("id", waiterToDelete.id)

      if (error) throw error

      setWaiters(waiters.filter((w) => w.id !== waiterToDelete.id))
      toast({
        title: "Mesero eliminado",
        description: "El mesero ha sido eliminado correctamente",
      })
    } catch (error: any) {
      log.error("Error deleting waiter:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudo eliminar el mesero",
        variant: "destructive",
      })
    } finally {
      setIsDeleteDialogOpen(false)
      setWaiterToDelete(null)
    }
  }

  const handleFormSuccess = () => {
    setIsFormOpen(false)
    fetchWaiters()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Meseros</h2>
        <Button onClick={handleAddWaiter} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Agregar Mesero
        </Button>
      </div>

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
                    <Skeleton className="h-4 w-20" />
                  </th>
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
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="p-4 align-middle">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="p-4 align-middle">
                      <Skeleton className="h-6 w-16 rounded-full" />
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
      ) : waiters.length === 0 ? (
        <div className="text-center py-4">No hay meseros registrados</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {waiters.map((waiter) => (
              <TableRow key={waiter.id}>
                <TableCell className="font-medium">{waiter.full_name}</TableCell>
                <TableCell>{waiter.username}</TableCell>
                <TableCell>{waiter.email || "-"}</TableCell>
                <TableCell>
                  <Badge variant={waiter.active ? "success" : "secondary"}>
                    {waiter.active ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => handleEditWaiter(waiter)}>
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">Editar</span>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteWaiter(waiter)}>
                    <Trash className="h-4 w-4" />
                    <span className="sr-only">Eliminar</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{selectedWaiter ? "Editar Mesero" : "Agregar Mesero"}</DialogTitle>
          </DialogHeader>
          <WaiterForm waiter={selectedWaiter} onSuccess={handleFormSuccess} onCancel={() => setIsFormOpen(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente al mesero {waiterToDelete?.full_name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
