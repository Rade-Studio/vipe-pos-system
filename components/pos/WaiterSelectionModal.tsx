"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { waiterService } from "@/lib/services/waiters/waiter.service"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Definir el tipo para los meseros de la base de datos
type Waiter = {
  id: string
  full_name: string
  username: string
  email: string | null
  active: boolean
}

interface WaiterSelectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (waiterId: string) => void
  defaultWaiterId?: string
}

export function WaiterSelectionModal({ open, onOpenChange, onSelect, defaultWaiterId }: WaiterSelectionModalProps) {
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Cargar los meseros cuando se abre el modal
  useEffect(() => {
    if (open) {
      loadWaiters()
    }
  }, [open])

  // Establecer el mesero por defecto cuando se abre el modal
  useEffect(() => {
    if (open && defaultWaiterId && waiters.some((w) => w.id === defaultWaiterId)) {
      // Si hay un mesero por defecto, seleccionarlo automáticamente
      onSelect(defaultWaiterId)
      onOpenChange(false)
    }
  }, [open, defaultWaiterId, waiters, onSelect, onOpenChange])

  // Cargar los meseros desde la base de datos
  const loadWaiters = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await waiterService.getAll()
      setWaiters(data)
    } catch (err) {
      console.error("Error al cargar meseros:", err)
      setError("No se pudieron cargar los meseros. Intente nuevamente.")
      toast({
        title: "Error",
        description: "No se pudieron cargar los meseros. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
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
          ) : error ? (
            <div className="text-center text-red-500 py-4">
              {error}
              <button onClick={loadWaiters} className="block mx-auto mt-2 text-sm text-primary hover:underline">
                Reintentar
              </button>
            </div>
          ) : waiters.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              No hay meseros disponibles. Por favor, cree algunos meseros primero.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {waiters.map((waiter) => (
                <div
                  key={waiter.id}
                  className="flex flex-col items-center gap-2 cursor-pointer p-2 rounded-lg transition-colors hover:bg-muted"
                  onClick={() => handleWaiterClick(waiter.id)}
                >
                  <Avatar className="h-16 w-16 border-2 border-primary/20">
                    <AvatarFallback className="bg-primary/10 text-primary text-lg">
                      {getInitials(waiter.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-center">{waiter.full_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
