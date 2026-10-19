"use client"

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

export function TaxSettings() {
  const { draft, update, dirty, save, discard, saving, isLoading } = useSettingsDraft(KEYS)
  const bill = exampleBill(SAMPLE_SUBTOTAL, draft.taxPercentage, draft.tipPercentage)
  const disabled = isLoading || saving

  return (
    <SettingsPage title="Impuestos y propinas" description="Porcentajes que se aplican a cada cuenta y a los precios sugeridos.">
      <SettingsSection title="Cuenta">
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
              <dt className="text-muted-foreground">Impuesto ({draft.taxPercentage}%)</dt>
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
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={discard} />
    </SettingsPage>
  )
}
