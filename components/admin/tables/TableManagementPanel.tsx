"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { tableService } from "@/lib/supabase/service"
import { realtimeService } from "@/lib/supabase/realtime-service"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Plus, Search, Filter } from "lucide-react"
import { getStatusLabel } from "@/utils/helpers"

export function TableManagementPanel() {
  const [tables, setTables] = useState<any[]>([])
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
        const data = await tableService.getAll()
        setTables(data)
      } catch (error) {
        console.error("Error al cargar mesas:", error)
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

    // Suscribirse a cambios en tiempo real
    const unsubscribe = realtimeService.subscribeToTables(async (payload) => {
      console.log("Cambio en mesa recibido en panel de administración:", payload)

      // Para simplificar, recargamos todas las mesas cuando hay un cambio
      // Esto asegura que tengamos todos los datos relacionados (como perfiles)
      await loadTables()
    })

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
      await tableService.create({
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
      console.error("Error al crear mesa:", error)
      toast({
        title: "Error",
        description: "No se pudo crear la mesa. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  // Abrir diálogo de edición
  const handleOpenEditDialog = (table: any) => {
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
      await tableService.update(editTableId, {
        number: Number.parseInt(editTableNumber),
        status: editTableStatus,
      })
      setShowEditDialog(false)

      toast({
        title: "Mesa actualizada",
        description: `La mesa ha sido actualizada exitosamente.`,
      })

      // No es necesario recargar las mesas manualmente, la suscripción en tiempo real lo hará
    } catch (error) {
      console.error("Error al actualizar mesa:", error)
      toast({
        title: "Error",
        description: "No se pudo actualizar la mesa. Intente nuevamente.",
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
      await tableService.delete(tableToDelete)
      setShowDeleteDialog(false)
      setTableToDelete(null)

      toast({
        title: "Mesa eliminada",
        description: "La mesa ha sido eliminada exitosamente.",
      })
    } catch (error: any) {
      console.error("Error al eliminar mesa:", error)

      // Mostrar mensaje específico si hay órdenes activas
      if (error.message && error.message.includes("órdenes activas")) {
        toast({
          title: "No se puede eliminar",
          description: "No se puede eliminar una mesa con órdenes activas.",
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Administración de Mesas</CardTitle>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Mesa
        </Button>
      </CardHeader>
      <CardContent>
        {/* Barra de búsqueda y filtros */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número de mesa..."
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
        </div>

        {/* Lista de mesas */}
        {filteredTables.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery || statusFilter
              ? "No se encontraron mesas con los criterios de búsqueda."
              : "No hay mesas creadas."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredTables.map((table) => (
              <Card
                key={table.id}
                className="overflow-hidden border-t-4"
                style={{ borderTopColor: getStatusColor(table.status) }}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xl font-bold">Mesa {table.number}</h3>
                    <Badge status={table.status} />
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center text-sm">
                      <div className="w-24 font-medium">Estado:</div>
                      <div>{getStatusLabel(table.status)}</div>
                    </div>

                    {table.waiter_id && (
                      <div className="flex items-center text-sm">
                        <div className="w-24 font-medium">Mesero:</div>
                        <div className="flex items-center">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary mr-2">
                            {table.profiles?.full_name
                              ?.split(" ")
                              .map((name) => name[0])
                              .join("")
                              .toUpperCase() || "??"}
                          </div>
                          <span>{table.profiles?.full_name || "Desconocido"}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center text-sm">
                      <div className="w-24 font-medium">Última act.:</div>
                      <div>
                        {table.updated_at
                          ? new Date(table.updated_at).toLocaleString("es-ES", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "N/A"}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between gap-2 mt-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 flex items-center justify-center"
                      onClick={() => handleOpenEditDialog(table)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mr-1"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1 flex items-center justify-center"
                      onClick={() => handleOpenDeleteDialog(table.id)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mr-1"
                      >
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                      Eliminar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Diálogo para añadir mesa */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Añadir Nueva Mesa</DialogTitle>
            </DialogHeader>
            <div className="py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tableNumber">Número de Mesa</Label>
                <Input
                  id="tableNumber"
                  type="number"
                  value={newTableNumber}
                  onChange={(e) => setNewTableNumber(e.target.value)}
                  placeholder="Ej: 1"
                  className="mt-1"
                />
              </div>
              <div className="flex items-end">
                <p className="text-sm text-muted-foreground">
                  Al crear una nueva mesa, su estado inicial será "Disponible".
                </p>
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
                    <SelectItem value="delivered">Servida</SelectItem>
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
      </CardContent>
    </Card>
  )
}

// Componente Badge para mostrar el estado
function Badge({ status }: { status: string }) {
  const getStatusClass = () => {
    switch (status) {
      case "available":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      case "reserved":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      case "occupied":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      case "kitchen":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      case "delivered":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300"
    }
  }

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusClass()}`}>{getStatusLabel(status)}</span>
  )
}

// Función para obtener el color del estado para el borde superior
function getStatusColor(status: string) {
  switch (status) {
    case "available":
      return "#10b981" // green-500
    case "reserved":
      return "#3b82f6" // blue-500
    case "occupied":
      return "#f59e0b" // amber-500
    case "kitchen":
      return "#ef4444" // red-500
    case "delivered":
    case "served":
      return "#8b5cf6" // violet-500
    default:
      return "#6b7280" // gray-500
  }
}
