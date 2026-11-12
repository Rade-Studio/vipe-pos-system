"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { log } from "@/lib/log"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Plus, Edit, Trash2, BadgePercent } from "lucide-react"
import { PromotionForm } from "./PromotionForm"
import { deletePromotion, type PromotionDto as Promotion } from "@/lib/api/catalog"
import { useToast } from "@/hooks/use-toast"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchPromotions, invalidateCatalogReaders } from "@/lib/admin/catalog"
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
      await deletePromotion(promotionToDelete.id)
      // Promoted prices change on the POS and delivery menus too.
      void invalidateCatalogReaders(queryClient, catalogKeys.promotions)
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
    await invalidateCatalogReaders(queryClient, catalogKeys.promotions)
    toast({
      title: selectedPromotion ? "Promoción actualizada" : "Promoción creada",
      description: selectedPromotion
        ? "La promoción ha sido actualizada correctamente"
        : "La promoción ha sido creada correctamente",
    })
  }

  const isPromotionActive = (promotion: Promotion) => {
    const now = new Date()
    const startDate = new Date(promotion.startDate)
    // A null endDate is a promotion with no end.
    const endDate = promotion.endDate ? new Date(promotion.endDate) : null
    return promotion.active && now >= startDate && (endDate === null || now <= endDate)
  }

  return (
    <section className="min-w-0 space-y-3">
      {/* The Promociones page header names the section; the list only adds its action. */}
      <div className="flex justify-end">
        <Button className="min-h-11" onClick={handleCreatePromotion}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Promoción
        </Button>
      </div>
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
                    {promotion.discountType === "percentage" ? "Porcentaje" : "Monto fijo"}
                  </TableCell>
                  <TableCell>
                    {promotion.discountType === "percentage"
                      ? `${promotion.discountValue}%`
                      : `$${promotion.discountValue}`}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                      <div>Desde: {format(new Date(promotion.startDate), "dd/MM/yyyy", { locale: es })}</div>
                      <div>Hasta: {promotion.endDate ? format(new Date(promotion.endDate), "dd/MM/yyyy", { locale: es }) : "Sin fin"}</div>
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
