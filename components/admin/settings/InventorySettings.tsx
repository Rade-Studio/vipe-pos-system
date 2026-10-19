"use client"

import { Info } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { SettingsRow, SettingsSection } from "@/components/admin/common/SettingsSection"
import { SettingsPage } from "./SettingsPage"
import { useSettingsDraft } from "./use-settings-draft"

const KEYS = ["inventoryControlEnabled"] as const

export function InventorySettings() {
  const { draft, update, dirty, save, discard, saving, isLoading } = useSettingsDraft(KEYS)

  return (
    <SettingsPage title="Inventario" description="Control automático del stock al vender.">
      <SettingsSection title="Control de inventario">
        <SettingsRow
          label="Control de inventario"
          htmlFor="inventoryControl"
          description="Activa el control automático de inventario al enviar órdenes a cocina."
        >
          <div className="flex md:justify-end">
            <Switch
              id="inventoryControl"
              checked={draft.inventoryControlEnabled}
              onCheckedChange={(checked) => update("inventoryControlEnabled", checked)}
              disabled={isLoading || saving}
            />
          </div>
        </SettingsRow>
        <div className="flex gap-3 px-4 py-4 text-sm sm:px-6">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-2">
            <p className="font-medium">Al activar el control de inventario:</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>Se verificará el stock de ingredientes al enviar órdenes a cocina</li>
              <li>Se descontará automáticamente el stock de los ingredientes</li>
              <li>Los platos sin stock suficiente se mostrarán como "Agotado"</li>
              <li>Los platos sin receta definida no serán afectados</li>
            </ul>
          </div>
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={discard} />
    </SettingsPage>
  )
}
