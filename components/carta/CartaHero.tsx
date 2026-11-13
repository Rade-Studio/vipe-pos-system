"use client"

import Image from "next/image"
import { formatCop, initials } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { statusChip } from "@/lib/carta/menu"
import { instagramHref, tiktokHref, whatsappHref } from "@/lib/carta/share"
import type { Carta } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { InstagramIcon, MapIcon, ShareIcon, TiktokIcon, WhatsappIcon } from "./icons"
import { BRAND_FILL, CHIP, FOCUS, TONES } from "./styles"

/** Artboard 01 hero (S4): cover, logo, name, chips, social links, share. */
export function CartaHero({
  carta,
  t,
  onToggleLang,
  onShare,
}: {
  carta: Carta
  t: CartaStrings
  onToggleLang: (() => void) | null
  onShare: () => void
}) {
  const { restaurant, settings } = carta
  const status = statusChip(carta, t)
  const social = [
    settings.instagram && { href: instagramHref(settings.instagram), label: t.instagram(settings.instagram), Icon: InstagramIcon },
    settings.tiktok && { href: tiktokHref(settings.tiktok), label: t.tiktok(settings.tiktok), Icon: TiktokIcon },
    settings.whatsapp && { href: whatsappHref(settings.whatsapp), label: t.whatsapp, Icon: WhatsappIcon },
    settings.mapsUrl && { href: settings.mapsUrl, label: t.maps, Icon: MapIcon },
  ].filter((s): s is { href: string; label: string; Icon: typeof MapIcon } => Boolean(s))

  return (
    <header>
      <div
        className="relative h-32 md:h-48 lg:h-64 lg:overflow-hidden lg:rounded-b-card-lg bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand)_35%,var(--brand-line)_100%)]"
      >
        {settings.coverUrl && <Image src={settings.coverUrl} alt="" fill priority sizes="(min-width: 1024px) 1152px, (min-width: 768px) 768px, 480px" className="object-cover" />}
        {onToggleLang && (
          <button
            type="button"
            onClick={onToggleLang}
            aria-label={t.switchLang}
            className={cn(
              "absolute right-2.5 top-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill bg-black/55 px-3 text-[12.5px] font-semibold text-white",
              FOCUS,
            )}
          >
            {t.langShort}
          </button>
        )}
      </div>
      <section aria-labelledby="carta-name" className="relative -mt-9 px-[18px] pb-1 md:-mt-12 md:px-6">
        <div
          className={cn(
            "relative grid h-[72px] w-[72px] md:h-24 md:w-24 md:text-[28px] place-items-center overflow-hidden rounded-[22px] border-4 border-canvas text-[22px] font-bold tracking-tight",
            BRAND_FILL,
          )}
        >
          {settings.logoUrl ? (
            <Image src={settings.logoUrl} alt="" fill sizes="96px" className="object-cover" />
          ) : (
            <span aria-hidden="true">{initials(restaurant.name)}</span>
          )}
        </div>
        <h1 id="carta-name" className="mt-2.5 text-[26px] md:text-[34px] font-semibold leading-tight tracking-tight">
          {restaurant.name}
        </h1>
        {settings.description && <p className="mt-1 text-[13.5px] text-muted-fg md:max-w-2xl md:text-[15px]">{settings.description}</p>}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className={cn(CHIP, status.open ? TONES.ok : TONES.reserved)}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {status.label}
          </span>
          {carta.table ? (
            <span className={cn(CHIP, "border-line-strong text-fg-2")}>{t.table(carta.table.number, carta.table.zoneName)}</span>
          ) : (
            <>
              <span className={cn(CHIP, "border-line-strong text-fg-2")}>{t.delivery}</span>
              {carta.deliveryFee > 0 && (
                <span className={cn(CHIP, "border-line-strong text-fg-2")}>{t.fee(formatCop(carta.deliveryFee))}</span>
              )}
            </>
          )}
        </div>
        <div className="mt-3.5 flex gap-2">
          {social.length > 0 && (
            <ul aria-label={t.social} className="flex gap-2">
              {social.map(({ href, label, Icon }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className={cn("grid h-11 w-11 place-items-center rounded-[14px] border border-line-strong bg-surface text-fg-2", FOCUS)}
                  >
                    <Icon />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onShare}
            className={cn(
              "ml-auto inline-flex h-11 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-3 text-[13px] font-semibold",
              FOCUS,
            )}
          >
            <ShareIcon />
            {t.share}
          </button>
        </div>
      </section>
    </header>
  )
}
