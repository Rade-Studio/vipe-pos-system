"use client"

/**
 * Admin screen for the per-tenant `couriers` registry.
 *
 * Rows: name + phone (formatted) + estado badge + activate/deactivate
 * switch + edit. There is no delete: deactivating keeps historical
 * deliveries resolving the courier they used.
 *
 * Each mutation goes through a `createSingleFlight` gate (one for the
 * create/edit dialog, one per row switch) so a double-click cannot fire
 * a second write. The gate does not re-render, so a `busy` state flag
 * drives the disabled buttons. On success the `['couriers']` prefix is
 * invalidated, which also refreshes the dispatch dialog's
 * `['couriers', 'active']` picker.
 */

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createCourier, listCouriers, updateCourier } from "@/lib/supabase/delivery-service"
import { DeliveryServiceError } from "@/lib/delivery/types"
import type { Courier, DeliveryServiceErrorKind } from "@/lib/delivery/types"
import {
  COURIERS_QUERY_KEY,
  MAX_COURIER_NAME_LEN,
  findActivePhoneDuplicate,
  validateCourierInput,
} from "@/lib/delivery/courier-admin"
import type { CourierInput } from "@/lib/delivery/courier-admin"
import { formatPhone } from "@/lib/delivery/phone"
import { createSingleFlight, type SingleFlight } from "@/lib/payments/single-flight"
import { toast } from "@/utils/toast"
import { log } from "@/lib/log"

const ADMIN_COURIERS_QUERY_KEY = [...COURIERS_QUERY_KEY, "all"] as const

const ERROR_TOAST: Record<DeliveryServiceErrorKind, string> = {
  "not-authorized": "No tienes permiso para modificar los repartidores",
  "not-found": "El repartidor ya no existe",
  rejected: "", // server message is shown verbatim
  "invalid-input": "", // server message is shown verbatim
  unknown: "Ocurrió un error al guardar los cambios. Intenta de nuevo.",
}

function courierErrorMessage(err: unknown): string {
  if (err instanceof DeliveryServiceError) {
    const base = ERROR_TOAST[err.kind]
    if (base) return base
    return err.message || "La operación fue rechazada por el servidor"
  }
  return "Ocurrió un error inesperado. Intenta de nuevo."
}

const EMPTY_FORM: CourierInput = { name: "", phone: "" }

export function CouriersManager() {
  const queryClient = useQueryClient()

  const { data: couriers = [], isLoading, refetch } = useQuery<Courier[]>({
    queryKey: ADMIN_COURIERS_QUERY_KEY,
    queryFn: () => listCouriers({ activeOnly: false }),
    staleTime: 30_000,
  })

  // ---- create / edit (one dialog; `editing` null means create) ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Courier | null>(null)
  const [form, setForm] = useState<CourierInput>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const saveGate: SingleFlight = useMemo(() => createSingleFlight(), [])

  // ---- toggle (one gate per row) ----
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set())
  const toggleGates = useMemo(() => new Map<string, SingleFlight>(), [])
  const gateFor = (id: string): SingleFlight => {
    let g = toggleGates.get(id)
    if (!g) {
      g = createSingleFlight()
      toggleGates.set(id, g)
    }
    return g
  }

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: COURIERS_QUERY_KEY })
  }

  const duplicate = findActivePhoneDuplicate(form.phone, couriers, editing?.id)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErrors([])
    setDialogOpen(true)
  }

  const openEdit = (c: Courier) => {
    setEditing(c)
    setForm({ name: c.name, phone: c.phone ?? "" })
    setFormErrors([])
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const errors = validateCourierInput(form)
    setFormErrors(errors)
    if (errors.length > 0) return
    const target = editing
    const run = saveGate.run(async () => {
      setSaving(true)
      try {
        if (target) {
          await updateCourier(target.id, { name: form.name, phone: form.phone })
          toast.success("Repartidor actualizado")
        } else {
          await createCourier(form)
          toast.success("Repartidor creado correctamente")
        }
        setDialogOpen(false)
        await invalidate()
      } catch (err) {
        log.error("Error al guardar repartidor:", { error: String(err) })
        const msg = courierErrorMessage(err)
        setFormErrors([msg])
        toast.error(msg)
      } finally {
        setSaving(false)
      }
    })
    if (run) await run
  }

  const handleToggle = async (c: Courier, nextActive: boolean) => {
    const run = gateFor(c.id).run(async () => {
      setToggling((prev) => new Set(prev).add(c.id))
      try {
        await updateCourier(c.id, { isActive: nextActive })
        toast.success(nextActive ? "Repartidor activado" : "Repartidor desactivado")
        await invalidate()
      } catch (err) {
        log.error("Error al cambiar estado del repartidor:", { error: String(err) })
        toast.error(courierErrorMessage(err))
        await refetch()
      } finally {
        setToggling((prev) => {
          const next = new Set(prev)
          next.delete(c.id)
          return next
        })
      }
    })
    if (run) await run
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Repartidores</CardTitle>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo repartidor
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : couriers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No hay repartidores registrados.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.phone ? formatPhone(c.phone) : "-"}</TableCell>
                  <TableCell>
                    {c.isActive ? (
                      <Badge variant="default">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Switch
                        checked={c.isActive}
                        onCheckedChange={(checked) => handleToggle(c, checked === true)}
                        disabled={toggling.has(c.id)}
                        aria-label={c.isActive ? "Desactivar repartidor" : "Activar repartidor"}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(c)}
                        aria-label="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(isOpen) => {
          if (saving && !isOpen) return
          setDialogOpen(isOpen)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar repartidor" : "Nuevo repartidor"}</DialogTitle>
            <DialogDescription>
              Los repartidores no usan la aplicación; se asignan al despachar un domicilio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="courier-name">Nombre</Label>
              <Input
                id="courier-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={MAX_COURIER_NAME_LEN}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="courier-phone">Teléfono (opcional)</Label>
              <Input
                id="courier-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Ej. 310 123 4567"
                disabled={saving}
              />
            </div>
            {duplicate && (
              <p className="text-sm text-amber-600">
                {duplicate.name} ya usa este teléfono.
              </p>
            )}
            {formErrors.map((msg) => (
              <p key={msg} className="text-sm text-destructive">{msg}</p>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : editing ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
