"use client"

import type React from "react"
import { useId, useState } from "react"
import { cartTotal, type CartAction, type CartLine } from "@/lib/carta/cart"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import type { GuestProposal } from "@/lib/carta/table"
import { cn } from "@/lib/utils"
import { ProposalCard } from "./ProposalCard"
import { Stepper } from "./Stepper"
import { BRAND_FILL, BRAND_TEXT, CTA, FOCUS, GHOST } from "./styles"

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-xl bg-surface-2 p-3 text-[13px] text-fg-2">
      <span aria-hidden="true" className={cn("grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--brand-tint)] font-bold", BRAND_TEXT)}>
        i
      </span>
      <span>{children}</span>
    </p>
  )
}

/** "Llamar al mesero" (S14): a small action; the waiter's inbox shows it until attended. */
export function CallWaiter({ t, waiter, onCall }: { t: CartaStrings; waiter: string; onCall: () => Promise<boolean> }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle")
  if (state === "sent") {
    return (
      <p role="status" className="text-center text-[13.5px] text-muted-fg">
        {t.calledWaiter(waiter)}
      </p>
    )
  }
  return (
    <div className="grid justify-items-center gap-1.5">
      {state === "failed" && (
        <p role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
          {t.requestFailed}
        </p>
      )}
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => {
          setState("sending")
          void onCall().then((ok) => setState(ok ? "sent" : "failed"))
        }}
        className={cn(GHOST, "min-h-11 border-transparent text-[13.5px] text-fg-2 underline underline-offset-4", FOCUS)}
      >
        {t.callWaiter}
      </button>
    </div>
  )
}

/**
 * "Mi pedido" on a table QR with table ordering on (S12, artboard
 * `orderHtml` mesa): the cart with steppers, a kitchen note and "Enviar a
 * <mesero>"; nothing is cooked or charged until the waiter confirms. Sent
 * proposals show their status above the cart.
 */
export function MyOrder({
  lines,
  dispatch,
  t,
  tableNumber,
  waiter,
  tableOpen,
  cartaOpen,
  proposals,
  sending,
  error,
  onSend,
  onBrowse,
  callWaiter,
}: {
  lines: CartLine[]
  dispatch: (action: CartAction) => void
  t: CartaStrings
  tableNumber: number
  waiter: string
  tableOpen: boolean
  cartaOpen: boolean
  proposals: GuestProposal[]
  sending: boolean
  error: string | null
  /** Resolves true once sent: the note clears with the cart. */
  onSend: (note: string) => Promise<boolean>
  onBrowse: () => void
  callWaiter: React.ReactNode
}) {
  const [note, setNote] = useState("")
  const noteId = useId()
  const errorId = useId()
  const blocked = !tableOpen || !cartaOpen
  const total = cartTotal(lines)

  return (
    <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
      <header>
        <h2 className="text-[22px] font-semibold tracking-tight">{t.orderTitle(tableNumber)}</h2>
        <p className="mt-1 text-[13.5px] text-muted-fg">{t.orderIntro(waiter)}</p>
      </header>
      {proposals.length > 0 && (
        <div aria-live="polite" className="grid gap-3">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} waiter={waiter} t={t} />
          ))}
        </div>
      )}
      {lines.length === 0 ? (
        proposals.length === 0 && (
          <div className="grid justify-items-center gap-2.5 px-1 py-8 text-center text-muted-fg">
            <p>{t.orderEmpty}</p>
            <button type="button" onClick={onBrowse} className={cn(GHOST, "text-fg", FOCUS)}>
              {t.seeCarta}
            </button>
          </div>
        )
      ) : (
        <>
          <ul className="grid gap-2.5 rounded-card border border-line bg-surface p-3.5">
            {lines.map((row) => {
              const detail = [...row.options.map((o) => o.name), ...(row.note ? [`“${row.note}”`] : [])].join(" · ")
              return (
                <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold">{row.name}</div>
                    <div className="text-[12.5px] text-muted-fg">
                      {detail && `${detail} · `}
                      <span className="tabular-nums">{formatCop(row.unitPrice)}</span>
                    </div>
                  </div>
                  <Stepper
                    value={row.qty}
                    onDecrement={() => dispatch({ type: "decrement", key: row.key })}
                    onIncrement={() => dispatch({ type: "increment", key: row.key })}
                    decrementLabel={t.removeOne(row.name)}
                    incrementLabel={t.addOne(row.name)}
                  />
                </li>
              )
            })}
            <li className="flex justify-between gap-2.5 border-t border-line pt-2 text-[17px] font-semibold">
              <span>{t.subtotal}</span>
              <span className="tabular-nums">{formatCop(total)}</span>
            </li>
          </ul>
          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-[13.5px] font-medium">
              {t.orderNote}
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.orderNotePlaceholder}
              className={cn("min-h-[72px] rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-[15px]", FOCUS)}
            />
          </div>
          <InfoNote>{!tableOpen ? t.tableClosedHint(tableNumber) : !cartaOpen ? t.cartaClosedHint : t.orderInfo(waiter)}</InfoNote>
          {error && (
            <p id={errorId} role="alert" className="text-[13.5px] font-medium text-status-danger-fg">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={blocked || sending}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void onSend(note).then((sent) => sent && setNote(""))}
            className={cn(CTA, BRAND_FILL, FOCUS)}
          >
            {t.send(waiter, formatCop(total))}
          </button>
        </>
      )}
      {callWaiter}
    </div>
  )
}
