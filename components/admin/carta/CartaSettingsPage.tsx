"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  DESCRIPTION_MAX,
  fieldOfError,
  getCartaAdmin,
  guestUrl,
  handleHint,
  httpsHint,
  normalizeSettings,
  saveCartaSettings,
  saveDishDetails,
  slugError,
  updateSlug,
  whatsappHint,
  type CartaAdmin,
  type CartaAdminSettings,
  type CartaDishDetails,
  type SettingsField,
} from "@/lib/api/carta-admin"
import { ApiError } from "@/lib/api/errors"
import { CartaPreview } from "./CartaPreview"
import { DaypartsEditor } from "./DaypartsEditor"
import { DishesCard, LanguagesCard } from "./DishCards"
import { CartaCard, StaticChip, useMinWidth } from "./parts"
import { QrCard } from "./QrCard"
import { ContactCard, IdentityCard, OpeningHoursEditor, OrderingCard, PublicationCard } from "./SettingsCards"

const INDEX = [
  ["carta-publicacion", "Publicación"],
  ["carta-identidad", "Identidad"],
  ["carta-redes", "Redes y contacto"],
  ["carta-horarios", "Horarios y franjas"],
  ["carta-pedidos", "Pedidos"],
  ["carta-platos", "Platos y etiquetas"],
  ["carta-idiomas", "Idiomas"],
  ["carta-qr", "QR de las mesas"],
] as const

const detailsOf = (dish: CartaAdmin["dishes"][number]): CartaDishDetails => ({
  tags: dish.tags,
  descriptionEn: dish.descriptionEn,
  descriptionEnReviewed: dish.descriptionEnReviewed,
})

/** What the form refuses before a request (the API's own words). */
function clientErrors(settings: CartaAdminSettings): Partial<Record<SettingsField, string>> {
  const errors: Partial<Record<SettingsField, string | null>> = {
    description:
      (settings.description ?? "").trim().length > DESCRIPTION_MAX ? "La descripción corta admite hasta 160 caracteres." : null,
    instagram: handleHint(settings.instagram, "Instagram"),
    tiktok: handleHint(settings.tiktok, "TikTok"),
    whatsapp: whatsappHint(settings.whatsapp?.trim() ?? null),
    mapsUrl: httpsHint(settings.mapsUrl, "Google Maps"),
    googleReviewUrl: httpsHint(settings.googleReviewUrl, "reseñas"),
  }
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as Partial<Record<SettingsField, string>>
}

/**
 * Ajustes · Carta digital (T8, S17; artboard design/carta-digital/02-admin-carta.html).
 * The settings form (publication, identity, contact, hours, ordering, English
 * switch) saves through the sticky bar; dayparts, each dish, the slug and the
 * QR tokens save on their own, as their API routes do.
 */
export function CartaSettingsPage({ onNavigate }: { onNavigate?: (sectionId: string) => void }) {
  const { toast } = useToast()
  const wide = useMinWidth(1024)
  const [data, setData] = useState<CartaAdmin | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saved, setSaved] = useState<CartaAdminSettings | null>(null)
  const [draft, setDraft] = useState<CartaAdminSettings | null>(null)
  const [apiErrors, setApiErrors] = useState<Partial<Record<SettingsField, string>>>({})
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dishSaved, setDishSaved] = useState<Record<string, CartaDishDetails>>({})
  const [dishDrafts, setDishDrafts] = useState<Record<string, CartaDishDetails>>({})
  const [savingDish, setSavingDish] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  const load = async () => {
    setLoadFailed(false)
    try {
      const next = await getCartaAdmin()
      const details = Object.fromEntries(next.dishes.map((dish) => [dish.id, detailsOf(dish)]))
      setData(next)
      setSaved(next.settings)
      setDraft(next.settings)
      setDishSaved(details)
      setDishDrafts(details)
    } catch {
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
  }, [])

  const hints = useMemo(() => (draft ? clientErrors(draft) : {}), [draft])
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const dirtyDishes = useMemo(
    () => new Set(Object.keys(dishDrafts).filter((id) => JSON.stringify(dishDrafts[id]) !== JSON.stringify(dishSaved[id]))),
    [dishDrafts, dishSaved],
  )

  if (loadFailed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Carta digital" />
        <EmptyState
          title="No se pudo cargar la carta"
          description="Revisa tu conexión e intenta de nuevo."
          action={<Button onClick={() => void load()}>Reintentar</Button>}
        />
      </div>
    )
  }

  if (!data || !draft || !saved) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando la carta…
      </div>
    )
  }

  const update = (patch: Partial<CartaAdminSettings>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setFormMessage(null)
    setApiErrors((errors) => {
      const next = { ...errors }
      for (const key of Object.keys(patch) as SettingsField[]) delete next[key]
      return next
    })
  }

  const errorOf = (field: SettingsField) => apiErrors[field] ?? hints[field] ?? null

  const save = async () => {
    if (Object.keys(hints).length > 0) {
      setFormMessage("Revisa los campos marcados.")
      return
    }
    setSaving(true)
    try {
      const next = await saveCartaSettings(draft)
      // The API answers with what it stored (trimmed, lower-case color).
      setSaved(next)
      setDraft(next)
      setFormMessage(null)
      toast({ title: "Cambios guardados" })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "No se pudieron guardar los cambios. Intenta de nuevo."
      const field = error instanceof ApiError && error.status === 422 ? fieldOfError(message) : null
      if (field) {
        setApiErrors({ [field]: message })
        setFormMessage("Revisa los campos marcados.")
      } else {
        setFormMessage(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setDraft(saved)
    setApiErrors({})
    setFormMessage(null)
  }

  const changeSlug = async (slug: string): Promise<string | null> => {
    try {
      await updateSlug(slug)
    } catch (error) {
      return slugError(error)
    }
    // The table links follow the slug: re-read them, keep the unsaved form.
    try {
      const next = await getCartaAdmin()
      setData((current) => (current ? { ...current, restaurant: next.restaurant, tables: next.tables } : current))
    } catch {
      setData((current) => (current ? { ...current, restaurant: { ...current.restaurant, slug, publicPath: `/c/${slug}` } } : current))
    }
    toast({ title: "Enlace cambiado", description: "Imprime los QR nuevos de las mesas." })
    return null
  }

  const changeDish = (dishId: string, patch: Partial<CartaDishDetails>) =>
    setDishDrafts((drafts) => ({ ...drafts, [dishId]: { ...drafts[dishId], ...patch } }))

  const saveDish = async (dishId: string) => {
    setSavingDish(dishId)
    try {
      const stored = await saveDishDetails(dishId, dishDrafts[dishId])
      const details = { tags: stored.tags, descriptionEn: stored.descriptionEn, descriptionEnReviewed: stored.descriptionEnReviewed }
      setDishSaved((all) => ({ ...all, [dishId]: details }))
      setDishDrafts((all) => ({ ...all, [dishId]: details }))
      toast({ title: "Plato guardado" })
    } catch (error) {
      toast({
        title: "No se pudo guardar el plato",
        description: error instanceof ApiError ? error.message : "Intenta de nuevo.",
        variant: "destructive",
      })
    } finally {
      setSavingDish(null)
    }
  }

  const cardProps = { draft, update, errorOf }
  const dishProps = { dishes: data.dishes, drafts: dishDrafts, dirtyIds: dirtyDishes, savingId: savingDish, onChange: changeDish, onSave: (id: string) => void saveDish(id) }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carta digital"
        description="Tu carta pública con un solo estilo cuidado. Tú pones la marca; nosotros nos encargamos de que se vea y se lea bien en cualquier celular."
        actions={<StaticChip tone={saved.published ? "ok" : "warn"}>● {saved.published ? "Publicada" : "No publicada"}</StaticChip>}
      />

      <nav aria-label="Secciones de la carta" className="flex gap-2 overflow-x-auto pb-1">
        {INDEX.map(([id, label], index) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(event) => {
              // The admin route lives in the hash: scroll instead of navigating.
              event.preventDefault()
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <PublicationCard
            {...cardProps}
            restaurant={data.restaurant}
            publicUrl={guestUrl(origin, data.restaurant.publicPath)}
            onChangeSlug={changeSlug}
          />
          <IdentityCard {...cardProps} restaurantName={data.restaurant.name} />
          <ContactCard {...cardProps} />
          <CartaCard id="carta-horarios" number={4} title="Horarios y franjas" description="La carta muestra lo que sirves a cada hora.">
            <OpeningHoursEditor {...cardProps} />
            <DaypartsEditor
              dayparts={data.dayparts}
              categories={data.categories}
              dishes={data.dishes}
              onSaved={(dayparts) => setData((current) => (current ? { ...current, dayparts } : current))}
            />
          </CartaCard>
          <OrderingCard
            {...cardProps}
            restaurantName={data.restaurant.name}
            deliveryFee={data.deliveryDefaultFee}
            onOpenDeliverySettings={() => onNavigate?.("settings/delivery")}
          />
          <DishesCard {...dishProps} />
          <LanguagesCard {...dishProps} englishEnabled={draft.englishEnabled} onEnglishEnabled={(englishEnabled) => update({ englishEnabled })} />
          <QrCard
            tables={data.tables}
            origin={origin}
            onTables={(tables) => setData((current) => (current ? { ...current, tables } : current))}
          />
        </div>
        {wide && (
          <div className="hidden lg:block">
            <CartaPreview restaurant={data.restaurant} settings={normalizeSettings(draft)} deliveryFee={data.deliveryDefaultFee} />
          </div>
        )}
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} message={formMessage ?? "Cambios sin guardar"} />
    </div>
  )
}
