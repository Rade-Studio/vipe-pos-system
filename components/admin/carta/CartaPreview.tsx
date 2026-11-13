"use client"

import { useMemo } from "react"
import { CartaHero } from "@/components/carta/CartaHero"
import type { CartaAdminRestaurant, CartaAdminSettings } from "@/lib/api/carta-admin"
import { brandCss, brandPalette } from "@/lib/carta/brand"
import { STRINGS } from "@/lib/carta/i18n"
import type { Carta } from "@/lib/carta/types"

const PREVIEW_SCOPE = ".carta-admin-preview"

/** Live phone preview (≥ 1024 px): the guest carta's own hero with the draft. */
export function CartaPreview({
  restaurant,
  settings,
  deliveryFee,
}: {
  restaurant: CartaAdminRestaurant
  settings: CartaAdminSettings
  deliveryFee: number
}) {
  const css = useMemo(() => brandCss(brandPalette(settings.brandColor), PREVIEW_SCOPE), [settings.brandColor])
  // The guest settings are the admin ones without `published`.
  const { published, ...guestSettings } = settings
  const carta: Carta = {
    lang: "es",
    channel: settings.deliveryOrderingEnabled ? "delivery" : "dine_in",
    restaurant: { name: restaurant.name, slug: restaurant.slug, currency: "COP" },
    settings: guestSettings,
    isOpenNow: true,
    closesAt: null,
    nextOpening: null,
    currentDaypartId: null,
    dayparts: [],
    menu: { categories: [], uncategorized: [] },
    deliveryFee,
    tipPercentage: 0,
  }

  return (
    <aside aria-label="Vista previa en vivo" className="sticky top-[4.5rem] space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Vista previa en vivo</p>
      <style>{css}</style>
      <div className="carta-admin-preview mx-auto w-[340px] overflow-hidden rounded-[28px] border-[6px] border-foreground/80 bg-canvas text-fg">
        {published ? (
          <CartaHero carta={carta} t={STRINGS.es} onToggleLang={null} onShare={() => {}} />
        ) : (
          <div className="grid h-64 place-items-center p-6 text-center">
            <div>
              <p className="font-semibold">Volvemos pronto</p>
              <p className="text-sm text-muted-fg">La carta no está publicada.</p>
            </div>
          </div>
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted-fg">
          {settings.tableOrderingEnabled
            ? "Mesa 4 · Tu pedido lo confirma el mesero"
            : settings.deliveryOrderingEnabled
              ? "Pide a domicilio · Pagas al recibir"
              : "Para pedir, escríbenos por WhatsApp"}
        </p>
      </div>
    </aside>
  )
}
