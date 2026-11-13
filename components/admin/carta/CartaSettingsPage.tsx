"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { SaveBar } from "@/components/admin/common/SaveBar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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

const TABS = [
  ["publicacion", "Publicación"],
  ["marca", "Marca"],
  ["horarios", "Horarios"],
  ["pedidos", "Pedidos y platos"],
  ["idiomas", "Idiomas"],
  ["qr", "QR"],
] as const
type Tab = (typeof TABS)[number][0]
const tabId = (tab: Tab) => `carta-tab-${tab}`
const panelId = (tab: Tab) => `carta-panel-${tab}`

/** The settings fields each tab edits, for its unsaved-changes dot. */
const TAB_FIELDS: Record<Tab, (keyof CartaAdminSettings)[]> = {
  publicacion: ["published"],
  marca: ["description", "brandColor", "logoUrl", "coverUrl", "instagram", "tiktok", "whatsapp", "mapsUrl", "googleReviewUrl"],
  horarios: ["openingHours"],
  pedidos: ["tableOrderingEnabled", "deliveryOrderingEnabled", "showTableBill"],
  idiomas: ["englishEnabled"],
  qr: [],
}
const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)

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
  const [tab, setTab] = useState<Tab>("publicacion")
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

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

  // Which dishes differ in their tags, and which in their English text.
  const [dirtyTags, dirtyEnglish] = useMemo(() => {
    const tags = new Set<string>()
    const english = new Set<string>()
    for (const id of dirtyDishes) {
      const now = dishDrafts[id]
      const before = dishSaved[id]
      if (differs(now?.tags, before?.tags)) tags.add(id)
      if (differs(now?.descriptionEn, before?.descriptionEn) || differs(now?.descriptionEnReviewed, before?.descriptionEnReviewed)) english.add(id)
    }
    return [tags, english]
  }, [dirtyDishes, dishDrafts, dishSaved])

  const dirtyTabs = useMemo(() => {
    const tabs = new Set<Tab>()
    if (draft && saved) {
      for (const [t, fields] of Object.entries(TAB_FIELDS) as [Tab, (keyof CartaAdminSettings)[]][]) {
        if (fields.some((field) => differs(draft[field], saved[field]))) tabs.add(t)
      }
    }
    if (dirtyTags.size > 0) tabs.add("pedidos")
    if (dirtyEnglish.size > 0) tabs.add("idiomas")
    return tabs
  }, [draft, saved, dirtyTags, dirtyEnglish])

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

  const selectTab = (next: Tab, focus = false) => {
    setTab(next)
    if (focus) tabRefs.current[next]?.focus()
  }

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex(([t]) => t === tab)
    const j =
      event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null
    if (j === null) return
    event.preventDefault()
    selectTab(TABS[(j + TABS.length) % TABS.length][0], true)
  }

  // Every panel stays mounted (only hidden) so unsaved edits survive a tab switch.
  const panel = (t: Tab, children: ReactNode) => (
    <section key={t} role="tabpanel" id={panelId(t)} aria-labelledby={tabId(t)} hidden={tab !== t} tabIndex={-1} className="space-y-6">
      {children}
    </section>
  )

  const cardProps = { draft, update, errorOf }
  const dishProps = { dishes: data.dishes, categories: data.categories, drafts: dishDrafts, savingId: savingDish, onChange: changeDish, onSave: saveDish }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carta digital"
        description="Tu carta pública con un solo estilo cuidado. Tú pones la marca; nosotros nos encargamos de que se vea y se lea bien en cualquier celular."
        actions={<StaticChip tone={saved.published ? "ok" : "warn"}>● {saved.published ? "Publicada" : "No publicada"}</StaticChip>}
      />

      <div role="tablist" aria-label="Secciones de la carta" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={tab === t}
            aria-controls={panelId(t)}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => selectTab(t)}
            onKeyDown={onTabKey}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t && "border-primary text-foreground",
            )}
          >
            {label}
            {dirtyTabs.has(t) && (
              <span data-dirty-dot aria-hidden="true" title="Cambios sin guardar" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {panel(
            "publicacion",
            <>
              <PublicationCard
                {...cardProps}
                restaurant={data.restaurant}
                publicUrl={guestUrl(origin, data.restaurant.publicPath)}
                onChangeSlug={changeSlug}
              />
            </>,
          )}
          {panel(
            "marca",
            <>
              <IdentityCard {...cardProps} restaurantName={data.restaurant.name} />
              <ContactCard {...cardProps} />
            </>,
          )}
          {panel(
            "horarios",
            <CartaCard id="carta-horarios" title="Horarios y franjas" description="La carta muestra lo que sirves a cada hora.">
              <OpeningHoursEditor {...cardProps} />
              <DaypartsEditor
                dayparts={data.dayparts}
                categories={data.categories}
                dishes={data.dishes}
                onSaved={(dayparts) => setData((current) => (current ? { ...current, dayparts } : current))}
              />
            </CartaCard>,
          )}
          {panel(
            "pedidos",
            <>
              <OrderingCard
                {...cardProps}
                restaurantName={data.restaurant.name}
                deliveryFee={data.deliveryDefaultFee}
                onOpenDeliverySettings={() => onNavigate?.("settings/delivery")}
              />
              <DishesCard {...dishProps} dirtyIds={dirtyTags} />
            </>,
          )}
          {panel(
            "idiomas",
            <LanguagesCard
              {...dishProps}
              dirtyIds={dirtyEnglish}
              englishEnabled={draft.englishEnabled}
              onEnglishEnabled={(englishEnabled) => update({ englishEnabled })}
            />,
          )}
          {panel(
            "qr",
            <QrCard
              tables={data.tables}
              origin={origin}
              restaurantName={data.restaurant.name}
              onTables={(tables) => setData((current) => (current ? { ...current, tables } : current))}
            />,
          )}
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
