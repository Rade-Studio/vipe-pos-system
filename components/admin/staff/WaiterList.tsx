"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaiterForm } from "./WaiterForm"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchStaff } from "@/lib/admin/catalog"
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
import { roleLabel } from "@/lib/auth/roles"
import type { StaffRole } from "@/lib/supabase/staff-service"

interface Waiter {
  id: string
  full_name: string
  username: string
  email: string | null
  auth_user_id: string | null
  active: boolean
  role: StaffRole
}

export function WaiterList() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedWaiter, setSelectedWaiter] = useState<Waiter | undefined>(undefined)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [waiterToDelete, setWaiterToDelete] = useState<Waiter | null>(null)

  // T9 (S1): cached read of the staff directory. The old `useEffect` re-read
  // it on every visit to the Personal sub-tab and re-rendered the skeleton
  // table every time.
  const {
    data: waiters = [],
    isLoading,
    isError,
    error,
  } = useQuery<Waiter[]>({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
    staleTime: ADMIN_LIST_STALE_MS,
  })

  useEffect(() => {
    if (!isError) return
    log.error("Error fetching staff:", { error: String(error) })
    toast({
      title: "Error",
      description: "No se pudo cargar el personal",
      variant: "destructive",
    })
  }, [isError, error, toast])

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

      queryClient.invalidateQueries({ queryKey: catalogKeys.staff })
      toast({
        title: "Integrante eliminado",
        description: "El integrante del personal ha sido eliminado correctamente",
      })
    } catch (error: any) {
      log.error("Error deleting staff member:", { error: String(error) })
      toast({
        title: "Error",
        description: "No se pudo eliminar el integrante del personal",
        variant: "destructive",
      })
    } finally {
      setIsDeleteDialogOpen(false)
      setWaiterToDelete(null)
    }
  }

  const handleFormSuccess = () => {
    setIsFormOpen(false)
    // The Edge Function created the account; only this list has to re-read.
    queryClient.invalidateQueries({ queryKey: catalogKeys.staff })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Personal</h2>
        <Button onClick={handleAddWaiter} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Agregar personal
        </Button>
      </div>

      {isLoading ? (
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
        <div className="text-center py-4">No hay personal registrado</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
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
                  <Badge variant="outline">{roleLabel(waiter.role) ?? waiter.role}</Badge>
                  {waiter.auth_user_id === null && (
                    <Badge variant="secondary" className="ml-2">
                      Sin acceso
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={waiter.active ? "default" : "secondary"}>
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
            <DialogTitle>{selectedWaiter ? "Editar personal" : "Agregar personal"}</DialogTitle>
          </DialogHeader>
          <WaiterForm waiter={selectedWaiter} onSuccess={handleFormSuccess} onCancel={() => setIsFormOpen(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente a {waiterToDelete?.full_name}.
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
