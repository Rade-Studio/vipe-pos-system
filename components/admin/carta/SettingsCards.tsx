"use client"

import { useRef, useState, type ReactNode } from "react"
import { Copy, ExternalLink, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  brandHint,
  CARTA_IMAGE_TYPES,
  closesAfterMidnight,
  DESCRIPTION_MAX,
  slugHint,
  uploadCartaAsset,
  type CartaAdminRestaurant,
  type CartaAdminSettings,
  type CartaAssetKind,
  type CartaOpeningDay,
  type CartaOpeningHours,
  type SettingsField,
} from "@/lib/api/carta-admin"
import { DEFAULT_BRAND } from "@/lib/carta/brand"
import { formatCop, initials } from "@/lib/carta/format"
import { cn } from "@/lib/utils"
import { CartaCard, ConfirmDialog, Field, inputClass, StaticChip, SwitchRow } from "./parts"

export interface SettingsCardProps {
  draft: CartaAdminSettings
  update: (patch: Partial<CartaAdminSettings>) => void
  errorOf: (field: SettingsField) => string | null
}

const describedBy = (id: string, error: string | null) => (error ? `${id}-error` : `${id}-hint`)

// ---------------------------------------------------------------------------

export function PublicationCard({
  draft,
  update,
  restaurant,
  publicUrl,
  onChangeSlug,
}: SettingsCardProps & {
  restaurant: CartaAdminRestaurant
  publicUrl: string
  /** Resolves with the API's message when the change failed, else null. */
  onChangeSlug: (slug: string) => Promise<string | null>
}) {
  const [slug, setSlug] = useState(restaurant.slug)
  const [apiError, setApiError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [syncedSlug, setSyncedSlug] = useState(restaurant.slug)
  if (syncedSlug !== restaurant.slug) {
    setSyncedSlug(restaurant.slug)
    setSlug(restaurant.slug)
  }

  const formatError = slugHint(slug)
  const error = formatError ?? apiError
  const canChange = !formatError && slug !== restaurant.slug && !busy

  const copy = () => {
    void navigator.clipboard?.writeText(publicUrl).catch(() => {})
    setCopied(true)
  }

  const change = async () => {
    setBusy(true)
    setApiError(await onChangeSlug(slug))
    setBusy(false)
  }

  return (
    <CartaCard id="carta-publicacion" number={1} title="Publicación" description="Quién puede ver la carta y en qué enlace.">
      <SwitchRow title="Carta pública activa" description="Si la apagas, el enlace y los QR muestran “Volvemos pronto”.">
        <Switch aria-label="Carta pública activa" checked={draft.published} onCheckedChange={(published) => update({ published })} />
      </SwitchRow>

      <div className="space-y-1.5">
        <p className="text-sm font-medium leading-none">Enlace de tu carta</p>
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2 sm:flex-row sm:items-center">
          <span className="min-w-0 flex-1 truncate px-1 font-mono text-sm">{publicUrl}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Copiar
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Abrir
              </a>
            </Button>
          </div>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {copied ? "Enlace copiado." : ""}
        </p>
      </div>

      <Field
        id="carta-slug"
        label="Nombre en el enlace"
        error={error}
        hint="Minúsculas y números separados por guiones. Prueba “la-parrilla”."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-sm text-muted-foreground">/c/</span>
            <input
              id="carta-slug"
              value={slug}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy("carta-slug", error)}
              onChange={(event) => {
                setSlug(event.target.value)
                setApiError(null)
              }}
              className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base outline-none md:text-sm"
            />
          </div>
          <Button type="button" variant="outline" disabled={!canChange} onClick={() => setConfirming(true)}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cambiar enlace
          </Button>
        </div>
      </Field>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Cambiar el enlace de tu carta?"
        description={
          <>
            Los QR impresos y los enlaces que compartiste con <code className="whitespace-nowrap">/c/{restaurant.slug}</code> dejarán de
            funcionar. Tendrás que imprimir y pegar los QR nuevos en las mesas.
          </>
        }
        confirmLabel="Sí, cambiar enlace"
        onConfirm={() => void change()}
      />
    </CartaCard>
  )
}

// ---------------------------------------------------------------------------

/** Artboard 02 swatches. */
export const BRAND_SWATCHES = [
  { color: "#9a3412", name: "Terracota" },
  { color: "#b91c1c", name: "Rojo" },
  { color: "#166534", name: "Verde" },
  { color: "#1e3a8a", name: "Azul" },
  { color: "#7c3aed", name: "Violeta" },
  { color: "#fde047", name: "Amarillo" },
] as const

function AssetField({
  kind,
  label,
  hint,
  url,
  fallback,
  onUploaded,
  onClear,
}: {
  kind: CartaAssetKind
  label: string
  hint: string
  url: string | null
  fallback: ReactNode
  onUploaded: (url: string) => void
  onClear: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = `carta-${kind}`
  const action = kind === "logo" ? "Subir logo" : "Subir portada"

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onUploaded(await uploadCartaAsset(kind, file))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo subir la imagen")
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium leading-none">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-sm font-semibold",
            kind === "logo" ? "h-16 w-16" : "h-16 w-40",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- bucket URL of any host, small preview */}
          {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : fallback}
        </div>
        <label
          htmlFor={id}
          className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {action}
          <input
            ref={input}
            id={id}
            type="file"
            accept={CARTA_IMAGE_TYPES.join(",")}
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>
        {url && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Quitar
          </Button>
        )}
      </div>
      <p className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</p>
    </div>
  )
}

export function IdentityCard({ draft, update, errorOf, restaurantName }: SettingsCardProps & { restaurantName: string }) {
  const color = draft.brandColor ?? DEFAULT_BRAND
  const aa = brandHint(color)
  const descriptionError = errorOf("description")
  const brandError = errorOf("brandColor")

  return (
    <CartaCard id="carta-identidad" number={2} title="Identidad" description="Un solo estilo elegante. Solo eliges logo, portada y color.">
      <div className="grid gap-5 md:grid-cols-2">
        <AssetField
          kind="logo"
          label="Logo (cuadrado)"
          hint={errorOf("logoUrl") ?? "PNG, JPG o WebP de 512 × 512. Sin logo usamos tus iniciales."}
          url={draft.logoUrl}
          fallback={<span aria-hidden="true">{initials(restaurantName)}</span>}
          onUploaded={(logoUrl) => update({ logoUrl })}
          onClear={() => update({ logoUrl: null })}
        />
        <AssetField
          kind="cover"
          label="Portada"
          hint={errorOf("coverUrl") ?? "Horizontal, 1600 × 600. Una foto del local o tu plato estrella."}
          url={draft.coverUrl}
          fallback={null}
          onUploaded={(coverUrl) => update({ coverUrl })}
          onClear={() => update({ coverUrl: null })}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium leading-none">Color de marca</p>
        <div className="flex flex-wrap items-center gap-2">
          {BRAND_SWATCHES.map((swatch) => (
            <button
              key={swatch.color}
              type="button"
              aria-label={swatch.name}
              aria-pressed={color === swatch.color}
              onClick={() => update({ brandColor: swatch.color })}
              style={{ backgroundColor: swatch.color }}
              className={cn(
                "h-9 w-9 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                color === swatch.color ? "border-foreground" : "border-transparent",
              )}
            />
          ))}
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-2 text-sm">
            <input
              type="color"
              aria-label="Otro color"
              value={color}
              onChange={(event) => update({ brandColor: event.target.value })}
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
            Otro color
          </label>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
          <StaticChip tone={aa.adjusted ? "warn" : "ok"}>{aa.adjusted ? "Ajustado" : "AA"}</StaticChip>
          <span>{aa.message}</span>
        </p>
        {brandError && <p className="text-sm text-destructive">{brandError}</p>}
      </div>

      <Field
        id="carta-description"
        label="Descripción corta"
        error={descriptionError}
        aside={
          <span className="text-xs text-muted-foreground">
            {(draft.description ?? "").length} / {DESCRIPTION_MAX}
          </span>
        }
      >
        <Textarea
          id="carta-description"
          rows={2}
          value={draft.description ?? ""}
          aria-invalid={Boolean(descriptionError)}
          aria-describedby={descriptionError ? "carta-description-error" : undefined}
          onChange={(event) => update({ description: event.target.value })}
        />
      </Field>
    </CartaCard>
  )
}

// ---------------------------------------------------------------------------

function TextField({
  field,
  label,
  hint,
  prefix,
  inputMode,
  placeholder,
  draft,
  update,
  errorOf,
}: SettingsCardProps & {
  field: "instagram" | "tiktok" | "whatsapp" | "mapsUrl" | "googleReviewUrl"
  label: string
  hint?: string
  prefix?: string
  inputMode?: "numeric" | "url"
  placeholder?: string
}) {
  const id = `carta-${field}`
  const error = errorOf(field)
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
        {prefix && <span className="pl-3 text-sm text-muted-foreground">{prefix}</span>}
        <input
          id={id}
          value={draft[field] ?? ""}
          inputMode={inputMode}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? describedBy(id, error) : undefined}
          onChange={(event) => update({ [field]: event.target.value })}
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-base outline-none md:text-sm"
        />
      </div>
    </Field>
  )
}

export function ContactCard(props: SettingsCardProps) {
  return (
    <CartaCard id="carta-redes" number={3} title="Redes y contacto" description="Solo aparecen en la carta los que llenes.">
      <div className="grid gap-5 md:grid-cols-2">
        <TextField {...props} field="instagram" label="Instagram" prefix="@" placeholder="turestaurante" />
        <TextField {...props} field="tiktok" label="TikTok" prefix="@" placeholder="turestaurante" />
        <TextField
          {...props}
          field="whatsapp"
          label="WhatsApp"
          prefix="+"
          inputMode="numeric"
          placeholder="573104567890"
          hint="Solo dígitos, con el indicativo del país (57 para Colombia)."
        />
        <TextField {...props} field="mapsUrl" label="Google Maps" inputMode="url" placeholder="https://maps.app.goo.gl/…" />
      </div>
      <TextField
        {...props}
        field="googleReviewUrl"
        label="Enlace para reseñas en Google"
        inputMode="url"
        placeholder="https://g.page/r/…"
        hint="Al pagar, la carta invita a dejar una reseña con este enlace."
      />
    </CartaCard>
  )
}

// ---------------------------------------------------------------------------

const DAYS = [
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miércoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sábado"],
  [7, "Domingo"],
] as const

const DEFAULT_DAY: CartaOpeningDay = { opens: "08:00", closes: "22:00" }

export function OpeningHoursEditor({ draft, update, errorOf }: SettingsCardProps) {
  const hours = draft.openingHours
  const error = errorOf("openingHours")

  const setDay = (day: keyof CartaOpeningHours, value: CartaOpeningDay | null) => {
    if (!hours) return
    update({ openingHours: { ...hours, [day]: value } })
  }

  if (!hours) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium leading-none">Horario de atención</p>
        <p className="text-sm text-muted-foreground">Sin horario: la carta se muestra siempre abierta.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            update({
              openingHours: { 1: DEFAULT_DAY, 2: DEFAULT_DAY, 3: DEFAULT_DAY, 4: DEFAULT_DAY, 5: DEFAULT_DAY, 6: DEFAULT_DAY, 7: DEFAULT_DAY },
            })
          }
        >
          Configurar horario
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium leading-none">Horario de atención</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => update({ openingHours: null })}>
          Quitar horario
        </Button>
      </div>
      <div className="rounded-md border text-sm">
        {/* Below sm each day stacks: day + Abierto on one line, Abre/Cierra below (no horizontal scroll at 390 px). */}
        <div aria-hidden="true" className="hidden grid-cols-[7rem_auto_auto_minmax(0,1fr)] gap-x-3 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Día</span>
          <span className="w-32">Abre</span>
          <span className="w-32">Cierra</span>
          <span className="text-right">Abierto</span>
        </div>
        <ul className="divide-y">
          {DAYS.map(([day, name]) => {
            const value = hours[day]
            return (
              <li
                key={day}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[7rem_auto_auto_minmax(0,1fr)]"
              >
                <span className="self-center font-medium">{name}</span>
                <div className="flex justify-end sm:order-last">
                  <Switch
                    aria-label={`Abierto el ${name}`}
                    checked={Boolean(value)}
                    onCheckedChange={(open) => setDay(day, open ? DEFAULT_DAY : null)}
                  />
                </div>
                {value ? (
                  <div className="col-span-2 flex flex-wrap items-start gap-3 sm:contents">
                    <input
                      type="time"
                      aria-label={`Abre el ${name}`}
                      value={value.opens}
                      onChange={(event) => setDay(day, { ...value, opens: event.target.value })}
                      className={cn(inputClass, "h-9 w-32")}
                    />
                    <div>
                      <input
                        type="time"
                        aria-label={`Cierra el ${name}`}
                        value={value.closes}
                        onChange={(event) => setDay(day, { ...value, closes: event.target.value })}
                        className={cn(inputClass, "h-9 w-32")}
                      />
                      {closesAfterMidnight(value) && (
                        <span className="mt-1 block text-xs text-muted-foreground">Cierra al día siguiente</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="col-span-2 text-muted-foreground sm:self-center">Cerrado</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function OrderingCard({
  draft,
  update,
  restaurantName,
  deliveryFee,
  onOpenDeliverySettings,
}: SettingsCardProps & { restaurantName: string; deliveryFee: number; onOpenDeliverySettings: () => void }) {
  return (
    <CartaCard id="carta-pedidos" number={5} title="Pedidos" description="Cómo piden tus comensales desde la carta.">
      <SwitchRow
        title="Pedidos desde la mesa (QR)"
        description="Solo cuando la mesa está abierta. El mesero confirma el pedido antes de que llegue a cocina."
      >
        <Switch
          aria-label="Pedidos desde la mesa (QR)"
          checked={draft.tableOrderingEnabled}
          onCheckedChange={(tableOrderingEnabled) => update({ tableOrderingEnabled })}
        />
      </SwitchRow>
      <SwitchRow title="Pedidos a domicilio en línea" description="El cliente deja nombre y teléfono y paga al recibir.">
        <Switch
          aria-label="Pedidos a domicilio en línea"
          checked={draft.deliveryOrderingEnabled}
          onCheckedChange={(deliveryOrderingEnabled) => update({ deliveryOrderingEnabled })}
        />
      </SwitchRow>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span>Valor del domicilio {formatCop(deliveryFee)}</span>
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onOpenDeliverySettings}>
          Cambiar en Ajustes · Domicilios
        </Button>
      </div>
      {!draft.deliveryOrderingEnabled && (
        <p className="text-sm text-muted-foreground">
          Con el domicilio en línea apagado, el botón “Pedir” abre WhatsApp con el pedido ya escrito: “Hola {restaurantName}, quiero
          pedir: …”.
        </p>
      )}
      <SwitchRow
        title="Mostrar la cuenta de la mesa a los comensales (informativa)"
        description="Ven lo pedido y el total; pagan con el mesero."
      >
        <Switch
          aria-label="Mostrar la cuenta de la mesa a los comensales"
          checked={draft.showTableBill}
          onCheckedChange={(showTableBill) => update({ showTableBill })}
        />
      </SwitchRow>
    </CartaCard>
  )
}
