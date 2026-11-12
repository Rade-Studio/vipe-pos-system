"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { fetchConfig, saveConfig } from "@/lib/api/config"
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

// Same values as lib/api/config (0..6, server default 4); kept local so the
// settings suites that stub that module whole still render this page.
const BUSINESS_DAY_CUTOFF_HOURS = [0, 1, 2, 3, 4, 5, 6] as const
const DEFAULT_BUSINESS_DAY_CUTOFF_HOUR = 4

function cutoffLabel(hour: number): string {
  return hour === 0 ? "12:00 a. m. (medianoche)" : `${hour}:00 a. m.`
}

/**
 * Hora de corte del día de negocio (caja-cierres S5). The config store does
 * not carry this key, so it is read and saved with `GET/PUT /config` directly;
 * the same SaveBar saves it together with the business data.
 */
function useBusinessDayCutoff() {
  const { toast } = useToast()
  const [saved, setSaved] = useState(DEFAULT_BUSINESS_DAY_CUTOFF_HOUR)
  const [draft, setDraft] = useState(DEFAULT_BUSINESS_DAY_CUTOFF_HOUR)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const hour = (await fetchConfig()).businessDayCutoffHour ?? DEFAULT_BUSINESS_DAY_CUTOFF_HOUR
        if (!active) return
        setSaved(hour)
        setDraft(hour)
      } catch {
        // Keep the server default (4 a.m.) on screen.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const dirty = draft !== saved
  const save = async () => {
    try {
      const hour = (await saveConfig({ businessDayCutoffHour: draft })).businessDayCutoffHour ?? draft
      setSaved(hour)
      setDraft(hour)
      return true
    } catch {
      toast({ title: "Error", description: "No se pudo guardar la hora de corte. Intenta nuevamente.", variant: "destructive" })
      return false
    }
  }
  return { draft, setDraft, dirty, save, discard: () => setDraft(saved) }
}

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
  const { toast } = useToast()
  const { draft, update, dirty, save, discard, saving, isLoading } = useSettingsDraft(KEYS)
  const cutoff = useBusinessDayCutoff()
  const [savingCutoff, setSavingCutoff] = useState(false)

  const saveAll = async () => {
    if (cutoff.dirty) {
      setSavingCutoff(true)
      const ok = await cutoff.save()
      setSavingCutoff(false)
      if (ok && !dirty) toast({ title: "Configuración guardada", description: "Los cambios se han guardado correctamente." })
    }
    if (dirty) await save()
  }

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
          <SettingsRow
            label="Hora de corte del día de negocio"
            description="Los turnos que abren antes de esta hora pertenecen al día anterior (caja, resúmenes y cierres)."
            htmlFor="businessDayCutoffHour"
          >
            <select
              id="businessDayCutoffHour"
              value={cutoff.draft}
              onChange={(event) => cutoff.setDraft(Number(event.target.value))}
              disabled={saving || savingCutoff}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-56"
            >
              {BUSINESS_DAY_CUTOFF_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {cutoffLabel(hour)}
                </option>
              ))}
            </select>
          </SettingsRow>
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
      <SaveBar
        dirty={dirty || cutoff.dirty}
        saving={saving || savingCutoff}
        onSave={saveAll}
        onDiscard={() => {
          discard()
          cutoff.discard()
        }}
      />
    </SettingsPage>
  )
}
