"use client"

import { useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { log } from "@/lib/log"
import { Loader2 } from "lucide-react"
import { useWaiters } from "@/hooks/use-waiters"

interface WaiterSelectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (waiterId: string) => void
  defaultWaiterId?: string
}

/**
 * Picker over the shared `['waiters']` query (T6/S1).
 *
 * It used to fetch `waiterService.getAll()` every time it opened, duplicating
 * the list the waiter screen already had. Now opening the picker costs nothing:
 * the same query is read, and it also serves the waiter screen, the kitchen
 * screen and the table grid without a change on their side.
 */
export function WaiterSelectionModal({ open, onOpenChange, onSelect, defaultWaiterId }: WaiterSelectionModalProps) {
  const { data: waiters = [], isPending, isError, refetch } = useWaiters()

  // Un primer resultado sin datos es el único estado que se muestra como carga;
  // con la lista ya en caché el modal abre con los meseros de inmediato.
  const loading = isPending && waiters.length === 0

  // Establecer el mesero por defecto cuando se abre el modal
  useEffect(() => {
    if (open && defaultWaiterId && waiters.some((w) => w.id === defaultWaiterId)) {
      // Si hay un mesero por defecto, seleccionarlo automáticamente
      onSelect(defaultWaiterId)
      onOpenChange(false)
    }
  }, [open, defaultWaiterId, waiters, onSelect, onOpenChange])

  const handleRetry = async () => {
    try {
      log.info("Reintentando la carga de meseros")
      await refetch()
    } catch (err) {
      log.error("Error al cargar meseros:", { err: String(err) })
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
  }

  const handleWaiterClick = (waiterId: string) => {
    onSelect(waiterId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Seleccionar Mesero</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="text-center text-red-500 py-4">
              No se pudieron cargar los meseros. Intente nuevamente.
              <button onClick={handleRetry} className="block mx-auto mt-2 text-sm text-primary hover:underline">
                Reintentar
              </button>
            </div>
          ) : waiters.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              No hay meseros disponibles. Por favor, cree algunos meseros primero.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {waiters.map((waiter) => {
                const name = waiter.full_name || waiter.name
                return (
                  <div
                    key={waiter.id}
                    className="flex flex-col items-center gap-2 cursor-pointer p-2 rounded-lg transition-colors hover:bg-muted"
                    onClick={() => handleWaiterClick(waiter.id)}
                  >
                    <Avatar className="h-16 w-16 border-2 border-primary/20">
                      <AvatarFallback className="bg-primary/10 text-primary text-lg">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium text-center">{name}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}