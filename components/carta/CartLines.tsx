"use client"

import { cartTotal, type CartAction, type CartLine } from "@/lib/carta/cart"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import { Stepper } from "./Stepper"

/** The cart with steppers and its subtotal (artboard `cartCard`). */
export function CartLines({ lines, dispatch, t }: { lines: CartLine[]; dispatch: (action: CartAction) => void; t: CartaStrings }) {
  return (
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
        <span className="tabular-nums">{formatCop(cartTotal(lines))}</span>
      </li>
    </ul>
  )
}
