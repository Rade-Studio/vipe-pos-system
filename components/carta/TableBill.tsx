"use client"

import type React from "react"
import { useId, useState } from "react"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { billShare, MAX_PEOPLE, MAX_SHARE, type GuestTableBill } from "@/lib/carta/table"
import { cn } from "@/lib/utils"
import { InfoNote } from "./MyOrder"
import { clock } from "./ProposalCard"
import { ReviewCard } from "./ReviewCard"
import { Stepper } from "./Stepper"
import { BRAND_FILL, BRAND_TEXT, BRAND_TINT, CTA, FOCUS } from "./styles"

const SEG_BUTTON =
  "min-h-11 rounded-[9px] px-1.5 py-1 text-[13px] font-medium text-fg-2 aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-sm aria-pressed:outline aria-pressed:outline-1 aria-pressed:outline-line-strong"

/**
 * "La cuenta" (S13, artboard `billHtml` after L8): the open order read-only,
 * split in equal parts or by line ("Entre − N + personas"), the voluntary
 * tip and "Te toca". Nothing is sent to the cashier. Then "Pedir la cuenta"
 * and the review (S14).
 */
export function TableBill({
  bill,
  t,
  tableNumber,
  waiter,
  canAsk,
  onAsk,
  review,
  footer,
}: {
  bill: GuestTableBill
  t: CartaStrings
  tableNumber: number
  waiter: string
  /** Table ordering on: asking notifies the waiter. */
  canAsk: boolean
  /** Resolves true once the waiter was told (or nothing had to be sent). */
  onAsk: () => Promise<boolean>
  review: { googleReviewUrl: string | null; onFeedback: (rating: number, comment: string) => Promise<void> }
  footer?: React.ReactNode
}) {
  const [mode, setMode] = useState<"equal" | "lines">("equal")
  const [people, setPeople] = useState(2)
  const [shares, setShares] = useState<Record<number, number>>({})
  const [tipOn, setTipOn] = useState(true)
  const [asked, setAsked] = useState(false)
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)
  const tipId = useId()
  const share = billShare(bill, mode === "equal" ? { mode, people } : { mode, shares }, tipOn, bill.tipPercentage)
  const setShare = (index: number, value: number | null) =>
    setShares((prev) => {
      const next = { ...prev }
      if (value === null) delete next[index]
      else next[index] = Math.min(MAX_SHARE, Math.max(1, value))
      return next
    })

  const ask = async () => {
    setAsking(true)
    setAskFailed(false)
    const ok = await onAsk()
    setAsking(false)
    if (ok) setAsked(true)
    else setAskFailed(true)
  }

  return (
    <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
      <header>
        <h2 className="text-[22px] font-semibold tracking-tight">{t.billTitle(tableNumber)}</h2>
        <p className="mt-1 text-[13.5px] text-muted-fg">{t.billUpdated(clock(bill.updatedAt))}</p>
      </header>
      <div role="group" aria-label={t.splitHow} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line bg-surface-2 p-1">
        <button type="button" aria-pressed={mode === "equal"} onClick={() => setMode("equal")} className={cn(SEG_BUTTON, FOCUS)}>
          {t.splitEqual}
        </button>
        <button type="button" aria-pressed={mode === "lines"} onClick={() => setMode("lines")} className={cn(SEG_BUTTON, FOCUS)}>
          {t.splitLines}
        </button>
      </div>
      {mode === "equal" && (
        <div className="flex items-center justify-between gap-2.5 rounded-card border border-line bg-surface p-3.5">
          <div>
            <div className="text-[14.5px] font-semibold">{t.weAre}</div>
            <div className="text-[12.5px] text-muted-fg">{t.peopleAtTable}</div>
          </div>
          <Stepper
            value={people}
            min={1}
            max={MAX_PEOPLE}
            onDecrement={() => setPeople((n) => Math.max(1, n - 1))}
            onIncrement={() => setPeople((n) => Math.min(MAX_PEOPLE, n + 1))}
            decrementLabel={t.personFewer}
            incrementLabel={t.personMore}
          />
        </div>
      )}
      <ul className="rounded-card border border-line bg-surface px-3.5 py-1">
        {bill.lines.map((line, i) => {
          const amount = formatCop(line.lineTotal)
          if (mode === "equal") {
            return (
              <li key={i} className="grid min-h-[52px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 border-b border-line last:border-b-0">
                <span className="text-center tabular-nums text-muted-fg">{line.quantity}×</span>
                <span className="text-sm font-medium">{line.name}</span>
                <span className="tabular-nums">{amount}</span>
              </li>
            )
          }
          const n = shares[i] ?? 0
          const checkId = `bill-line-${i}`
          return (
            <li key={i} className="grid min-h-[52px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 border-b border-line last:border-b-0">
              <input
                id={checkId}
                type="checkbox"
                checked={n > 0}
                aria-label={t.mine(line.name)}
                onChange={(e) => setShare(i, e.target.checked ? 1 : null)}
                className={cn("mx-auto h-[22px] w-[22px] accent-[var(--brand)]", FOCUS)}
              />
              <label htmlFor={checkId} className="min-w-0 text-sm font-medium">
                {line.quantity} × {line.name}
                {n > 0 && <small className="block text-xs font-normal text-muted-fg">{n === 1 ? t.justMe : t.sharedBy(n)}</small>}
              </label>
              {n > 0 ? (
                <span className="text-right tabular-nums">
                  {formatCop(line.lineTotal / n)}
                  {n > 1 && <small className="block text-xs font-normal text-muted-fg">{t.of(amount)}</small>}
                </span>
              ) : (
                <span className="tabular-nums">{amount}</span>
              )}
              {n > 0 && (
                <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-2 pb-2 text-[13px] text-fg-2">
                  <span>{t.splitBy}</span>
                  <Stepper
                    value={n}
                    min={1}
                    max={MAX_SHARE}
                    onDecrement={() => setShare(i, n - 1)}
                    onIncrement={() => setShare(i, n + 1)}
                    decrementLabel={t.personFewerFor(line.name)}
                    incrementLabel={t.personMoreFor(line.name)}
                  />
                  <span>{t.people}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="grid gap-1.5 rounded-card border border-line bg-surface p-3.5 text-sm">
        {bill.discounts.map((d) => (
          <div key={d.label} className="flex justify-between gap-2.5 text-muted-fg">
            <span className="min-w-0">{d.label}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCop(-d.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-2.5">
          <span className="min-w-0">{t.tableTotal}</span>
          <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCop(bill.subtotal)}</span>
        </div>
        <label htmlFor={tipId} className="flex min-h-11 cursor-pointer items-center justify-between gap-2.5 text-[13px] text-fg-2">
          <span>{t.tip(bill.tipPercentage)}</span>
          <input
            id={tipId}
            type="checkbox"
            role="switch"
            checked={tipOn}
            onChange={(e) => setTipOn(e.target.checked)}
            className={cn(
              "relative h-[26px] w-11 flex-none cursor-pointer appearance-none rounded-pill bg-line-strong transition-colors checked:bg-[var(--brand)]",
              "after:absolute after:left-[3px] after:top-[3px] after:h-5 after:w-5 after:rounded-full after:bg-surface after:shadow after:transition-transform checked:after:translate-x-[18px]",
              FOCUS,
            )}
          />
        </label>
      </div>
      <div data-testid="te-toca" aria-live="polite" className={cn("flex items-baseline justify-between gap-2.5 rounded-card-lg border p-3.5", BRAND_TINT)}>
        <span>{t.yourShare}</span>
        <b className={cn("text-[26px] font-bold tracking-tight tabular-nums", BRAND_TEXT)}>{formatCop(share.total)}</b>
      </div>
      <InfoNote>{t.billInfo}</InfoNote>
      {asked ? (
        <ReviewCard t={t} title={canAsk ? t.billOnTheWay(capitalize(waiter)) : t.thanks} {...review} />
      ) : (
        <>
          {askFailed && (
            <p role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
              {t.requestFailed}
            </p>
          )}
          <button type="button" disabled={asking} onClick={() => void ask()} className={cn(CTA, BRAND_FILL, FOCUS)}>
            {canAsk ? t.askBill(waiter) : t.askedBill}
          </button>
        </>
      )}
      {footer}
    </div>
  )
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("es-CO") + s.slice(1)
