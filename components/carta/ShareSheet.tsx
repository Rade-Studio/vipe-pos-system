"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { toast } from "@/components/ui/use-toast"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { dishUnitPrice } from "@/lib/carta/menu"
import { shareUrl, whatsappShareHref } from "@/lib/carta/share"
import type { Carta, CartaDish, CartaLang } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { BottomSheet } from "./BottomSheet"
import { InstagramIcon, LinkIcon, WhatsappIcon } from "./icons"
import { FOCUS } from "./styles"

const OPTION = cn(
  "grid min-h-16 content-center justify-items-center gap-1 rounded-xl border border-line-strong bg-surface text-[12.5px] font-semibold",
  FOCUS,
)

/** Reads the dish photo as a file for the Web Share API; null when it cannot. */
async function photoFile(src: string | null | undefined): Promise<File | null> {
  if (!src) return null
  try {
    const blob = await (await fetch(src)).blob()
    return new File([blob], "plato.jpg", { type: blob.type || "image/jpeg" })
  } catch {
    return null
  }
}

/**
 * Share sheet (S9) for the whole carta or one dish: 9:16 preview, WhatsApp,
 * "Historia" through the Web Share API when the phone has it, and "Copiar
 * enlace". The link is built from the slug and the dish only (no table).
 */
export function ShareSheet({
  carta,
  dish,
  lang,
  t,
  onClose,
}: {
  carta: Carta
  dish: CartaDish | null
  lang: CartaLang
  t: CartaStrings
  onClose: () => void
}) {
  const [nativeShare, setNativeShare] = useState(false)
  const [origin, setOrigin] = useState("")
  useEffect(() => {
    setNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function")
    setOrigin(window.location.origin)
  }, [])

  const { restaurant, settings } = carta
  const url = shareUrl(origin, restaurant.slug, dish?.id)
  const title = dish ? `${dish.name} · ${restaurant.name}` : restaurant.name
  const photo = dish ? dish.imageUrl : settings.coverUrl

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: t.copied })
    } catch {
      toast({ title: t.copyFailed })
    }
    onClose()
  }

  const story = async () => {
    const data: ShareData = { title, text: dish ? `${t.orderHere}: ${title}` : title, url }
    const file = dish ? await photoFile(dish.imageUrl) : null
    if (file && navigator.canShare?.({ files: [file] })) data.files = [file]
    try {
      await navigator.share(data)
    } catch {
      // The guest closed the share panel.
    }
  }

  return (
    <BottomSheet open onOpenChange={(open) => !open && onClose()} title={dish ? t.shareDish : t.shareCarta} closeLabel={t.close} lang={lang}>
      <div
        aria-hidden="true"
        className="mx-auto grid aspect-[9/16] w-[200px] grid-rows-[55%_minmax(0,1fr)] overflow-hidden rounded-[18px] bg-[#09090b] text-white shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)]"
      >
        <div className="relative bg-[linear-gradient(135deg,var(--brand-story),#09090b)]">
          {photo && <Image src={photo} alt="" fill sizes="200px" className="object-cover" />}
        </div>
        <div className="grid content-between gap-1.5 bg-[linear-gradient(180deg,var(--brand-story),#09090b)] p-3">
          <div>
            <b className="block text-[17px] leading-tight">{dish ? dish.name : restaurant.name}</b>
            <small className="mt-1 block text-[11.5px] text-[#e4e4e7]">
              {dish ? formatCop(dishUnitPrice(dish)) : settings.description ?? restaurant.name}
            </small>
          </div>
          <span className="justify-self-start rounded-pill bg-white px-2.5 py-1 text-[11.5px] font-bold text-[#09090b]">
            {dish ? t.orderHere : t.seeCarta}
          </span>
        </div>
      </div>
      <p className="text-center text-[13px] text-muted-fg">{t.shareHint}</p>
      <div className={cn("grid gap-2", nativeShare ? "grid-cols-3" : "grid-cols-2")}>
        <a href={whatsappShareHref(title, url)} target="_blank" rel="noopener noreferrer" className={OPTION}>
          <WhatsappIcon />
          WhatsApp
        </a>
        {nativeShare && (
          <button type="button" onClick={story} className={OPTION}>
            <InstagramIcon />
            {t.story}
          </button>
        )}
        <button type="button" onClick={copy} className={OPTION}>
          <LinkIcon />
          {t.copy}
        </button>
      </div>
      <p className="break-all rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-xs text-fg-2">{url}</p>
      {carta.table && <p className="text-center text-[13px] text-muted-fg">{t.noTable}</p>}
    </BottomSheet>
  )
}
