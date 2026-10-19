"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { SectionHeader, Toolbar } from "@/components/admin/common/Panel"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Plus, Edit, Trash2, BadgePercent } from "lucide-react"
import { PromotionForm } from "./PromotionForm"
import { promotionService, type Promotion } from "@/lib/supabase/promotion-service"
import { useToast } from "@/hooks/use-toast"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchPromotions } from "@/lib/admin/catalog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function PromotionList() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [promotionToDelete, setPromotionToDelete] = useState<Promotion | null>(null)

  // T9 (S1): cached read. The old `useEffect` + local state re-read every
  // promotion on every visit to the Menú sub-tab and showed "Cargando
  // promociones..." again each time.
  const {
    data: promotions = [],
    isLoading,
    isError,
    error,
  } = useQuery<Promotion[]>({
    queryKey: catalogKeys.promotions,
    queryFn: fetchPromotions,
    staleTime: ADMIN_LIST_STALE_MS,
  })

  useEffect(() => {
    if (!isError) return
    log.error("Error loading promotions:", { error: String(error) })
    toast({
      title: "Error",
      description: "No se pudieron cargar las promociones",
      variant: "destructive",
    })
  }, [isError, error, toast])

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
      queryClient.invalidateQueries({ queryKey: catalogKeys.promotions })
      toast({
        title: "Promoción eliminada",
        description: "La promoción ha sido eliminada correctamente",
      })
    } catch (error) {
      log.error("Error deleting promotion:", { error: String(error) })
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
    await queryClient.invalidateQueries({ queryKey: catalogKeys.promotions })
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
    <section className="min-w-0 space-y-3">
      <SectionHeader
        title="Promociones y descuentos"
        description="Descuentos por porcentaje o monto fijo con vigencia."
        actions={
          <Button size="sm" onClick={handleCreatePromotion}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Promoción
          </Button>
        }
      />
        {promotions.length === 0 ? (
          isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando promociones...</p>
          ) : (
            <EmptyState
              icon={BadgePercent}
              title="No hay promociones disponibles"
              description="Crea una nueva promoción para comenzar."
            />
          )
        ) : (
          <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead className="hidden sm:table-cell">Periodo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((promotion) => (
                <TableRow key={promotion.id}>
                  <TableCell className="font-medium">{promotion.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {promotion.discount_type === "percentage" ? "Porcentaje" : "Monto fijo"}
                  </TableCell>
                  <TableCell>
                    {promotion.discount_type === "percentage"
                      ? `${promotion.discount_value}%`
                      : `$${promotion.discount_value}`}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                      <div>Desde: {format(new Date(promotion.start_date), "dd/MM/yyyy", { locale: es })}</div>
                      <div>Hasta: {format(new Date(promotion.end_date), "dd/MM/yyyy", { locale: es })}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isPromotionActive(promotion) ? "secondary" : "outline"}
                    >
                      {isPromotionActive(promotion) ? "Activa" : promotion.active ? "Pendiente/Vencida" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEditPromotion(promotion)}>
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Editar</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeletePromotion(promotion)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
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
    </section>
  )
}
