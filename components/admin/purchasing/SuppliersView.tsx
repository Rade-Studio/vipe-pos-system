"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Truck } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { FieldError } from "@/components/admin/stock/stock-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useCreateSupplier, useSuppliers, useUpdateSupplier } from "@/hooks/inventory"
import type { Supplier, SupplierInput } from "@/lib/supabase/inventory/types"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface SupplierForm {
  name: string
  taxId: string
  contactName: string
  phone: string
  email: string
  leadTimeDays: string
  notes: string
}

const toForm = (s: Supplier | null): SupplierForm => ({
  name: s?.name ?? "",
  taxId: s?.taxId ?? "",
  contactName: s?.contactName ?? "",
  phone: s?.phone ?? "",
  email: s?.email ?? "",
  leadTimeDays: s?.leadTimeDays != null ? String(s.leadTimeDays) : "",
  notes: s?.notes ?? "",
})

const blank = (v: string) => v.trim() || null

function validate(form: SupplierForm): string | undefined {
  if (!form.name.trim()) return "El nombre es obligatorio"
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) return "Correo electrónico no válido"
  if (form.leadTimeDays.trim() && !/^\d+$/.test(form.leadTimeDays.trim())) return "El plazo debe ser un número entero de días"
}

const toInput = (form: SupplierForm): SupplierInput => ({
  name: form.name.trim(),
  taxId: blank(form.taxId),
  contactName: blank(form.contactName),
  phone: blank(form.phone),
  email: blank(form.email),
  leadTimeDays: form.leadTimeDays.trim() ? Number(form.leadTimeDays) : null,
  notes: blank(form.notes),
})

/** Create or edit a supplier. `onSaved` receives the stored supplier (inline create from the order editor). */
export function SupplierDialog({
  supplier,
  open,
  onOpenChange,
  onSaved,
  initialName,
}: {
  supplier: Supplier | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (supplier: Supplier) => void
  initialName?: string
}) {
  const [form, setForm] = useState<SupplierForm>(toForm(null))
  const [error, setError] = useState<string>()
  const create = useCreateSupplier()
  const update = useUpdateSupplier()
  const { toast } = useToast()
  const pending = create.isPending || update.isPending

  useEffect(() => {
    if (!open) return
    setForm({ ...toForm(supplier), ...(supplier ? {} : { name: initialName ?? "" }) })
    setError(undefined)
  }, [open, supplier, initialName])

  const field = (key: keyof SupplierForm) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
  })

  async function save() {
    const problem = validate(form)
    if (problem) return setError(problem)
    try {
      const saved = supplier
        ? await update.mutateAsync({ id: supplier.id, input: toInput(form) })
        : await create.mutateAsync(toInput(form))
      toast({ title: supplier ? "Proveedor actualizado" : "Proveedor creado" })
      if (saved) onSaved?.(saved)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          <DialogDescription>Datos de contacto y plazo de entrega habitual.</DialogDescription>
        </DialogHeader>
        <form
          id="supplier-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="supplier-name">Nombre</Label>
            <Input id="supplier-name" autoFocus {...field("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-tax">NIT</Label>
            <Input id="supplier-tax" {...field("taxId")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-contact">Contacto</Label>
            <Input id="supplier-contact" {...field("contactName")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-phone">Teléfono</Label>
            <Input id="supplier-phone" type="tel" {...field("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-email">Correo</Label>
            <Input id="supplier-email" type="email" {...field("email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-lead">Plazo de entrega (días)</Label>
            <Input id="supplier-lead" inputMode="numeric" {...field("leadTimeDays")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="supplier-notes">Notas</Label>
            <Textarea id="supplier-notes" rows={2} {...field("notes")} />
          </div>
          <div className="sm:col-span-2">
            <FieldError message={error} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="supplier-form" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SuppliersView() {
  const suppliers = useSuppliers()
  const update = useUpdateSupplier()
  const { toast } = useToast()
  const [editing, setEditing] = useState<{ supplier: Supplier | null } | null>(null)

  async function setActive(supplier: Supplier, isActive: boolean) {
    try {
      await update.mutateAsync({ id: supplier.id, input: { isActive } })
      toast({ title: isActive ? "Proveedor activado" : "Proveedor desactivado" })
    } catch (e) {
      toast({ title: "No se pudo actualizar el proveedor", description: (e as Error).message, variant: "destructive" })
    }
  }

  const dash = (v: string | number | null) => (v === null || v === "" ? <span className="text-muted-foreground">—</span> : v)

  const columns: DataTableColumn<Supplier>[] = [
    { id: "name", header: "Nombre", cell: (s) => <span className="font-medium">{s.name}</span> },
    { id: "tax", header: "NIT", cell: (s) => dash(s.taxId) },
    { id: "contact", header: "Contacto", cell: (s) => dash(s.contactName) },
    { id: "phone", header: "Teléfono", cell: (s) => dash(s.phone) },
    { id: "email", header: "Correo", cell: (s) => dash(s.email) },
    { id: "lead", header: "Plazo (días)", className: "text-right tabular-nums", cell: (s) => dash(s.leadTimeDays) },
    {
      id: "active",
      header: "Estado",
      cell: (s) => <Badge variant={s.isActive ? "secondary" : "outline"}>{s.isActive ? "Activo" : "Inactivo"}</Badge>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (s) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => void setActive(s, !s.isActive)}>
            {s.isActive ? "Desactivar" : "Activar"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ supplier: s })}>
            Editar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <DataTable
        rows={suppliers.data ?? []}
        columns={columns}
        getRowId={(s) => s.id}
        isLoading={suppliers.isLoading}
        searchText={(s) => [s.name, s.taxId, s.contactName, s.email].filter(Boolean).join(" ")}
        searchPlaceholder="Buscar proveedor…"
        filters={
          <Button className="sm:ml-auto" onClick={() => setEditing({ supplier: null })}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo proveedor
          </Button>
        }
        empty={<EmptyState icon={Truck} title="Sin proveedores" description="Registra a quién le compras para crear órdenes." />}
      />
      <SupplierDialog supplier={editing?.supplier ?? null} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
