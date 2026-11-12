"use client"

import { useEffect, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { fetchConfig, saveConfig, type TaxType } from "@/lib/api/config"
import { DEFAULT_TAX_TYPE, TAX_TYPES, taxLabel } from "@/components/printing/tax-label"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { SettingsRow, SettingsSection } from "@/components/admin/common/SettingsSection"
import { formatCurrency } from "@/utils/helpers"
import { PercentField } from "./PercentField"
import { SettingsPage } from "./SettingsPage"
import { exampleBill } from "./settings-draft"
import { useSettingsDraft } from "./use-settings-draft"

const KEYS = ["taxPercentage", "tipPercentage", "priceSuggestion"] as const
const SAMPLE_SUBTOTAL = 100_000
const SAMPLE_COST = 10_000

/**
 * Tipo de impuesto (caja-cierres S9). The config store does not carry this
 * key, so it is read and saved with `GET/PUT /config` directly (like the
 * cut-off hour in BusinessSettings); the same SaveBar saves it. Changing the
 * type never changes the percentage.
 */
function useTaxTypeSetting() {
  const { toast } = useToast()
  const [saved, setSaved] = useState<TaxType>(DEFAULT_TAX_TYPE)
  const [draft, setDraft] = useState<TaxType>(DEFAULT_TAX_TYPE)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const type = (await fetchConfig()).taxType ?? DEFAULT_TAX_TYPE
        if (!active) return
        setSaved(type)
        setDraft(type)
      } catch {
        // Keep the server default (INC) on screen.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const dirty = draft !== saved
  const save = async () => {
    try {
      const type = (await saveConfig({ taxType: draft })).taxType ?? draft
      setSaved(type)
      setDraft(type)
      return true
    } catch {
      toast({ title: "Error", description: "No se pudo guardar el tipo de impuesto. Intenta nuevamente.", variant: "destructive" })
      return false
    }
  }
  return { draft, setDraft, dirty, save, discard: () => setDraft(saved) }
}

export function TaxSettings() {
  const { toast } = useToast()
  const { draft, update, dirty, save, discard, saving, isLoading } = useSettingsDraft(KEYS)
  const taxType = useTaxTypeSetting()
  const [savingType, setSavingType] = useState(false)
  const bill = exampleBill(SAMPLE_SUBTOTAL, draft.taxPercentage, draft.tipPercentage)
  const disabled = isLoading || saving || savingType

  const saveAll = async () => {
    if (taxType.dirty) {
      setSavingType(true)
      const ok = await taxType.save()
      setSavingType(false)
      if (ok && !dirty) toast({ title: "Configuración guardada", description: "Los cambios se han guardado correctamente." })
    }
    if (dirty) await save()
  }

  return (
    <SettingsPage title="Impuestos y propinas" description="Porcentajes que se aplican a cada cuenta y a los precios sugeridos.">
      <SettingsSection title="Cuenta">
        <SettingsRow
          label="Tipo de impuesto"
          htmlFor="taxType"
          description="Los restaurantes suelen cobrar INC del 8 % (impuesto nacional al consumo); el IVA aplica a otros negocios. Se muestra en facturas, tirillas e informes. Cambiar el tipo no cambia el porcentaje."
        >
          <select
            id="taxType"
            value={taxType.draft}
            onChange={(event) => taxType.setDraft(event.target.value as TaxType)}
            disabled={disabled}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-72"
          >
            {TAX_TYPES.map((tax) => (
              <option key={tax.value} value={tax.value}>
                {tax.value === tax.name ? tax.value : `${tax.value} · ${tax.name}`}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          label="Impuesto"
          htmlFor="taxPercentage"
          description="Se suma al subtotal de todas las órdenes."
        >
          <PercentField
            id="taxPercentage"
            value={draft.taxPercentage}
            onChange={(value) => update("taxPercentage", value)}
            min={0}
            max={20}
            step={1}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow
          label="Propina sugerida"
          htmlFor="tipPercentage"
          description="Se muestra en la factura; el cliente puede retirarla."
        >
          <PercentField
            id="tipPercentage"
            value={draft.tipPercentage}
            onChange={(value) => update("tipPercentage", value)}
            min={0}
            max={20}
            step={1}
            disabled={disabled}
          />
        </SettingsRow>
        <div className="px-4 py-4 sm:px-6">
          <p className="mb-2 text-sm font-medium">Ejemplo con una cuenta de {formatCurrency(SAMPLE_SUBTOTAL)}</p>
          <dl className="space-y-1 rounded-md bg-muted/50 p-3 text-sm tabular-nums" data-testid="tax-example">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatCurrency(bill.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{taxLabel(taxType.draft, draft.taxPercentage)}</dt>
              <dd>{formatCurrency(bill.tax)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Propina ({draft.tipPercentage}%)</dt>
              <dd>{formatCurrency(bill.tip)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-medium">
              <dt>Total</dt>
              <dd>{formatCurrency(bill.total)}</dd>
            </div>
          </dl>
        </div>
      </SettingsSection>

      <SettingsSection title="Precios">
        <SettingsRow
          label="Precio de venta sugerido"
          htmlFor="priceSuggestion"
          description={`Porcentaje sobre el costo de la receta. Un plato que cuesta ${formatCurrency(SAMPLE_COST)} se sugiere a ${formatCurrency(SAMPLE_COST * (draft.priceSuggestion / 100))}.`}
        >
          <PercentField
            id="priceSuggestion"
            value={draft.priceSuggestion}
            onChange={(value) => update("priceSuggestion", value)}
            min={50}
            max={500}
            step={10}
            disabled={disabled}
          />
        </SettingsRow>
      </SettingsSection>
      <SaveBar
        dirty={dirty || taxType.dirty}
        saving={saving || savingType}
        onSave={saveAll}
        onDiscard={() => {
          discard()
          taxType.discard()
        }}
      />
    </SettingsPage>
  )
}
