"use client"

import { useState } from "react"
import { ArrowLeft, Truck } from "lucide-react"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Panel } from "@/components/admin/common/Panel"
import { NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useStartCount } from "@/hooks/counts/use-counts"
import { useInventoryCategories, useInventoryItems, useInventoryLocations, useOpenCount, useStaffMembers } from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "./count-ui"

const ROLE_LABEL: Record<string, string> = {
  admin: "Administración",
  waiter: "Mesero",
  kitchen: "Cocina",
  cashier: "Caja",
  delivery_operator: "Domicilios",
}

interface PrepareCountProps {
  onBack: () => void
  onOpened: (countId: string) => void
}

/**
 * "Preparar" (S5): one bodega, all items or a category, who counts (any
 * staff) and the admin who approves, never the same person. Without a
 * counter the count opens as before and is counted on the admin sheet.
 */
export function PrepareCount({ onBack, onOpened }: PrepareCountProps) {
  const { toast } = useToast()
  const locations = (useInventoryLocations().data ?? []).filter((l) => l.isActive)
  const categories = useInventoryCategories().data ?? []
  const items = useInventoryItems().data ?? []
  const staff = (useStaffMembers().data ?? []).filter((s) => s.active)
  const openCount = useOpenCount()
  const startCount = useStartCount()
  const [locationId, setLocationId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [counterId, setCounterId] = useState("")
  const [approverChoice, setApproverChoice] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)

  const admins = staff.filter((s) => s.role === "admin")
  const effectiveLocationId = locationId || locations.find((l) => l.isDefault)?.id || locations[0]?.id || ""
  // The approver defaults to the first admin who is not counting.
  const approverId =
    approverChoice && approverChoice !== counterId ? approverChoice : counterId ? (admins.find((a) => a.id !== counterId)?.id ?? "") : ""
  const scopeItems = items.filter((item) => item.isActive && (!categoryId || item.categoryId === categoryId))
  const missingApprover = !!counterId && !approverId

  const submit = async () => {
    setError(null)
    if (categoryId && scopeItems.length === 0) return setError("La categoría no tiene artículos activos.")
    try {
      const result = await openCount.mutateAsync({
        locationId: effectiveLocationId || null,
        itemIds: categoryId ? scopeItems.map((item) => item.id) : null,
        notes: notes.trim() || null,
        ...(counterId ? { counterId, approverId } : {}),
      })
      if (counterId) await startCount.mutateAsync(result.countId)
      const counter = staff.find((s) => s.id === counterId)?.fullName
      toast({
        title: `Conteo #${result.number} abierto`,
        description: counter ? `${counter} lo verá en su celular.` : `${result.linesCount} artículos por contar`,
      })
      onOpened(result.countId)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Preparar conteo"
        description="Dónde, qué y quién. El stock esperado se congela al abrir el conteo."
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Conteos
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <h2 className="font-semibold">¿Dónde? Bodega y alcance</h2>
          <div className="space-y-1.5">
            <Label htmlFor="count-location">Bodega</Label>
            <NativeSelect id="count-location" value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count-category">Qué se cuenta</Label>
            <NativeSelect id="count-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todo ({items.filter((i) => i.isActive).length} artículos activos)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  Categoría: {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="flex gap-2 rounded-md border border-dashed p-2 text-sm">
            <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b>Las existencias en tránsito no se cuentan en ninguna bodega.</b> Ya salieron del origen y aún no entran al destino; si
              llegan durante el conteo, déjalas aparte hasta recibirlas en Transferencias.
            </span>
          </p>
        </Panel>
        <Panel className="space-y-3 p-4">
          <h2 className="font-semibold">¿Quién? Cuenta y revisa</h2>
          <div className="space-y-1.5">
            <Label htmlFor="count-counter">Cuenta</Label>
            <NativeSelect id="count-counter" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
              <option value="">Sin asignar (lo cuento yo en esta pantalla)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} · {ROLE_LABEL[s.role] ?? s.role}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count-approver">Revisa y aprueba</Label>
            <NativeSelect id="count-approver" value={approverId} disabled={!counterId} onChange={(e) => setApproverChoice(e.target.value)}>
              {!approverId && <option value="">—</option>}
              {admins.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === counterId}>
                  {a.fullName}
                  {a.id === counterId ? " (cuenta)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className={missingApprover ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {missingApprover
              ? "Se necesita otra persona administradora para revisar."
              : "Quien cuenta no ve el stock del sistema ni aprueba su propio conteo."}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="count-notes">Nota (opcional)</Label>
            <Textarea id="count-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: cierre de mes" />
          </div>
        </Panel>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border p-3">
        <p className="mr-auto text-sm" aria-live="polite">
          <b>{scopeItems.length} artículos</b>
          {counterId && ` · Cuenta ${staff.find((s) => s.id === counterId)?.fullName ?? ""}`}
        </p>
        <Button onClick={submit} disabled={missingApprover || openCount.isPending || startCount.isPending}>
          Abrir conteo
        </Button>
      </div>
    </div>
  )
}
