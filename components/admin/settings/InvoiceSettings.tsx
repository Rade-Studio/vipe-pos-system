"use client"

import { useEffect, useMemo, useState, type ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { fetchConfig, saveConfig, type BusinessConfig, type BusinessConfigUpdate } from "@/lib/api/config"
import { SettingsRow, SettingsSection } from "@/components/admin/common/SettingsSection"
import { TAX_REGIME_LABELS, dayLabel, fiscalLines, type TaxRegime } from "@/lib/payments/invoice-fiscal"

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): the invoice prefix and the
 * DIAN data (resolution, authorized range, validity, tax regime). Like the tax
 * type, the config store does not carry these keys: they are read and saved
 * with `GET/PUT /config` and share the page's SaveBar. The server assigns the
 * consecutive when an order is charged and stores this data with the payment.
 */

type InvoiceKey =
  | "invoicePrefix"
  | "invoiceResolution"
  | "invoiceRangeFrom"
  | "invoiceRangeTo"
  | "invoiceValidFrom"
  | "invoiceValidTo"
  | "taxRegime"
const INVOICE_KEYS: readonly InvoiceKey[] = [
  "invoicePrefix",
  "invoiceResolution",
  "invoiceRangeFrom",
  "invoiceRangeTo",
  "invoiceValidFrom",
  "invoiceValidTo",
  "taxRegime",
]
/** The inputs' text; '' is "not set". */
type InvoiceDraft = Record<InvoiceKey, string>
type InvoiceValues = Pick<BusinessConfig, InvoiceKey>

const DEFAULT_VALUES: InvoiceValues = {
  invoicePrefix: "POS",
  invoiceResolution: null,
  invoiceRangeFrom: 1,
  invoiceRangeTo: null,
  invoiceValidFrom: null,
  invoiceValidTo: null,
  taxRegime: null,
}
const PREFIX = /^[A-Z0-9]{1,10}$/
/** Same rule as the API: the resolution reaches raw ESC/POS output. */
const RESOLUTION = /^[\p{L}\p{N} ./-]*$/u
const EXPIRING_DAYS = 30
export const PREFIX_MESSAGE = "El prefijo lleva de 1 a 10 letras o números, sin espacios ni guiones"
export const RESOLUTION_MESSAGE = "La resolución solo lleva letras, números, espacios y los signos - . /"
export const RANGE_MESSAGE = "El número final del rango autorizado debe ser mayor o igual al inicial"
export const RANGE_FROM_MESSAGE = "El número inicial debe ser un entero desde 1"
export const VALIDITY_MESSAGE = "La fecha final de la vigencia debe ser igual o posterior a la inicial"

const toDraft = (values: InvoiceValues): InvoiceDraft => ({
  invoicePrefix: values.invoicePrefix,
  invoiceResolution: values.invoiceResolution ?? "",
  invoiceRangeFrom: String(values.invoiceRangeFrom),
  invoiceRangeTo: values.invoiceRangeTo === null ? "" : String(values.invoiceRangeTo),
  invoiceValidFrom: values.invoiceValidFrom ?? "",
  invoiceValidTo: values.invoiceValidTo ?? "",
  taxRegime: values.taxRegime ?? "",
})

const wholeOrNull = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null)

/** The values a draft stands for; NaN where an input is not a number. */
function fromDraft(draft: InvoiceDraft): InvoiceValues {
  const to = draft.invoiceRangeTo.trim()
  return {
    invoicePrefix: draft.invoicePrefix.trim(),
    invoiceResolution: draft.invoiceResolution.trim() || null,
    invoiceRangeFrom: wholeOrNull(draft.invoiceRangeFrom) ?? Number.NaN,
    invoiceRangeTo: to === "" ? null : (wholeOrNull(to) ?? Number.NaN),
    invoiceValidFrom: draft.invoiceValidFrom || null,
    invoiceValidTo: draft.invoiceValidTo || null,
    taxRegime: (draft.taxRegime || null) as TaxRegime | null,
  }
}

/** One message per invalid field (the server applies the same rules). */
function validate(values: InvoiceValues): Partial<Record<InvoiceKey, string>> {
  const errors: Partial<Record<InvoiceKey, string>> = {}
  if (!PREFIX.test(values.invoicePrefix)) errors.invoicePrefix = PREFIX_MESSAGE
  if (values.invoiceResolution && !RESOLUTION.test(values.invoiceResolution)) errors.invoiceResolution = RESOLUTION_MESSAGE
  if (!Number.isInteger(values.invoiceRangeFrom) || values.invoiceRangeFrom < 1) errors.invoiceRangeFrom = RANGE_FROM_MESSAGE
  if (
    values.invoiceRangeTo !== null &&
    (!Number.isInteger(values.invoiceRangeTo) || values.invoiceRangeTo < Math.max(1, values.invoiceRangeFrom || 1))
  ) {
    errors.invoiceRangeTo = RANGE_MESSAGE
  }
  if (values.invoiceValidFrom && values.invoiceValidTo && values.invoiceValidTo < values.invoiceValidFrom) {
    errors.invoiceValidTo = VALIDITY_MESSAGE
  }
  return errors
}

/** Today's local date, YYYY-MM-DD. */
function localToday() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** A notice for the saved validity; null while it is far or not set. */
function validityNotice(validTo: string | null): string | null {
  if (!validTo) return null
  const left = daysBetween(localToday(), validTo)
  if (left < 0) return `La resolución DIAN venció el ${dayLabel(validTo)}. Los cobros siguen funcionando, pero actualiza la resolución.`
  if (left <= EXPIRING_DAYS) return `La resolución DIAN vence el ${dayLabel(validTo)}. Renuévala a tiempo.`
  return null
}

export function useInvoiceSettings() {
  const { toast } = useToast()
  const [saved, setSaved] = useState<InvoiceValues>(DEFAULT_VALUES)
  const [draft, setDraft] = useState<InvoiceDraft>(toDraft(DEFAULT_VALUES))

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const config = await fetchConfig()
        if (!active) return
        const values = { ...DEFAULT_VALUES }
        for (const key of INVOICE_KEYS) {
          if (config[key] !== undefined) (values as Record<string, unknown>)[key] = config[key]
        }
        setSaved(values)
        setDraft(toDraft(values))
      } catch {
        // Keep the server defaults on screen.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const values = useMemo(() => fromDraft(draft), [draft])
  const errors = useMemo(() => validate(values), [values])
  const changed = INVOICE_KEYS.filter((key) => !Object.is(values[key], saved[key]))
  const dirty = changed.length > 0

  const update = (key: InvoiceKey, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: key === "invoicePrefix" ? value.toUpperCase() : value }))

  /** true when saved (or nothing to save); false keeps the draft on screen. */
  const save = async (): Promise<boolean> => {
    if (!dirty) return true
    const first = Object.values(errors)[0]
    if (first) {
      toast({ title: "Revisa la facturación", description: first, variant: "destructive" })
      return false
    }
    const body: Record<string, unknown> = {}
    for (const key of changed) body[key] = values[key]
    try {
      const config = await saveConfig(body as BusinessConfigUpdate)
      const next = { ...saved }
      for (const key of INVOICE_KEYS) {
        if (config[key] !== undefined) (next as Record<string, unknown>)[key] = config[key]
      }
      setSaved(next)
      setDraft(toDraft(next))
      return true
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error && error.message ? error.message : "No se pudo guardar la facturación. Intenta nuevamente.",
        variant: "destructive",
      })
      return false
    }
  }

  return { draft, saved, values, errors, dirty, update, save, discard: () => setDraft(toDraft(saved)) }
}

type InvoiceSettingsState = ReturnType<typeof useInvoiceSettings>

const SELECT_CLASS =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-72"

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-sm text-destructive">
      {message}
    </p>
  )
}

export function InvoiceSettingsSection({ state, disabled }: { state: InvoiceSettingsState; disabled: boolean }) {
  const { draft, values, errors, update, saved } = state
  const notice = validityNotice(saved.invoiceValidTo)
  const prefix = PREFIX.test(values.invoicePrefix) ? values.invoicePrefix : saved.invoicePrefix
  const start = Number.isInteger(values.invoiceRangeFrom) && values.invoiceRangeFrom > 0 ? values.invoiceRangeFrom : 1
  const sample = `${prefix}-${String(Math.max(start, 123)).padStart(6, "0")}`
  const lines = fiscalLines({
    prefix,
    resolution: values.invoiceResolution,
    rangeFrom: start,
    rangeTo: errors.invoiceRangeTo ? null : values.invoiceRangeTo,
    validFrom: values.invoiceValidFrom,
    validTo: values.invoiceValidTo,
    taxRegime: values.taxRegime,
  })
  const field = (key: InvoiceKey, props: ComponentProps<typeof Input>) => (
    <>
      <Input
        id={key}
        value={draft[key]}
        onChange={(event) => update(key, event.target.value)}
        disabled={disabled}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
        className="h-11 md:w-72"
        {...props}
      />
      <FieldError id={`${key}-error`} message={errors[key]} />
    </>
  )

  return (
    <SettingsSection title="Facturación (DIAN)">
      {notice && (
        <p role="status" className="mx-4 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:mx-6 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {notice}
        </p>
      )}
      <SettingsRow
        label="Prefijo"
        htmlFor="invoicePrefix"
        description="Cada cobro recibe el siguiente número de este restaurante con este prefijo, por ejemplo POS-000123."
      >
        {field("invoicePrefix", { maxLength: 10, autoComplete: "off" })}
      </SettingsRow>
      <SettingsRow label="Resolución DIAN" htmlFor="invoiceResolution" description="Número de la resolución que autoriza tu numeración. Déjalo vacío si aún no la tienes.">
        {field("invoiceResolution", { maxLength: 60, inputMode: "numeric", autoComplete: "off" })}
      </SettingsRow>
      <SettingsRow
        label="Número inicial"
        htmlFor="invoiceRangeFrom"
        description="Primer número del rango autorizado. La numeración nunca empieza por debajo de él."
      >
        {field("invoiceRangeFrom", { inputMode: "numeric" })}
      </SettingsRow>
      <SettingsRow
        label="Número final"
        htmlFor="invoiceRangeTo"
        description="Último número autorizado. Te avisamos cuando te acerques o lo pases; los cobros no se bloquean."
      >
        {field("invoiceRangeTo", { inputMode: "numeric" })}
      </SettingsRow>
      <SettingsRow label="Vigente desde" htmlFor="invoiceValidFrom" description="Fecha de inicio de la resolución.">
        {field("invoiceValidFrom", { type: "date" })}
      </SettingsRow>
      <SettingsRow
        label="Vigente hasta"
        htmlFor="invoiceValidTo"
        description="Fecha en que vence la resolución. Te avisamos 30 días antes; los cobros no se bloquean."
      >
        {field("invoiceValidTo", { type: "date" })}
      </SettingsRow>
      <SettingsRow label="Régimen tributario" htmlFor="taxRegime" description="Se imprime en la factura.">
        <select
          id="taxRegime"
          value={draft.taxRegime}
          onChange={(event) => update("taxRegime", event.target.value)}
          disabled={disabled}
          className={SELECT_CLASS}
        >
          <option value="">Sin especificar</option>
          {(Object.keys(TAX_REGIME_LABELS) as TaxRegime[]).map((regime) => (
            <option key={regime} value={regime}>
              {TAX_REGIME_LABELS[regime]}
            </option>
          ))}
        </select>
      </SettingsRow>
      <div className="px-4 py-4 sm:px-6">
        <p className="mb-2 text-sm font-medium">Así sale en la factura</p>
        <div className="space-y-0.5 rounded-md bg-muted/50 p-3 text-center font-mono text-xs" data-testid="invoice-preview">
          <p>FACTURA: {sample}</p>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">La facturación electrónica se configurará más adelante.</p>
      </div>
    </SettingsSection>
  )
}
