"use client"

import { Input } from "@/components/ui/input"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { SettingsRow, SettingsSection } from "@/components/admin/common/SettingsSection"
import { SettingsPage } from "./SettingsPage"
import { useSettingsDraft } from "./use-settings-draft"

const KEYS = ["businessName", "businessAddress", "businessPhone", "businessNIT"] as const

const FIELDS = [
  { key: "businessName", id: "businessName", label: "Nombre del negocio", description: "Encabezado de facturas y comandas." },
  { key: "businessNIT", id: "businessNIT", label: "NIT", description: "Identificación tributaria." },
  { key: "businessAddress", id: "businessAddress", label: "Dirección", description: undefined },
  { key: "businessPhone", id: "businessPhone", label: "Teléfono", description: undefined },
] as const

/** Mirrors the header lines of the printed invoice (lib/print/renderKitchenOrder.ts). */
function ReceiptPreview({ name, nit, address, phone }: { name: string; nit: string; address: string; phone: string }) {
  return (
    <div
      aria-label="Vista previa del encabezado de la factura"
      className="mx-auto w-full max-w-[18rem] rounded-md border bg-background p-4 text-center font-mono text-xs leading-relaxed shadow-sm"
    >
      <p className="font-semibold">{(name || "RESTAURANTE").toUpperCase()}</p>
      <p>NIT: {nit || "N/A"}</p>
      <p>{address || "N/A"}</p>
      <p>Tel: {phone || "N/A"}</p>
      <p className="text-muted-foreground">--------------------------------</p>
      <p className="text-muted-foreground">Mesa 4 · 2 productos</p>
    </div>
  )
}

export function BusinessSettings() {
  const { draft, update, dirty, save, discard, saving, isLoading } = useSettingsDraft(KEYS)

  return (
    <SettingsPage title="Negocio" description="Esta información aparece en las facturas y comandas impresas.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <SettingsSection title="Datos del negocio">
          {FIELDS.map((field) => (
            <SettingsRow key={field.key} label={field.label} description={field.description} htmlFor={field.id}>
              <Input
                id={field.id}
                value={draft[field.key]}
                onChange={(event) => update(field.key, event.target.value)}
                disabled={isLoading || saving}
              />
            </SettingsRow>
          ))}
        </SettingsSection>
        <div className="space-y-2">
          <p className="text-sm font-medium">Vista previa</p>
          <ReceiptPreview
            name={draft.businessName}
            nit={draft.businessNIT}
            address={draft.businessAddress}
            phone={draft.businessPhone}
          />
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={discard} />
    </SettingsPage>
  )
}
