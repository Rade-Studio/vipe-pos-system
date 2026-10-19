"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
  useAdjustStock,
  useCreateCategory,
  useCreateItem,
  useInventoryCategories,
  useInventoryLocations,
  useSuppliers,
  useUpdateItem,
} from "@/hooks/inventory"
import {
  emptyItemForm,
  fromItem,
  hasErrors,
  purchaseFactorHelper,
  toInput,
  toOpening,
  validateItemForm,
  type ItemFormErrors,
  type ItemFormValues,
} from "@/lib/inventory/item-form"
import { UNIT_OPTIONS } from "@/lib/inventory/units"
import type { InventoryItem } from "@/lib/supabase/inventory/types"
import { FieldError, KIND_LABEL, NativeSelect } from "./stock-ui"

interface ItemFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  item: InventoryItem | null
  onSaved?: (item: InventoryItem) => void
}

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="text-sm font-medium">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function ItemFormSheet({ open, onOpenChange, item, onSaved }: ItemFormSheetProps) {
  const mode = item ? "edit" : "create"
  const [values, setValues] = useState<ItemFormValues>(emptyItemForm)
  const [errors, setErrors] = useState<ItemFormErrors>({})
  const [editSku, setEditSku] = useState(false)
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const { toast } = useToast()

  const categories = useInventoryCategories()
  const suppliers = useSuppliers()
  const locations = useInventoryLocations()
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const adjustStock = useAdjustStock()
  const createCategory = useCreateCategory()
  const saving = createItem.isPending || updateItem.isPending || adjustStock.isPending

  useEffect(() => {
    if (!open) return
    setValues(item ? fromItem(item) : emptyItemForm())
    setErrors({})
    setEditSku(false)
    setNewCategory(null)
  }, [open, item])

  const set = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function addCategory() {
    const name = newCategory?.trim()
    if (!name) return
    try {
      const created = await createCategory.mutateAsync({ name })
      set("categoryId", created.id)
      setNewCategory(null)
    } catch (error) {
      toast({ title: "No se pudo crear la categoría", description: (error as Error).message, variant: "destructive" })
    }
  }

  async function save() {
    const found = validateItemForm(values, mode)
    setErrors(found)
    if (hasErrors(found)) return
    try {
      if (item) {
        const saved = await updateItem.mutateAsync({ id: item.id, input: toInput(values) })
        toast({ title: "Artículo actualizado" })
        onSaved?.(saved)
      } else {
        const saved = await createItem.mutateAsync(toInput(values))
        const opening = toOpening(values)
        const location = (locations.data ?? []).find((l) => l.isDefault)
        if (opening && location) {
          await adjustStock.mutateAsync({
            itemId: saved.id,
            locationId: location.id,
            movementType: "opening",
            quantity: opening.quantity,
            unitCost: opening.unitCost,
            reason: "Stock inicial",
          })
        }
        toast({ title: "Artículo creado", description: `SKU ${saved.sku}` })
        onSaved?.(saved)
      }
      onOpenChange(false)
    } catch (error) {
      toast({ title: "No se pudo guardar", description: (error as Error).message, variant: "destructive" })
    }
  }

  const helper = purchaseFactorHelper(values)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{item ? "Editar artículo" : "Nuevo artículo"}</SheetTitle>
          <SheetDescription>
            {item ? `${item.sku} · el stock y el costo cambian con movimientos` : "Materia prima o preparación del inventario"}
          </SheetDescription>
        </SheetHeader>

        <form
          id="item-form"
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Section title="General">
            <div className="sm:col-span-2">
              <Field label="Nombre" htmlFor="item-name" error={errors.name}>
                <Input id="item-name" value={values.name} onChange={(e) => set("name", e.target.value)} autoFocus />
              </Field>
            </div>
            <Field label="Tipo" htmlFor="item-kind">
              <NativeSelect id="item-kind" value={values.kind} onChange={(e) => set("kind", e.target.value as ItemFormValues["kind"])}>
                <option value="raw">{KIND_LABEL.raw}</option>
                <option value="prep">{KIND_LABEL.prep}</option>
              </NativeSelect>
            </Field>
            <Field label="Unidad" htmlFor="item-unit" error={errors.unit}>
              <NativeSelect id="item-unit" value={values.unit} onChange={(e) => set("unit", e.target.value)}>
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Categoría" htmlFor="item-category">
                {newCategory === null ? (
                  <div className="flex gap-2">
                    <NativeSelect
                      id="item-category"
                      value={values.categoryId ?? ""}
                      onChange={(e) => set("categoryId", e.target.value || null)}
                    >
                      <option value="">Sin categoría</option>
                      {(categories.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="button" variant="outline" size="icon" aria-label="Nueva categoría" onClick={() => setNewCategory("")}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="item-category"
                      placeholder="Nombre de la categoría"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void addCategory()
                        }
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={() => void addCategory()} disabled={createCategory.isPending}>
                      Crear
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setNewCategory(null)}>
                      Cancelar
                    </Button>
                  </div>
                )}
              </Field>
            </div>
            <Field
              label="SKU"
              htmlFor="item-sku"
              error={errors.sku}
              hint={
                !editSku && !item ? (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setEditSku(true)}>
                    Definir manualmente
                  </button>
                ) : undefined
              }
            >
              <Input
                id="item-sku"
                className="font-mono uppercase"
                value={values.sku}
                placeholder={item || editSku ? "MP-0001" : "Se genera al guardar"}
                readOnly={!item && !editSku}
                onChange={(e) => set("sku", e.target.value)}
              />
            </Field>
            <Field label="Código de barras" htmlFor="item-barcode">
              <Input id="item-barcode" value={values.barcode} onChange={(e) => set("barcode", e.target.value)} />
            </Field>
          </Section>

          <Section title="Reposición">
            <Field label="Mínimo" htmlFor="item-min" error={errors.minStock}>
              <Input id="item-min" inputMode="decimal" value={values.minStock} onChange={(e) => set("minStock", e.target.value)} />
            </Field>
            <Field label="Máximo" htmlFor="item-max" error={errors.maxStock} hint="Opcional">
              <Input id="item-max" inputMode="decimal" value={values.maxStock} onChange={(e) => set("maxStock", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Proveedor por defecto" htmlFor="item-supplier">
                <NativeSelect
                  id="item-supplier"
                  value={values.defaultSupplierId ?? ""}
                  onChange={(e) => set("defaultSupplierId", e.target.value || null)}
                >
                  <option value="">Sin proveedor</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Unidad de compra" htmlFor="item-purchase-unit">
              <NativeSelect id="item-purchase-unit" value={values.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value)}>
                <option value="">Igual a la unidad base</option>
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Factor" htmlFor="item-factor" error={errors.purchaseFactor} hint={helper}>
              <Input
                id="item-factor"
                inputMode="decimal"
                value={values.purchaseFactor}
                disabled={!values.purchaseUnit}
                onChange={(e) => set("purchaseFactor", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Control">
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
              <Label htmlFor="item-lots" className="font-normal">
                Lotes y vencimiento
              </Label>
              <Switch id="item-lots" checked={values.trackLots} onCheckedChange={(v) => set("trackLots", v)} />
            </div>
            <Field label="Vida útil (días)" htmlFor="item-shelf" error={errors.shelfLifeDays}>
              <Input id="item-shelf" inputMode="numeric" value={values.shelfLifeDays} onChange={(e) => set("shelfLifeDays", e.target.value)} />
            </Field>
            <div className="flex items-center justify-between gap-3 self-end rounded-md border px-3 py-2">
              <Label htmlFor="item-active" className="font-normal">
                Activo
              </Label>
              <Switch id="item-active" checked={values.isActive} onCheckedChange={(v) => set("isActive", v)} />
            </div>
          </Section>

          {!item && (
            <Section title="Stock inicial">
              <Field label="Cantidad inicial" htmlFor="item-initial-stock" error={errors.initialStock} hint={`En ${values.unit}, en la bodega principal`}>
                <Input
                  id="item-initial-stock"
                  inputMode="decimal"
                  value={values.initialStock}
                  onChange={(e) => set("initialStock", e.target.value)}
                />
              </Field>
              <Field label="Costo inicial" htmlFor="item-initial-cost" error={errors.initialCost} hint={`Por ${values.unit}`}>
                <Input id="item-initial-cost" inputMode="decimal" value={values.initialCost} onChange={(e) => set("initialCost", e.target.value)} />
              </Field>
            </Section>
          )}
        </form>

        <SheetFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="item-form" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {item ? "Guardar cambios" : "Crear artículo"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
