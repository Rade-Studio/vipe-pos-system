"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Toolbar } from "@/components/admin/common/Panel"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import * as tablesApi from "@/lib/api/tables"
import { ApiError, conflictMessage } from "@/lib/api/errors"
import { log } from "@/lib/log"
import { realtimeService } from "@/lib/api/realtime"
import { mergeRowList, type RowChange, type TableRow as TableEventRow } from "@/lib/realtime/table-merge"
import { useToast } from "@/hooks/use-toast"
import { Filter, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { getStatusLabel } from "@/utils/helpers"
import type { TableStatus } from "@/types"

/** The panel holds the `pos_changes` row shape, so events merge as they arrive. */
type PanelTable = TableEventRow & { id: string; number: number; status: string }

export function TableManagementPanel() {
  const [tables, setTables] = useState<PanelTable[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [newTableNumber, setNewTableNumber] = useState("")
  const [editTableId, setEditTableId] = useState<string | null>(null)
  const [editTableNumber, setEditTableNumber] = useState("")
  const [editTableStatus, setEditTableStatus] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [tableToDelete, setTableToDelete] = useState<string | null>(null)
  const { toast } = useToast()

  // Cargar mesas y suscribirse a cambios en tiempo real
  useEffect(() => {
    // Función para cargar mesas
    const loadTables = async () => {
      setLoading(true)
      try {
        const data = await tablesApi.getAll()
        setTables(data.map((table) => tablesApi.toTableRow(table) as PanelTable))
      } catch (error) {
        log.error("Error al cargar mesas:", { error: String(error) })
        toast({
          title: "Error",
          description: "No se pudieron cargar las mesas. Intente nuevamente.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    // Cargar mesas inicialmente
    loadTables()

    // Suscribirse a cambios en tiempo real — merge the row in place instead
    // of reloading the whole panel (A-4, D9). The API listener attaches the
    // waiter's `waiter_name` to every `tables` event (T8b), so the event row
    // is already what this panel renders: no per-event read, no spinner.
    const unsubscribe = realtimeService.subscribeToTables((payload) => {
      setTables((prevTables) => mergeRowList(prevTables, payload as unknown as RowChange))
    }, "admin")

    // Limpiar suscripción al desmontar
    return () => {
      unsubscribe()
    }
  }, [toast])

  // Filtrar mesas según búsqueda y filtro de estado
  const filteredTables = tables
    .filter((table) => {
      // Filtrar por número de mesa
      const matchesSearch = table.number.toString().includes(searchQuery)

      // Filtrar por estado si hay un filtro activo y no es "all"
      const matchesStatus = statusFilter && statusFilter !== "all" ? table.status === statusFilter : true

      return matchesSearch && matchesStatus
    })
    .sort((a, b) => a.number - b.number)

  // Añadir nueva mesa
  const handleAddTable = async () => {
    if (!newTableNumber || isNaN(Number.parseInt(newTableNumber))) {
      toast({
        title: "Error",
        description: "Por favor ingrese un número de mesa válido.",
        variant: "destructive",
      })
      return
    }

    try {
      await tablesApi.create({
        number: Number.parseInt(newTableNumber),
        status: "available",
      })
      setNewTableNumber("")
      setShowAddDialog(false)

      toast({
        title: "Mesa creada",
        description: `La mesa ${newTableNumber} ha sido creada exitosamente.`,
      })

      // No es necesario recargar las mesas manualmente, la suscripción en tiempo real lo hará
    } catch (error) {
      log.error("Error al crear mesa:", { error: String(error) })
      toast({
        title: "Error",
        description: conflictMessage(error, "No se pudo crear la mesa. Intente nuevamente."),
        variant: "destructive",
      })
    }
  }

  // Abrir diálogo de edición
  const handleOpenEditDialog = (table: PanelTable) => {
    setEditTableId(table.id)
    setEditTableNumber(table.number.toString())
    setEditTableStatus(table.status)
    setShowEditDialog(true)
  }

  // Actualizar mesa
  const handleUpdateTable = async () => {
    if (!editTableId || !editTableNumber || isNaN(Number.parseInt(editTableNumber))) {
      toast({
        title: "Error",
        description: "Por favor ingrese un número de mesa válido.",
        variant: "destructive",
      })
      return
    }

    try {
      await tablesApi.update(editTableId, {
        number: Number.parseInt(editTableNumber),
        status: editTableStatus as TableStatus,
      })
      setShowEditDialog(false)

      toast({
        title: "Mesa actualizada",
        description: `La mesa ha sido actualizada exitosamente.`,
      })

      // No es necesario recargar las mesas manualmente, la suscripción en tiempo real lo hará
    } catch (error) {
      log.error("Error al actualizar mesa:", { error: String(error) })
      toast({
        title: "Error",
        description: conflictMessage(error, "No se pudo actualizar la mesa. Intente nuevamente."),
        variant: "destructive",
      })
    }
  }

  // Abrir diálogo de confirmación para eliminar mesa
  const handleOpenDeleteDialog = (tableId: string) => {
    setTableToDelete(tableId)
    setShowDeleteDialog(true)
  }

  // Eliminar mesa
  const handleDeleteTable = async () => {
    if (!tableToDelete) return

    try {
      await tablesApi.delete(tableToDelete)
      setShowDeleteDialog(false)
      setTableToDelete(null)

      toast({
        title: "Mesa eliminada",
        description: "La mesa ha sido eliminada exitosamente.",
      })
    } catch (error) {
      log.error("Error al eliminar mesa:", { error: String(error) })

      // 409 `Table has open orders`: the API's own message.
      if (error instanceof ApiError && error.status === 409) {
        toast({
          title: "No se puede eliminar",
          description: error.message,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Error",
          description: "No se pudo eliminar la mesa. Intente nuevamente.",
          variant: "destructive",
        })
      }
    } finally {
      setShowDeleteDialog(false)
      setTableToDelete(null)
    }
  }

  // Below `sm` every row becomes a small card (CSS grid on the same <tr>).
  const cellClass = "p-0 sm:p-4"

  return (
    <div className="space-y-4">
      <Toolbar
        actions={
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Mesa
          </Button>
        }
      >
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar por número de mesa..."
            aria-label="Buscar por número de mesa"
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter || ""}
          onValueChange={(value) => {
            if (value === "all") {
              setStatusFilter(null)
            } else {
              setStatusFilter(value || null)
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <div className="flex items-center">
              <Filter className="h-4 w-4 mr-2" />
              <span>{statusFilter ? getStatusLabel(statusFilter) : "Filtrar por estado"}</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="available">Disponible</SelectItem>
            <SelectItem value="reserved">Reservada</SelectItem>
            <SelectItem value="occupied">Ocupada</SelectItem>
            <SelectItem value="kitchen">En cocina</SelectItem>
            <SelectItem value="delivered">Servida</SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>

      {loading ? (
        <div className="space-y-2" data-testid="tables-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filteredTables.length === 0 ? (
        <EmptyState
          title={searchQuery || statusFilter ? "No se encontraron mesas con los criterios de búsqueda." : "No hay mesas creadas."}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader className="hidden sm:table-header-group">
              <TableRow>
                <TableHead>Mesa</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Mesero</TableHead>
                <TableHead className="hidden md:table-cell">Última act.</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTables.map((table) => (
                <TableRow key={table.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 p-3 sm:table-row sm:p-0">
                  <TableCell className={`${cellClass} font-medium`}>Mesa {table.number}</TableCell>
                  <TableCell className={`${cellClass} text-right sm:text-left`}>
                    <StatusBadge status={table.status} />
                  </TableCell>
                  <TableCell className={`${cellClass} text-muted-foreground sm:text-foreground`}>
                    {table.waiter_id ? table.waiter_name || "Desconocido" : "Sin mesero"}
                  </TableCell>
                  <TableCell className={`${cellClass} text-right text-xs text-muted-foreground sm:text-left md:table-cell sm:hidden`}>
                    {table.updated_at
                      ? new Date(table.updated_at).toLocaleString("es-ES", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "N/A"}
                  </TableCell>
                  <TableCell className={`${cellClass} col-span-2 pt-2 sm:text-right`}>
                    <div className="flex gap-2 sm:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        onClick={() => handleOpenEditDialog(table)}
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-destructive hover:text-destructive sm:flex-none"
                        onClick={() => handleOpenDeleteDialog(table.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

        {/* Diálogo para añadir mesa */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Añadir Nueva Mesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <div>
                <Label htmlFor="tableNumber" className="text-sm">Número de Mesa</Label>
                <Input
                  id="tableNumber"
                  type="number"
                  value={newTableNumber}
                  onChange={(e) => setNewTableNumber(e.target.value)}
                  placeholder="Ej: 1"
                  className="mt-1"
                />
                <div className="flex items-end">
                  <p className="text-xs text-muted-foreground leading-snug mt-3">
                   Al crear una nueva mesa, su estado inicial será <strong>"Disponible"</strong>.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddTable}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo para editar mesa */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Editar Mesa</DialogTitle>
            </DialogHeader>
            <div className="py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editTableNumber">Número de Mesa</Label>
                <Input
                  id="editTableNumber"
                  type="number"
                  value={editTableNumber}
                  onChange={(e) => setEditTableNumber(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="editTableStatus">Estado</Label>
                <Select value={editTableStatus} onValueChange={setEditTableStatus}>
                  <SelectTrigger id="editTableStatus" className="mt-1">
                    <SelectValue placeholder="Seleccione un estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Disponible</SelectItem>
                    <SelectItem value="reserved">Reservada</SelectItem>
                    <SelectItem value="occupied">Ocupada</SelectItem>
                    <SelectItem value="kitchen">En cocina</SelectItem>
                    <SelectItem value="served">Servida</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateTable}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo para confirmar eliminación */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar eliminación</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p>¿Está seguro que desea eliminar esta mesa?</p>
              <p className="text-sm text-muted-foreground mt-2">
                No se podrá eliminar si tiene órdenes activas asociadas.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeleteTable}>
                Eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  )
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "warning"> = {
  available: "outline",
  reserved: "secondary",
  occupied: "secondary",
  kitchen: "warning",
  delivered: "default",
}

/** Table status as a neutral badge; only "available" and "kitchen" stand out. */
function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{getStatusLabel(status)}</Badge>
}
