"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { failureOf, fetchCarta } from "@/lib/carta/api"
import { brandCss, brandPalette } from "@/lib/carta/brand"
import { cartCount, orderingMode } from "@/lib/carta/cart"
import { STRINGS, TRANSLATION_FOOTER } from "@/lib/carta/i18n"
import { canAddNow, daypartName, defaultDaypartId, findDish, hasRequiredModifiers, dishUnitPrice } from "@/lib/carta/menu"
import type { Carta, CartaDish, CartaLang } from "@/lib/carta/types"
import { useCartaCart } from "@/lib/carta/use-cart"
import { cn } from "@/lib/utils"
import { CartaHero } from "./CartaHero"
import { CartaMenu } from "./CartaMenu"
import { CartaFailureView, CartaSkeleton } from "./CartaStates"
import { DishSheet } from "./DishSheet"
import { ListIcon, MenuIcon } from "./icons"
import { MyList } from "./MyList"
import { ShareSheet } from "./ShareSheet"
import { BRAND_FILL, BRAND_TEXT, FOCUS } from "./styles"

type Sheet = { kind: "dish"; dishId: string } | { kind: "share"; dishId: string | null } | null

/**
 * The guest carta (`/c/<slug>` and `/c/<slug>/m/<token>`), artboard 01.
 * Fetched from the browser (A2); the first load lets the API pick the
 * language from the phone, the EN/ES switch asks for `?lang=`.
 */
export function CartaPage({ slug, token }: { slug: string; token?: string }) {
  const [lang, setLang] = useState<CartaLang | undefined>(undefined)
  const query = useQuery({
    queryKey: ["carta", slug, token ?? null, lang ?? "auto"],
    queryFn: () => fetchCarta({ slug, token, lang }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  if (query.data) {
    return <CartaView carta={query.data} slug={slug} onLang={setLang} />
  }
  const t = STRINGS[lang ?? "es"]
  if (query.isError) {
    return <CartaFailureView failure={failureOf(query.error)} t={t} onRetry={() => void query.refetch()} />
  }
  return <CartaSkeleton t={t} />
}

function CartaView({ carta, slug, onLang }: { carta: Carta; slug: string; onLang: (lang: CartaLang) => void }) {
  const lang = carta.lang
  const t = STRINGS[lang]
  const { lines, dispatch } = useCartaCart(slug)
  const [tab, setTab] = useState<"menu" | "list">("menu")
  const [viewedId, setViewedId] = useState<string | null>(null)
  const [sheet, setSheetState] = useState<Sheet>(null)
  // The control that opened the first sheet gets the focus back when the last
  // one closes (Escape, scrim, ×, add), also after dish → share.
  const opener = useRef<HTMLElement | null>(null)
  const setSheet = (next: Sheet) => {
    if (next && !sheet && document.activeElement instanceof HTMLElement) opener.current = document.activeElement
    setSheetState(next)
  }
  useEffect(() => {
    if (sheet || !opener.current) return
    const target = opener.current
    opener.current = null
    // After Radix's own focus handling on unmount.
    const id = window.setTimeout(() => target.isConnected && target.focus(), 0)
    return () => window.clearTimeout(id)
  }, [sheet])
  const [announcement, setAnnouncement] = useState("")
  const css = useMemo(() => brandCss(brandPalette(carta.settings.brandColor)), [carta.settings.brandColor])

  // Phase 1 has one path: the local list. T5 branches on the mode here.
  const mode = orderingMode(carta)
  const viewedDaypartId = viewedId ?? defaultDaypartId(carta)
  const canAdd = canAddNow(carta, viewedDaypartId)
  const count = cartCount(lines)
  const viewed = carta.dayparts.find((d) => d.id === viewedDaypartId)

  const blockedLabel = (dish: CartaDish): string | null => {
    if (!dish.available) return t.soldOut
    if (!carta.isOpenNow) return t.closed
    if (!canAdd && viewed) return t.orderDuring(daypartName(viewed, lang))
    return canAdd ? null : t.closed
  }

  const addPlain = (dish: CartaDish) => {
    dispatch({ type: "add", line: { dishId: dish.id, name: dish.name, unitPrice: dishUnitPrice(dish), options: [], note: null } })
    setAnnouncement(t.added(dish.name))
  }

  const quickAdd = (dish: CartaDish) => {
    if (mode === "list" && lines.some((l) => l.dishId === dish.id)) {
      dispatch({ type: "removeDish", dishId: dish.id })
      setAnnouncement(t.removed(dish.name))
      return
    }
    if (hasRequiredModifiers(dish)) setSheet({ kind: "dish", dishId: dish.id })
    else addPlain(dish)
  }

  const sheetDish = sheet?.kind === "dish" ? findDish(carta, sheet.dishId) : undefined
  const shareDish = sheet?.kind === "share" && sheet.dishId ? findDish(carta, sheet.dishId) ?? null : null

  return (
    <div lang={lang} className="carta-root mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden bg-canvas text-fg">
      <style>{css}</style>
      {tab === "menu" ? (
        <>
          <CartaHero
            carta={carta}
            t={t}
            onToggleLang={carta.settings.englishEnabled ? () => onLang(lang === "es" ? "en" : "es") : null}
            onShare={() => setSheet({ kind: "share", dishId: null })}
          />
          <main id="carta-menu" className="pb-6">
            <CartaMenu
              carta={carta}
              lang={lang}
              t={t}
              viewedDaypartId={viewedDaypartId}
              onViewDaypart={setViewedId}
              canAdd={canAdd}
              lines={lines}
              onOpenDish={(d) => setSheet({ kind: "dish", dishId: d.id })}
              onQuickAdd={quickAdd}
            />
          </main>
          <footer className="grid gap-1 px-[18px] pb-36 pt-7 text-center text-xs text-muted-fg">
            <span>{t.pricesNote}</span>
            {lang === "en" && <span lang="en">{TRANSLATION_FOOTER}</span>}
            <span>{t.madeWith}</span>
          </footer>
        </>
      ) : (
        <main>
          <MyList lines={lines} dispatch={dispatch} t={t} onBrowse={() => setTab("menu")} />
        </main>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px]">
        {tab === "menu" && count > 0 && (
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => setTab("list")}
              className={cn(
                "flex min-h-[52px] w-full items-center justify-between gap-2.5 rounded-card px-4 text-[15px] font-semibold shadow-[0_16px_32px_-14px_rgba(0,0,0,0.6)]",
                BRAND_FILL,
                FOCUS,
              )}
            >
              <span>
                <span aria-hidden="true" className="mr-1.5 inline-grid h-[26px] min-w-[26px] place-items-center rounded-pill bg-white/20 px-1.5 text-[13px] tabular-nums dark:bg-black/15">
                  {count}
                </span>
                {t.seeList}
              </span>
            </button>
          </div>
        )}
        <nav aria-label={t.tabs} className="grid auto-cols-fr grid-flow-col border-t border-line bg-canvas px-1.5 pb-[max(6px,env(safe-area-inset-bottom))] pt-1">
          {(
            [
              ["menu", t.tabMenu, MenuIcon],
              ["list", t.tabList, ListIcon],
            ] as const
          ).map(([key, label, Icon]) => {
            const badge = key === "list" && count > 0
            return (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? "page" : undefined}
                aria-label={badge ? `${label} (${count})` : label}
                onClick={() => setTab(key)}
                className={cn(
                  "relative grid min-h-14 content-center justify-items-center gap-0.5 rounded-xl text-xs font-medium text-muted-fg",
                  tab === key && BRAND_TEXT,
                  FOCUS,
                )}
              >
                <Icon className="h-[22px] w-[22px]" />
                <span>{label}</span>
                {badge && (
                  <span aria-hidden="true" className={cn("absolute left-[calc(50%+6px)] top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-pill px-1 text-[11px] font-bold tabular-nums", BRAND_FILL)}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {sheetDish && (
        <DishSheet
          key={sheetDish.id}
          dish={sheetDish}
          lang={lang}
          t={t}
          blockedLabel={blockedLabel(sheetDish)}
          onClose={() => setSheet(null)}
          onShare={() => setSheet({ kind: "share", dishId: sheetDish.id })}
          onAdd={(choice) => {
            dispatch({ type: "add", line: { dishId: sheetDish.id, name: sheetDish.name, ...choice } })
            setAnnouncement(t.added(sheetDish.name))
            setSheet(null)
          }}
        />
      )}
      {sheet?.kind === "share" && <ShareSheet carta={carta} dish={shareDish} lang={lang} t={t} onClose={() => setSheet(null)} />}
    </div>
  )
}
