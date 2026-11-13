"use client"

import type { CartAction, CartLine } from "@/lib/carta/cart"
import type { CartaStrings } from "@/lib/carta/i18n"
import { cn } from "@/lib/utils"
import { BRAND_TEXT, FOCUS, GHOST } from "./styles"

/** "Mi lista" (S11): the guest's picks to show the waiter; nothing is sent. */
export function MyList({
  lines,
  dispatch,
  t,
  onBrowse,
}: {
  lines: CartLine[]
  dispatch: (action: CartAction) => void
  t: CartaStrings
  onBrowse: () => void
}) {
  return (
    <div className="grid content-start gap-3.5 px-[18px] pb-32 pt-[18px]">
      <header>
        <h2 className="text-[22px] font-semibold tracking-tight">{t.listTitle}</h2>
        <p className="mt-1 text-[13.5px] text-muted-fg">{t.listIntro}</p>
      </header>
      {lines.length === 0 ? (
        <div className="grid justify-items-center gap-2.5 px-1 py-8 text-center text-muted-fg">
          <p>{t.listEmpty}</p>
          <button type="button" onClick={onBrowse} className={cn(GHOST, "text-fg", FOCUS)}>
            {t.seeCarta}
          </button>
        </div>
      ) : (
        <ul className="grid gap-2.5 rounded-card border border-line bg-surface p-3.5">
          {lines.map((l) => {
            const detail = [...l.options.map((o) => o.name), ...(l.note ? [`“${l.note}”`] : [])]
            return (
              <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold">
                    <span className="tabular-nums">{l.qty}</span> × {l.name}
                  </div>
                  {detail.length > 0 && (
                    <div className="text-[12.5px] text-muted-fg">
                      {detail.map((d, i) => (
                        <span key={d}>
                          {i > 0 && " · "}
                          <span>{d}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="inline-flex flex-none items-center rounded-pill border border-line-strong">
                  <button
                    type="button"
                    aria-label={t.removeOne(l.name)}
                    onClick={() => dispatch({ type: "decrement", key: l.key })}
                    className={cn("h-11 w-11 rounded-full text-lg", FOCUS)}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <span aria-live="polite" className="min-w-[22px] text-center font-semibold tabular-nums">
                    {l.qty}
                  </span>
                  <button
                    type="button"
                    aria-label={t.addOne(l.name)}
                    onClick={() => dispatch({ type: "increment", key: l.key })}
                    className={cn("h-11 w-11 rounded-full text-lg", FOCUS)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-xl bg-surface-2 p-3 text-[13px] text-fg-2">
        <span aria-hidden="true" className={cn("grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--brand-tint)] font-bold", BRAND_TEXT)}>
          i
        </span>
        <span>{t.listInfo}</span>
      </p>
    </div>
  )
}
