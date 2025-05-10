"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { PlusCircle, Edit, Trash2, AlertCircle } from "lucide-react"
import { PromotionForm } from "./PromotionForm"
import { promotionService, type Promotion } from "@/lib/supabase/promotion-service"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function PromotionList() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [promotionToDelete, setPromotionToDelete] = useState<Promotion | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadPromotions()
  }, [])

  const loadPromotions = async () => {
    try {
      setLoading(true)
      // Usar el método getAllPromotions en lugar de acceder directamente a supabase
      const data = await promotionService.getAllPromotions()
      setPromotions(data || [])
    } catch (error) {
      console.error("Error loading promotions:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar las promociones",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePromotion = () => {
    setSelectedPromotion(null)
    setFormOpen(true)
  }

  const handleEditPromotion = (promotion: Promotion) => {
    setSelectedPromotion(promotion)
    setFormOpen(true)
  }

  const handleDeletePromotion = (promotion: Promotion) => {
    setPromotionToDelete(promotion)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!promotionToDelete) return

    try {
      await promotionService.deletePromotion(promotionToDelete.id)
      setPromotions((prev) => prev.filter((p) => p.id !== promotionToDelete.id))
      toast({
        title: "Promoción eliminada",
        description: "La promoción ha sido eliminada correctamente",
      })
    } catch (error) {
      console.error("Error deleting promotion:", error)
      toast({
        title: "Error",
        description: "No se pudo eliminar la promoción",
        variant: "destructive",
      })
    } finally {
      setDeleteDialogOpen(false)
      setPromotionToDelete(null)
    }
  }

  const handleFormSubmit = async () => {
    await loadPromotions()
    toast({
      title: selectedPromotion ? "Promoción actualizada" : "Promoción creada",
      description: selectedPromotion
        ? "La promoción ha sido actualizada correctamente"
        : "La promoción ha sido creada correctamente",
    })
  }

  const isPromotionActive = (promotion: Promotion) => {
    const now = new Date()
    const startDate = new Date(promotion.start_date)
    const endDate = new Date(promotion.end_date)
    return promotion.active && now >= startDate && now <= endDate
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Promociones y Descuentos</CardTitle>
        <Button onClick={handleCreatePromotion}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Nueva Promoción
        </Button>
      </CardHeader>
      <CardContent>
        {promotions.length === 0 ? (
          <div className="text-center py-8">
            {loading ? (
              <p>Cargando promociones...</p>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No hay promociones disponibles. Crea una nueva promoción para comenzar.
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Periodo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((promotion) => (
                <TableRow key={promotion.id}>
                  <TableCell className="font-medium">{promotion.name}</TableCell>
                  <TableCell>{promotion.discount_type === "percentage" ? "Porcentaje" : "Monto fijo"}</TableCell>
                  <TableCell>
                    {promotion.discount_type === "percentage"
                      ? `${promotion.discount_value}%`
                      : `$${promotion.discount_value}`}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <div>Desde: {format(new Date(promotion.start_date), "dd/MM/yyyy", { locale: es })}</div>
                      <div>Hasta: {format(new Date(promotion.end_date), "dd/MM/yyyy", { locale: es })}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isPromotionActive(promotion) ? "success" : promotion.active ? "outline" : "secondary"}
                    >
                      {isPromotionActive(promotion) ? "Activa" : promotion.active ? "Pendiente/Vencida" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleEditPromotion(promotion)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" onClick={() => handleDeletePromotion(promotion)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PromotionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          promotion={selectedPromotion}
          onSubmit={handleFormSubmit}
        />

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Eliminar Promoción</DialogTitle>
              <DialogDescription>
                ¿Estás seguro de que deseas eliminar esta promoción? Esta acción no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                Eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
