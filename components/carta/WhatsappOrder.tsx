"use client"

import { cartTotal, type CartAction, type CartLine } from "@/lib/carta/cart"
import { whatsappOrderHref, whatsappOrderText } from "@/lib/carta/delivery"
import type { CartaStrings } from "@/lib/carta/i18n"
import type { Carta } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { CartLines } from "./CartLines"
import { DeliveryHeader, EmptyCart } from "./DeliveryCheckout"
import { InfoNote } from "./MyOrder"
import { BRAND_FILL, CTA, FOCUS } from "./styles"

/**
 * "Pedido" with online delivery off (S16): the cart composes a message to the
 * restaurant's WhatsApp and opens it; VIPE receives nothing.
 */
export function WhatsappOrder({
  carta,
  whatsapp,
  lines,
  dispatch,
  t,
  onBrowse,
}: {
  carta: Carta
  whatsapp: string
  lines: CartLine[]
  dispatch: (action: CartAction) => void
  t: CartaStrings
  onBrowse: () => void
}) {
  const text = whatsappOrderText(carta.restaurant.name, lines, cartTotal(lines) + carta.deliveryFee)
  return (
    <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
      <DeliveryHeader t={t} />
      {lines.length === 0 ? (
        <EmptyCart t={t} onBrowse={onBrowse} />
      ) : (
        <>
          <CartLines lines={lines} dispatch={dispatch} t={t} />
          <InfoNote>{t.whatsappInfo}</InfoNote>
          <figure className="grid gap-1.5 rounded-card border border-line bg-surface p-3.5">
            <figcaption className="text-[12.5px] text-muted-fg">{t.whatsappPreview}</figcaption>
            <p lang="es" className="whitespace-pre-line break-words rounded-xl bg-surface-2 p-3 text-[13.5px]">
              {text}
            </p>
          </figure>
          <a
            href={whatsappOrderHref(whatsapp, text)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(CTA, BRAND_FILL, FOCUS, "grid place-items-center text-center")}
          >
            {t.openWhatsapp}
          </a>
        </>
      )}
    </div>
  )
}
