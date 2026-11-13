"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { failureOf, fetchCarta } from "@/lib/carta/api"
import { brandCss, brandPalette } from "@/lib/carta/brand"
import { cartCount, isOrdering, orderingMode } from "@/lib/carta/cart"
import { isTrackingDone, trackingPath } from "@/lib/carta/delivery"
import { STRINGS, TRANSLATION_FOOTER } from "@/lib/carta/i18n"
import { canAddNow, daypartName, defaultDaypartId, findDish, hasRequiredModifiers, dishUnitPrice } from "@/lib/carta/menu"
import type { Carta, CartaDish, CartaLang } from "@/lib/carta/types"
import { guestErrorMessage, sendFeedback, sendProposal, sendTableRequest, type TableRequestKind } from "@/lib/carta/table"
import { useCartaCart } from "@/lib/carta/use-cart"
import { useDeliveryStatus, useTrackingToken } from "@/lib/carta/use-delivery"
import { useTableBill, useTableStatus } from "@/lib/carta/use-table"
import { cn } from "@/lib/utils"
import { CartaHero } from "./CartaHero"
import { CartaMenu } from "./CartaMenu"
import { CartaFailureView, CartaSkeleton } from "./CartaStates"
import { DeliveryCheckout } from "./DeliveryCheckout"
import { DishSheet } from "./DishSheet"
import { BillIcon, ListIcon, MenuIcon } from "./icons"
import { MyList } from "./MyList"
import { CallWaiter, MyOrder } from "./MyOrder"
import { ShareSheet } from "./ShareSheet"
import { TableBill } from "./TableBill"
import { WhatsappOrder } from "./WhatsappOrder"
import { BRAND_FILL, BRAND_TEXT, FOCUS, TONES } from "./styles"

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
    return <CartaView carta={query.data} slug={slug} token={token} onLang={setLang} />
  }
  const t = STRINGS[lang ?? "es"]
  if (query.isError) {
    return <CartaFailureView failure={failureOf(query.error)} t={t} onRetry={() => void query.refetch()} />
  }
  return <CartaSkeleton t={t} />
}

function CartaView({
  carta,
  slug,
  token,
  onLang,
}: {
  carta: Carta
  slug: string
  token?: string
  onLang: (lang: CartaLang) => void
}) {
  const lang = carta.lang
  const t = STRINGS[lang]
  const { lines, dispatch } = useCartaCart(slug)
  const [tab, setTab] = useState<"menu" | "list" | "bill">("menu")
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

  // "list" keeps "Mi lista" on the phone (S11); "propose" sends "Mi pedido" to the waiter (S12);
  // "delivery" checks out to the delivery console (S15); "whatsapp" composes the message (S16).
  const mode = orderingMode(carta)
  const ordering = isOrdering(mode)
  const [trackingToken, rememberTracking] = useTrackingToken(slug)
  const lastDelivery = useDeliveryStatus(slug, carta.table ? null : trackingToken, false)
  const lastStage = lastDelivery.data?.stage
  const lastGone = lastDelivery.isError && failureOf(lastDelivery.error) === "not_found"
  useEffect(() => {
    // "Ver mi pedido" only while the last order is under way.
    if ((lastStage && isTrackingDone(lastStage)) || lastGone) rememberTracking(null)
  }, [lastStage, lastGone, rememberTracking])
  const showTracking = !!trackingToken && !!lastStage && !isTrackingDone(lastStage)
  const table = carta.table
  const status = useTableStatus(slug, token, mode === "propose")
  const waiter = status.data?.waiterFirstName || t.yourWaiter
  const tableOpen = status.data?.isOpen ?? table?.isOpen ?? false
  const billEnabled = !!table && carta.settings.showTableBill && status.data?.showTableBill !== false
  const bill = useTableBill(slug, token, billEnabled, tab === "bill")
  // S13: a closed table (404) or a hidden bill has no tab.
  const billShown = billEnabled && !!bill.data
  const activeTab = tab === "bill" && !billShown ? "menu" : tab
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const tableRef = { slug, token: token ?? "" }

  const send = async (note: string): Promise<boolean> => {
    if (!status.guestKey) return false
    setSending(true)
    setSendError(null)
    try {
      await sendProposal(tableRef, status.guestKey, lines, note)
      dispatch({ type: "replace", lines: [] })
      setAnnouncement(t.sent(waiter))
      void status.refetch()
      return true
    } catch (error) {
      // The cart stays: the guest fixes it or tries again.
      setSendError(guestErrorMessage(error, t.sendFailed))
      return false
    } finally {
      setSending(false)
    }
  }

  const request = async (kind: TableRequestKind): Promise<boolean> => {
    try {
      await sendTableRequest(tableRef, kind)
      return true
    } catch {
      return false
    }
  }
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
    setAnnouncement(ordering ? t.addedOrder(dish.name) : t.added(dish.name))
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
    <div lang={lang} className={cn("carta-root mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden bg-canvas text-fg", activeTab === "menu" ? "md:max-w-3xl lg:max-w-6xl" : "md:max-w-2xl")}>
      <style>{css}</style>
      {activeTab === "menu" ? (
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
              ordering={mode}
              notice={
                showTracking && trackingToken ? (
                  <a
                    href={trackingPath(slug, trackingToken)}
                    aria-label={t.myDelivery}
                    aria-describedby="banner-delivery"
                    className={cn("mx-[18px] mt-3.5 md:mx-6 flex items-center justify-between gap-3 rounded-card border px-3.5 py-3 text-[13.5px]", TONES.kitchen, FOCUS)}
                  >
                    <span id="banner-delivery">{t.myDeliveryHint}</span>
                    <b className="whitespace-nowrap underline underline-offset-4">{t.myDelivery}</b>
                  </a>
                ) : (
                mode === "propose" &&
                !tableOpen &&
                carta.isOpenNow &&
                table && (
                  <div
                    role="status"
                    aria-labelledby="banner-table"
                    className={cn("mx-[18px] mt-3.5 grid gap-0.5 rounded-card border px-3.5 py-3 text-[13px] md:mx-6", TONES.warning)}
                  >
                    <b id="banner-table" className="text-[13.5px]">
                      {t.tableClosedTitle}
                    </b>
                    <span>{t.tableClosedHint(table.number)}</span>
                  </div>
                )
                )
              }
            />
          </main>
          <footer className="grid gap-1 px-[18px] pb-36 pt-7 md:px-6 text-center text-xs text-muted-fg">
            <span>{t.pricesNote}</span>
            {lang === "en" && <span lang="en">{TRANSLATION_FOOTER}</span>}
            <span>{t.madeWith}</span>
          </footer>
        </>
      ) : activeTab === "bill" && bill.data && table ? (
        <main>
          <TableBill
            bill={bill.data}
            t={t}
            tableNumber={table.number}
            waiter={waiter}
            canAsk={mode === "propose"}
            onAsk={() => (mode === "propose" ? request("bill") : Promise.resolve(true))}
            review={{
              googleReviewUrl: carta.settings.googleReviewUrl,
              onFeedback: (rating, comment) => sendFeedback(slug, { token, rating, comment }),
            }}
            footer={mode === "propose" && <CallWaiter t={t} waiter={waiter} onCall={() => request("waiter")} />}
          />
        </main>
      ) : mode === "propose" && table ? (
        <main>
          <MyOrder
            lines={lines}
            dispatch={dispatch}
            t={t}
            tableNumber={table.number}
            waiter={waiter}
            tableOpen={tableOpen}
            cartaOpen={carta.isOpenNow}
            proposals={status.data?.proposals ?? []}
            sending={sending}
            error={sendError}
            onSend={send}
            onBrowse={() => setTab("menu")}
            callWaiter={<CallWaiter t={t} waiter={waiter} onCall={() => request("waiter")} />}
          />
        </main>
      ) : mode === "delivery" ? (
        <main>
          <DeliveryCheckout
            carta={carta}
            slug={slug}
            lines={lines}
            dispatch={dispatch}
            t={t}
            onBrowse={() => setTab("menu")}
            onSent={rememberTracking}
          />
        </main>
      ) : mode === "whatsapp" && carta.settings.whatsapp ? (
        <main>
          <WhatsappOrder carta={carta} whatsapp={carta.settings.whatsapp} lines={lines} dispatch={dispatch} t={t} onBrowse={() => setTab("menu")} />
        </main>
      ) : (
        <main>
          <MyList lines={lines} dispatch={dispatch} t={t} onBrowse={() => setTab("menu")} />
        </main>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] md:bottom-4 md:max-w-md md:px-3">
        {activeTab === "menu" && count > 0 && (
          <div className="px-3 pb-3 md:px-0">
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
                {mode === "propose" ? t.seeOrder : ordering ? t.seeCart : t.seeList}
              </span>
            </button>
          </div>
        )}
        <nav aria-label={t.tabs} className="grid auto-cols-fr grid-flow-col border-t border-line bg-canvas px-1.5 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 md:rounded-full md:border md:border-line-strong md:pb-1 md:shadow-[0_16px_32px_-14px_rgba(0,0,0,0.45)]">
          {(
            [
              ["menu", t.tabMenu, MenuIcon],
              ["list", mode === "propose" ? t.tabOrder : ordering ? t.tabCart : t.tabList, ListIcon],
              ...(billShown ? ([["bill", t.tabBill, BillIcon]] as const) : []),
            ] as const
          ).map(([key, label, Icon]) => {
            const badge = key === "list" && count > 0
            return (
              <button
                key={key}
                type="button"
                aria-current={activeTab === key ? "page" : undefined}
                aria-label={badge ? `${label} (${count})` : label}
                onClick={() => setTab(key)}
                className={cn(
                  "relative grid min-h-14 content-center justify-items-center gap-0.5 rounded-xl md:min-h-12 md:rounded-full text-xs font-medium text-muted-fg",
                  activeTab === key && BRAND_TEXT,
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
            setAnnouncement(ordering ? t.addedOrder(sheetDish.name) : t.added(sheetDish.name))
            setSheet(null)
          }}
        />
      )}
      {sheet?.kind === "share" && <ShareSheet carta={carta} dish={shareDish} lang={lang} t={t} onClose={() => setSheet(null)} />}
    </div>
  )
}
