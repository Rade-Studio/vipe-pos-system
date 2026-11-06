'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCourier, DeliveryServiceError } from '@/lib/api/delivery'
import { MAX_COURIER_NAME_LEN, validateCourierInput } from '@/lib/delivery/courier-admin'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { PHONE_SHEET, PILL_BUTTON, SHEET_FOOTER } from './console-ui'

interface NewCourierDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "+ Nuevo" repartidor from the dispatch console (T25): name and optional
 * phone, the same rules as Administración (`validateCourierInput`); the API
 * normalises and stores them.
 */
export function NewCourierDialog({ open, onOpenChange }: NewCourierDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setErrors([])
    }
  }, [open])

  const submit = async () => {
    if (saving) return
    const found = validateCourierInput({ name, phone })
    setErrors(found)
    if (found.length > 0) return
    setSaving(true)
    try {
      const created = await createCourier({ name, phone })
      toast.success(`Repartidor ${created.name} creado`)
      void queryClient.invalidateQueries({ queryKey: ['couriers'] })
      onOpenChange(false)
    } catch (err) {
      setErrors([
        err instanceof DeliveryServiceError && err.kind === 'not-authorized'
          ? 'No tienes permiso para crear repartidores'
          : err instanceof Error && err.message
            ? err.message
            : 'No se pudo crear el repartidor. Intenta de nuevo.',
      ])
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className={cn('sm:max-w-sm', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Nuevo repartidor</DialogTitle>
          <DialogDescription>Queda activo y disponible para despachar.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 max-sm:flex max-sm:flex-1 max-sm:flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="courier-name">Nombre</Label>
            <Input
              id="courier-name"
              className="h-11"
              maxLength={MAX_COURIER_NAME_LEN + 10}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="courier-phone">Teléfono (opcional)</Label>
            <Input
              id="courier-phone"
              className="h-11 tabular-nums"
              inputMode="tel"
              placeholder="300 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="grid gap-1 text-sm text-destructive">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <DialogFooter className={SHEET_FOOTER}>
            <Button type="button" variant="outline" className={PILL_BUTTON} onClick={() => onOpenChange(false)} disabled={saving}>
              Cerrar
            </Button>
            <Button type="submit" className={PILL_BUTTON} disabled={saving}>
              {saving ? 'Creando…' : 'Crear repartidor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
