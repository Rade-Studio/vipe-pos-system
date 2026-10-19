"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Warehouse } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { useCreateLocation, useInventoryLocations, useUpdateLocation } from "@/hooks/inventory"
import type { InventoryLocation } from "@/lib/supabase/inventory/types"
import { FieldError } from "./stock-ui"

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,15}$/

function LocationDialog({ location, open, onOpenChange }: { location: InventoryLocation | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const create = useCreateLocation()
  const update = useUpdateLocation()
  const { toast } = useToast()
  const pending = create.isPending || update.isPending

  useEffect(() => {
    if (!open) return
    setName(location?.name ?? "")
    setCode(location?.code ?? "")
    setError(undefined)
  }, [open, location])

  async function save() {
    const input = { name: name.trim(), code: code.trim().toUpperCase() }
    if (!input.name) return setError("El nombre es obligatorio")
    if (!CODE_RE.test(input.code)) return setError("Código no válido: letras, números y guiones")
    try {
      if (location) await update.mutateAsync({ id: location.id, input })
      else await create.mutateAsync(input)
      toast({ title: location ? "Bodega actualizada" : "Bodega creada" })
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{location ? "Editar bodega" : "Nueva bodega"}</DialogTitle>
          <DialogDescription>Ubicación física donde se guarda el inventario.</DialogDescription>
        </DialogHeader>
        <form
          id="location-form"
          className="grid gap-3 sm:grid-cols-[1fr_8rem]"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="location-name">Nombre</Label>
            <Input id="location-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location-code">Código</Label>
            <Input id="location-code" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <FieldError message={error} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="location-form" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LocationsPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const locations = useInventoryLocations()
  const update = useUpdateLocation()
  const { toast } = useToast()
  const [editing, setEditing] = useState<{ location: InventoryLocation | null } | null>(null)

  async function patch(location: InventoryLocation, input: { isDefault?: boolean; isActive?: boolean }, done: string) {
    try {
      await update.mutateAsync({ id: location.id, input })
      toast({ title: done })
    } catch (e) {
      toast({ title: "No se pudo actualizar la bodega", description: (e as Error).message, variant: "destructive" })
    }
  }

  const columns: DataTableColumn<InventoryLocation>[] = [
    { id: "code", header: "Código", cell: (l) => <span className="font-mono text-xs">{l.code}</span> },
    {
      id: "name",
      header: "Nombre",
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-medium">{l.name}</span>
          {l.isDefault && <Badge variant="secondary">Principal</Badge>}
        </span>
      ),
    },
    {
      id: "active",
      header: "Activa",
      cell: (l) => (
        <Switch
          checked={l.isActive}
          disabled={l.isDefault || update.isPending}
          aria-label={`Activa ${l.name}`}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => void patch(l, { isActive: v }, v ? "Bodega activada" : "Bodega desactivada")}
        />
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (l) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {!l.isDefault && l.isActive && (
            <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => void patch(l, { isDefault: true }, "Bodega principal actualizada")}>
              Marcar como principal
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing({ location: l })}>
            Editar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bodegas"
        description={description}
        actions={
          <Button onClick={() => setEditing({ location: null })}>
            <Plus className="mr-2 h-4 w-4" /> Nueva bodega
          </Button>
        }
      />
      <DataTable
        rows={locations.data ?? []}
        columns={columns}
        getRowId={(l) => l.id}
        isLoading={locations.isLoading}
        empty={<EmptyState icon={Warehouse} title="Sin bodegas" description="Crea la primera ubicación de inventario." />}
      />
      <LocationDialog location={editing?.location ?? null} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  )
}
