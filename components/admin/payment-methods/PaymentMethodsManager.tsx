"use client"

/**
 * Admin screen for the per-tenant `payment_methods` catalog.
 *
 * Rows: name + kind (Efectivo / Electrónico) + estado (badge) +
 * sort_order up/down + activate/deactivate switch + inline rename.
 * `code` is shown read-only because the column is immutable after
 * insert (the BEFORE UPDATE trigger raises 42501 even for admins),
 * and the `+ Nuevo método` dialog derives the code client-side from
 * the human name.
 *
 * Every mutation goes through a `createSingleFlight` gate so a
 * double-click on a button (or a re-render mid-flight) cannot fire a
 * second INSERT/UPDATE while the first is still in the network.
 * On success the catalog query is invalidated so the cashier
 * dialog and the admin reports pick up the new name, the new
 * method or the new order without a manual refresh.
 *
 * The `canDeactivate` gate from `@/lib/payments/catalog-admin` is
 * what blocks the switch when the row is the last active one or
 * the last active cash one; the reason code is rendered as a
 * Spanish explanation in the toast.
 */

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { listPaymentMethods } from "@/lib/supabase/payments-service"
import {
  createPaymentMethod,
  reorderPaymentMethods,
  updatePaymentMethod,
} from "@/lib/supabase/payments-service"
import { PaymentServiceError } from "@/lib/payments/types"
import type {
  PaymentMethodKind,
  PaymentMethodOption,
  PaymentServiceErrorKind,
} from "@/lib/payments/types"
import {
  canDeactivate,
  moveMethod,
  PAYMENT_METHODS_QUERY_KEY,
  validateMethodName,
} from "@/lib/payments/catalog-admin"
import { createSingleFlight, type SingleFlight } from "@/lib/payments/single-flight"
import { toast } from "@/utils/toast"
import { log } from "@/lib/log"

// -----------------------------------------------------------
// Error -> Spanish toast text
// -----------------------------------------------------------

const ERROR_TOAST: Record<PaymentServiceErrorKind, string> = {
  "not-authorized": "No tienes permiso para modificar los métodos de pago",
  "not-found": "El método de pago ya no existe",
  rejected: "", // server message is shown verbatim
  "invalid-input": "", // server message is shown verbatim
  unknown: "Ocurrió un error al guardar los cambios. Intenta de nuevo.",
}

function paymentErrorMessage(err: unknown): string {
  if (err instanceof PaymentServiceError) {
    const base = ERROR_TOAST[err.kind]
    if (base) return base
    return err.message || "La operación fue rechazada por el servidor"
  }
  return "Ocurrió un error inesperado. Intenta de nuevo."
}

const DEACTIVATE_REASON: Record<"last-active" | "last-cash", string> = {
  "last-active":
    "Debe quedar al menos un método de pago activo para poder cobrar.",
  "last-cash":
    "Debe quedar al menos un método de pago en efectivo activo para dar cambio.",
}

// -----------------------------------------------------------
// Local form state
// -----------------------------------------------------------

interface CreateForm {
  name: string
  kind: PaymentMethodKind
}

const EMPTY_CREATE: CreateForm = { name: "", kind: "electronic" }

export function PaymentMethodsManager() {
  const queryClientHook = useQueryClient()

  const { data: methods = [], isLoading, refetch } = useQuery<PaymentMethodOption[]>({
    queryKey: PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => listPaymentMethods(),
    staleTime: 30_000,
  })

  // The picker shows the catalog in the same order the server gives
  // it (sort_order asc), so the up/down buttons act on that order
  // and the table renders in the user's chosen order.
  const ordered = useMemo(
    () => methods.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [methods],
  )

  // ---- create ----
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE)
  const [createError, setCreateError] = useState<string | null>(null)
  const createGate: SingleFlight = useMemo(() => createSingleFlight(), [])

  // ---- rename ----
  const [renameTarget, setRenameTarget] = useState<PaymentMethodOption | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameGate: SingleFlight = useMemo(() => createSingleFlight(), [])

  // ---- reorder (one gate for the whole list: a single up/down
  // is the only legitimate trigger, and double-firing it would
  // produce a wrong order on the server). ----
  const reorderGate: SingleFlight = useMemo(() => createSingleFlight(), [])

  // ---- toggle (one gate per row; the Switch is its own click target) ----
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
    await queryClientHook.invalidateQueries({ queryKey: PAYMENT_METHODS_QUERY_KEY })
  }

  // ---- handlers ----

  const handleCreate = async () => {
    if (createGate.isRunning()) return
    const name = createForm.name.trim()
    if (name.length === 0) {
      setCreateError("El nombre no puede estar vacío")
      return
    }
    const reason = validateMethodName(name, ordered)
    if (reason === "duplicate") {
      setCreateError("Ya existe un método con ese nombre")
      return
    }
    if (reason === "too-long") {
      setCreateError("El nombre no puede tener más de 60 caracteres")
      return
    }
    setCreateError(null)
    const run = createGate.run(async () => {
      try {
        await createPaymentMethod({ name, kind: createForm.kind })
        toast.success("Método creado correctamente")
        setCreateForm(EMPTY_CREATE)
        setCreateOpen(false)
        await invalidate()
      } catch (err) {
        log.error("Error al crear método de pago:", { error: String(err) })
        const msg = paymentErrorMessage(err)
        setCreateError(msg)
        toast.error(msg)
      }
    })
    if (run) await run
  }

  const openRename = (m: PaymentMethodOption) => {
    setRenameTarget(m)
    setRenameValue(m.name)
    setRenameError(null)
  }

  const handleRename = async () => {
    if (!renameTarget) return
    if (renameGate.isRunning()) return
    const name = renameValue.trim()
    if (name.length === 0) {
      setRenameError("El nombre no puede estar vacío")
      return
    }
    const others = ordered.filter((m) => m.id !== renameTarget.id)
    const reason = validateMethodName(name, others)
    if (reason === "duplicate") {
      setRenameError("Ya existe otro método con ese nombre")
      return
    }
    if (reason === "too-long") {
      setRenameError("El nombre no puede tener más de 60 caracteres")
      return
    }
    setRenameError(null)
    const run = renameGate.run(async () => {
      try {
        await updatePaymentMethod(renameTarget.id, { name })
        toast.success("Nombre actualizado")
        setRenameTarget(null)
        setRenameValue("")
        await invalidate()
      } catch (err) {
        log.error("Error al renombrar método de pago:", { error: String(err) })
        const msg = paymentErrorMessage(err)
        setRenameError(msg)
        toast.error(msg)
      }
    })
    if (run) await run
  }

  const handleReorder = async (id: string, direction: "up" | "down") => {
    if (reorderGate.isRunning()) return
    const { changes } = moveMethod(ordered, id, direction)
    if (changes.length === 0) return
    const run = reorderGate.run(async () => {
      try {
        await reorderPaymentMethods(changes)
        toast.success("Orden guardado")
        await invalidate()
      } catch (err) {
        log.error("Error al reordenar métodos de pago:", { error: String(err) })
        toast.error(paymentErrorMessage(err))
      }
    })
    if (run) await run
  }

  const handleToggle = async (m: PaymentMethodOption, nextActive: boolean) => {
    const gate = gateFor(m.id)
    if (gate.isRunning()) return
    if (!nextActive) {
      const verdict = canDeactivate(ordered, m.id)
      if (verdict !== true) {
        toast.warning(DEACTIVATE_REASON[verdict.reason])
        // The Switch has already toggled in the DOM; force a refresh
        // so the visual state matches the server.
        await refetch()
        return
      }
    }
    const run = gate.run(async () => {
      try {
        await updatePaymentMethod(m.id, { isActive: nextActive })
        toast.success(nextActive ? "Método activado" : "Método desactivado")
        await invalidate()
      } catch (err) {
        log.error("Error al cambiar estado del método de pago:", { error: String(err) })
        toast.error(paymentErrorMessage(err))
        await refetch()
      }
    })
    if (run) await run
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Métodos de pago</CardTitle>
        <Button onClick={() => { setCreateForm(EMPTY_CREATE); setCreateError(null); setCreateOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo método
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No hay métodos de pago configurados.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-center">Orden</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((m, idx) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{m.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{m.code}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {m.code}
                  </TableCell>
                  <TableCell>
                    {m.kind === "cash" ? "Efectivo" : "Electrónico"}
                  </TableCell>
                  <TableCell>
                    {m.isActive ? (
                      <Badge variant="default">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleReorder(m.id, "up")}
                        disabled={idx === 0 || reorderGate.isRunning()}
                        aria-label="Subir"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleReorder(m.id, "down")}
                        disabled={idx === ordered.length - 1 || reorderGate.isRunning()}
                        aria-label="Bajar"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Switch
                        checked={m.isActive}
                        onCheckedChange={(checked) => handleToggle(m, checked === true)}
                        disabled={gateFor(m.id).isRunning() || (m.isActive && canDeactivate(ordered, m.id) !== true)}
                        aria-label={m.isActive ? "Desactivar método" : "Activar método"}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openRename(m)}
                        disabled={renameGate.isRunning()}
                        aria-label="Renombrar"
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

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(isOpen) => {
          if (createGate.isRunning() && !isOpen) return
          setCreateOpen(isOpen)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo método de pago</DialogTitle>
            <DialogDescription>
              El código se genera a partir del nombre y no se puede cambiar después.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pm-name">Nombre</Label>
              <Input
                id="pm-name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej. Daviplata"
                maxLength={60}
                disabled={createGate.isRunning()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-kind">Tipo</Label>
              <Select
                value={createForm.kind}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, kind: v as PaymentMethodKind }))}
                disabled={createGate.isRunning()}
              >
                <SelectTrigger id="pm-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Efectivo</SelectItem>
                  <SelectItem value="electronic">Electrónico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createGate.isRunning()}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleCreate} disabled={createGate.isRunning()}>
              {createGate.isRunning() ? "Guardando..." : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(isOpen) => {
          if (renameGate.isRunning() && !isOpen) return
          if (!isOpen) {
            setRenameTarget(null)
            setRenameValue("")
            setRenameError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renombrar método</DialogTitle>
            <DialogDescription>
              Cambia el nombre visible. El código ({renameTarget?.code}) se mantiene.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pm-rename">Nombre</Label>
              <Input
                id="pm-rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={60}
                disabled={renameGate.isRunning()}
              />
            </div>
            {renameError && (
              <p className="text-sm text-destructive">{renameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameTarget(null)
                setRenameValue("")
                setRenameError(null)
              }}
              disabled={renameGate.isRunning()}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleRename} disabled={renameGate.isRunning()}>
              {renameGate.isRunning() ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
