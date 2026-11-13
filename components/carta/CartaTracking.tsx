"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { failureOf, fetchCarta } from "@/lib/carta/api"
import { brandCss, brandPalette } from "@/lib/carta/brand"
import { DELIVERY_STEP, deliveryOrderLabel, isTrackingDone, saveTrackingToken, type GuestDeliveryStatus } from "@/lib/carta/delivery"
import { formatCop } from "@/lib/carta/format"
import { STRINGS, type CartaStrings } from "@/lib/carta/i18n"
import { cartaPath } from "@/lib/carta/share"
import { useDeliveryStatus } from "@/lib/carta/use-delivery"
import { cn } from "@/lib/utils"
import { CartaFailureView, CartaSkeleton } from "./CartaStates"
import { paymentLabel } from "./DeliveryCheckout"
import { ShareSheet } from "./ShareSheet"
import { CHIP, FOCUS, GHOST, TONES } from "./styles"

/**
 * The guest's delivery order (`/c/<slug>/d/<trackingToken>`, S15, artboard
 * `trackingHtml`): "Pedido D-0142", Recibido → Confirmado → En camino →
 * Entregado, polled every 15 s while visible; a rejected order shows the
 * operator's reason. The token is this order's only key: nothing else of
 * the customer is shown.
 */
export function CartaTracking({ slug, trackingToken }: { slug: string; trackingToken: string }) {
  const cartaQuery = useQuery({
    queryKey: ["carta", slug, null, "auto"],
    queryFn: () => fetchCarta({ slug }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const status = useDeliveryStatus(slug, trackingToken)
  const [sharing, setSharing] = useState(false)
  const carta = cartaQuery.data
  const t = STRINGS[carta?.lang ?? "es"]
  const css = useMemo(() => brandCss(brandPalette(carta?.settings.brandColor ?? null)), [carta?.settings.brandColor])

  const stage = status.data?.stage
  useEffect(() => {
    // "Ver mi pedido" on the carta follows the order this page shows, until it ends.
    if (!stage) return
    saveTrackingToken(window.localStorage, slug, isTrackingDone(stage) ? null : trackingToken)
  }, [slug, trackingToken, stage])

  if (cartaQuery.isError) {
    return <CartaFailureView failure={failureOf(cartaQuery.error)} t={t} onRetry={() => void cartaQuery.refetch()} />
  }
  if (status.isError && failureOf(status.error) === "not_found") {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-[480px] md:max-w-2xl content-center justify-items-center gap-3 bg-canvas px-6 text-center text-fg">
        <h1 className="text-xl font-semibold tracking-tight">{t.trackNotFound}</h1>
        <a href={cartaPath(slug)} className={cn(GHOST, "mt-2", FOCUS)}>
          {t.seeCarta}
        </a>
      </main>
    )
  }
  if (status.isError) {
    return <CartaFailureView failure={failureOf(status.error)} t={t} onRetry={() => void status.refetch()} />
  }
  if (!carta || !status.data) return <CartaSkeleton t={t} />

  const order = status.data
  const heading =
    order.stage === "rejected"
      ? t.trackRejectedTitle
      : order.stage === "failed"
        ? t.trackFailedTitle
        : order.stage === "cancelled"
          ? t.trackCancelledTitle
          : t.trackTitle(order.orderNumber ? deliveryOrderLabel(order.orderNumber) : null)
  return (
    <div lang={carta.lang} className="carta-root mx-auto min-h-dvh w-full max-w-[480px] md:max-w-2xl overflow-x-hidden bg-canvas text-fg">
      <style>{css}</style>
      <main className="grid content-start gap-3.5 px-[18px] pb-16 pt-6">
        <a href={cartaPath(slug)} className={cn("inline-flex min-h-11 w-fit items-center rounded-lg text-[13.5px] font-medium text-muted-fg underline underline-offset-4", FOCUS)}>
          {carta.restaurant.name}
        </a>
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1 text-[13.5px] text-muted-fg">{t.trackKeep}</p>
        </header>
        <div aria-live="polite">
          <OrderState order={order} t={t} />
        </div>
        <ul className="grid gap-1 rounded-card border border-line bg-surface p-3.5 text-[14px]">
          {order.lines.map((l, i) => (
            <li key={`${l.name}-${i}`}>{`${l.quantity} × ${l.name ?? ""}`}</li>
          ))}
        </ul>
        <dl className="grid gap-1.5 rounded-card border border-line bg-surface p-3.5 text-[14px]">
          {order.total !== null && (
            <div className="flex justify-between gap-2.5 font-semibold">
              <dt>{t.payOnDelivery}</dt>
              <dd className="tabular-nums">{formatCop(order.total)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2.5">
            <dt>{t.method}</dt>
            <dd>{paymentLabel(t, order.paymentMethod)}</dd>
          </div>
        </dl>
        <button type="button" onClick={() => setSharing(true)} className={cn(GHOST, FOCUS)}>
          {t.shareWithSomeone}
        </button>
      </main>
      {sharing && <ShareSheet carta={carta} dish={null} lang={carta.lang} t={t} onClose={() => setSharing(false)} />}
    </div>
  )
}

function OrderState({ order, t }: { order: GuestDeliveryStatus; t: CartaStrings }) {
  if (order.stage === "rejected") {
    return (
      <div className="grid gap-2 rounded-card border border-line bg-surface p-3.5">
        <span className={cn(CHIP, TONES.danger, "w-fit")}>{t.rejected}</span>
        {order.rejectReason && <p className="text-[13.5px]">{t.rejectedReason(order.rejectReason)}</p>}
        <p className="text-[13.5px] text-muted-fg">{t.trackRejectedHint}</p>
      </div>
    )
  }
  if (order.stage === "failed" || order.stage === "cancelled") {
    return (
      <p className={cn("rounded-card border p-3.5 text-[14px] font-medium", TONES.reserved)}>
        {order.stage === "failed" ? t.trackFailed : t.trackCancelled}
      </p>
    )
  }

  const step = DELIVERY_STEP[order.stage]
  const rows = [
    { label: t.trackReceived, hint: t.trackReceivedHint },
    { label: t.trackConfirmed, hint: t.trackConfirmedHint },
    { label: t.trackOnTheWay, hint: null },
    { label: t.trackDelivered, hint: null },
  ]
  return (
    <ol aria-label={t.stageSteps} className="grid rounded-card border border-line bg-surface p-3.5">
      {rows.map((row, i) => {
        const state = i <= step ? "done" : i === step + 1 ? "now" : "todo"
        return (
          <li
            key={row.label}
            data-state={state}
            aria-current={state === "now" ? "step" : undefined}
            className="relative grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5 pb-3.5 text-sm last:pb-0"
          >
            {i < rows.length - 1 && (
              <span
                aria-hidden="true"
                className={cn("absolute bottom-0.5 left-[13px] top-[26px] w-0.5", state === "done" ? "bg-[var(--brand)]" : "bg-line-strong")}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] grid h-7 w-7 place-items-center rounded-full border-2 text-[13px] font-bold",
                state === "done"
                  ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                  : state === "now"
                    ? "border-[var(--brand)] bg-canvas text-[var(--brand-text)]"
                    : "border-line-strong bg-canvas text-muted-fg",
              )}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span>
              {row.label}
              {row.hint && state === "done" && <small className="block text-[12.5px] text-muted-fg">{row.hint}</small>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
