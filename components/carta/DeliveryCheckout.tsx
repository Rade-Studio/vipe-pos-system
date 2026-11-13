"use client"

import type React from "react"
import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { cartTotal, type CartAction, type CartLine } from "@/lib/carta/cart"
import {
  EMPTY_FORM,
  deliveryBody,
  fetchPricing,
  phoneInput,
  submitDelivery,
  trackingPath,
  validateDelivery,
  type DeliveryErrors,
  type DeliveryField,
  type DeliveryForm,
  type GuestPricing,
  type PaymentMethod,
} from "@/lib/carta/delivery"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { guestErrorMessage, proposalItems } from "@/lib/carta/table"
import type { Carta } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { CartLines } from "./CartLines"
import { InfoNote } from "./MyOrder"
import { BRAND_FILL, BRAND_TINT, CTA, FOCUS, GHOST } from "./styles"

const INPUT = cn("min-h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] aria-[invalid=true]:border-status-danger-fg", FOCUS)
const ERROR = "text-[12.5px] font-medium text-status-danger-fg"

export function paymentLabel(t: CartaStrings, method: PaymentMethod): string {
  return method === "cash" ? t.payCash : method === "card" ? t.payCard : t.payTransfer
}

/** The delivery cart's header, shared with the WhatsApp fallback. */
export function DeliveryHeader({ t }: { t: CartaStrings }) {
  return (
    <header>
      <h2 className="text-[22px] font-semibold tracking-tight">{t.deliveryTitle}</h2>
      <p className="mt-1 text-[13.5px] text-muted-fg">{t.deliveryIntro}</p>
    </header>
  )
}

export function EmptyCart({ t, onBrowse }: { t: CartaStrings; onBrowse: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 px-1 py-8 text-center text-muted-fg">
      <p>{t.orderEmpty}</p>
      <button type="button" onClick={onBrowse} className={cn(GHOST, "text-fg", FOCUS)}>
        {t.seeCarta}
      </button>
    </div>
  )
}

/**
 * "Pedido" with online delivery on (S15, artboard 01 domicilio): the cart,
 * "¿A quién y a dónde lo llevamos?", how they pay on delivery, the totals of
 * the API's pricing preview (promotions, Envío, tax) and "Enviar pedido".
 * It enters the delivery console as pending; the guest follows it on the
 * tracking page. A refusal keeps the form and the cart.
 */
export function DeliveryCheckout({
  carta,
  slug,
  lines,
  dispatch,
  t,
  onBrowse,
  onSent,
}: {
  carta: Carta
  slug: string
  lines: CartLine[]
  dispatch: (action: CartAction) => void
  t: CartaStrings
  onBrowse: () => void
  /** Remembers the tracking token ("Ver mi pedido"). */
  onSent: (trackingToken: string) => void
}) {
  const router = useRouter()
  const [form, setForm] = useState<DeliveryForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<DeliveryErrors>({})
  const [phoneHint, setPhoneHint] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorId = useId()

  const items = proposalItems(lines)
  const pricing = useQuery({
    queryKey: ["carta-pricing", slug, JSON.stringify(items)],
    queryFn: () => fetchPricing(slug, lines),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  })
  const preview = pricing.data
  const total = preview?.total ?? cartTotal(lines) + carta.deliveryFee

  if (lines.length === 0) {
    return (
      <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
        <DeliveryHeader t={t} />
        <EmptyCart t={t} onBrowse={onBrowse} />
      </div>
    )
  }

  const set = <K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const send = async () => {
    if (!preview) return
    const found = validateDelivery(form, preview.total)
    setErrors(found)
    setSendError(null)
    const first = (Object.keys(found) as DeliveryField[])[0]
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
      return
    }
    setSending(true)
    try {
      const sent = await submitDelivery(slug, deliveryBody(form, lines))
      onSent(sent.trackingToken)
      dispatch({ type: "replace", lines: [] })
      router.push(trackingPath(slug, sent.trackingToken))
    } catch (error) {
      // The form and the cart stay: the guest fixes it or tries again.
      setSendError(guestErrorMessage(error, t.deliveryFailed))
    } finally {
      setSending(false)
    }
  }

  const phoneError = errors.phone ?? phoneHint
  const blocked = !carta.isOpenNow

  return (
    <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
      <DeliveryHeader t={t} />
      <CartLines lines={lines} dispatch={dispatch} t={t} />
      <form ref={formRef} noValidate onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-card border border-line bg-surface p-3.5">
        <b className="text-[15px]">{t.deliveryWho}</b>
        <Field label={t.fieldName} error={errors.name}>
          {(p) => <input {...p} name="name" autoComplete="name" placeholder="Laura Gómez" value={form.name} onChange={(e) => set("name", e.target.value)} className={INPUT} />}
        </Field>
        <Field label={t.fieldPhone} error={phoneError ?? undefined}>
          {(p) => (
            <input
              {...p}
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="300 123 4567"
              value={form.phone}
              onChange={(e) => {
                const next = phoneInput(e.target.value, form.phone)
                setPhoneHint(next.error)
                set("phone", next.value)
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.fieldAddress} error={errors.address}>
          {(p) => (
            <input {...p} name="address" autoComplete="street-address" placeholder="Calle 63 # 9-42, apto 501" value={form.address} onChange={(e) => set("address", e.target.value)} className={INPUT} />
          )}
        </Field>
        <Field label={t.fieldNeighborhood}>
          {(p) => <input {...p} name="neighborhood" placeholder="Chapinero Alto" value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} className={INPUT} />}
        </Field>
        <Field label={t.fieldNotes}>
          {(p) => (
            <textarea
              {...p}
              name="notes"
              maxLength={200}
              placeholder={t.fieldNotesPlaceholder}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={cn(INPUT, "min-h-[72px] py-2.5")}
            />
          )}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[13.5px] font-medium">{t.payHow}</legend>
          {(["cash", "card", "transfer"] as const).map((method) => (
            <label
              key={method}
              className={cn(
                "flex min-h-12 items-center gap-2.5 rounded-xl border border-line-strong px-3 text-[14.5px] has-[:checked]:font-semibold",
                form.payment === method && BRAND_TINT,
              )}
            >
              <input
                type="radio"
                name="payment"
                value={method}
                checked={form.payment === method}
                onChange={() => set("payment", method)}
                className="h-[18px] w-[18px] accent-[var(--brand)]"
              />
              {paymentLabel(t, method)}
            </label>
          ))}
        </fieldset>
        {form.payment === "cash" && (
          <Field label={t.cashFrom} error={errors.cashFrom}>
            {(p) => (
              <input {...p} name="cashFrom" inputMode="numeric" placeholder="$100.000" value={form.cashFrom} onChange={(e) => set("cashFrom", e.target.value)} className={INPUT} />
            )}
          </Field>
        )}
      </form>
      {preview ? (
        <Summary pricing={preview} t={t} />
      ) : pricing.isError ? (
        <p role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
          {guestErrorMessage(pricing.error, t.pricingFailed)}
        </p>
      ) : (
        <p role="status" className="text-[13.5px] text-muted-fg">
          {t.pricing}
        </p>
      )}
      {blocked && <InfoNote>{t.cartaClosedHint}</InfoNote>}
      {sendError && (
        <p id={errorId} role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
          {sendError}
        </p>
      )}
      <button
        type="button"
        disabled={blocked || sending || !preview}
        aria-describedby={sendError ? errorId : undefined}
        onClick={() => void send()}
        className={cn(CTA, BRAND_FILL, FOCUS)}
      >
        {t.sendDelivery(formatCop(total))}
      </button>
    </div>
  )
}

interface FieldProps {
  id: string
  "aria-invalid"?: true
  "aria-describedby"?: string
}

function Field({ label, error, children }: { label: string; error?: string; children: (props: FieldProps) => React.ReactNode }) {
  const id = useId()
  const errorId = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-medium">
        {label}
      </label>
      {children({ id, ...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {}) })}
      {error && (
        <span id={errorId} className={ERROR}>
          {error}
        </span>
      )}
    </div>
  )
}

/** The pricing preview (L33): lines with their promotion discounts, Envío, tax when > 0 and the amount due. */
function Summary({ pricing, t }: { pricing: GuestPricing; t: CartaStrings }) {
  const discounts = [...pricing.lines.flatMap((l) => l.discounts), ...(pricing.billDiscount ? [pricing.billDiscount] : [])]
  const row = "flex justify-between gap-2.5"
  return (
    <section aria-label={t.summary} className="grid gap-1.5 rounded-card border border-line bg-surface p-3.5 text-[14px]">
      {pricing.lines.map((l, i) => (
        <div key={`${l.dishId}-${i}`} className={row}>
          <span className="min-w-0">{`${l.quantity} × ${l.name}`}</span>
          <span className="whitespace-nowrap tabular-nums">{formatCop(l.quantity * l.unitPrice)}</span>
        </div>
      ))}
      {discounts.map((d, i) => (
        <div key={`${d.label}-${i}`} className={cn(row, "text-status-ok-fg")}>
          <span className="min-w-0">{d.label}</span>
          <span className="whitespace-nowrap tabular-nums">{formatCop(-d.amount)}</span>
        </div>
      ))}
      <div className={row}>
        <span>{t.feeRow}</span>
        <span className="tabular-nums">{formatCop(pricing.deliveryFee)}</span>
      </div>
      {pricing.tax > 0 && (
        <div className={row}>
          <span>{t.taxRow}</span>
          <span className="tabular-nums">{formatCop(pricing.tax)}</span>
        </div>
      )}
      <div className={cn(row, "border-t border-line pt-2 text-[17px] font-semibold")}>
        <span>{t.total}</span>
        <span className="tabular-nums">{formatCop(pricing.total)}</span>
      </div>
    </section>
  )
}
