"use client"

import { Tag } from "lucide-react"

import type { PromotionsTodayDto } from "@/lib/api/promotions"
import { sheetGroups, type SheetCard } from "@/lib/promotions/waiter"
import { cn } from "@/lib/utils"
import { forwardRef, useState, type ComponentPropsWithoutRef } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { PromoTagPill } from "./PromoTagPill"

const FOCUS = "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

/** "Promociones" in the order screen's top bar, with how many apply now. */
export const PromotionsButton = forwardRef<HTMLButtonElement, { count: number } & ComponentPropsWithoutRef<"button">>(function PromotionsButton(
  { count, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-label={`Promociones: ${count} ${count === 1 ? "activa" : "activas"} ahora`}
      {...props}
      className={cn(
        "inline-flex h-11 flex-none items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 font-semibold",
        count > 0 ? "border-brand-line bg-brand-tint text-brand-strong" : "border-line-strong bg-card text-fg-2",
        FOCUS,
        className,
      )}
    >
      <Tag className="h-4 w-4 md:hidden" aria-hidden />
      <span className="hidden md:inline">Promociones</span>
      <span
        aria-hidden
        className={cn(
          "inline-grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-xs tabular-nums",
          count > 0 ? "bg-brand text-brand-contrast" : "bg-line-strong text-fg",
        )}
      >
        {count}
      </span>
    </button>
  )
})

function Card({ card, on }: { card: SheetCard; on?: boolean }) {
  return (
    <li className={cn("grid gap-1.5 rounded-[14px] border bg-surface px-3.5 py-3", on ? "border-brand-line" : "border-line")}>
      <span className="flex items-center justify-between gap-2">
        <b className="text-[15px] font-semibold">{card.name}</b>
        <PromoTagPill tag={card.tag} />
      </span>
      <p className="text-[13.5px] text-fg-2">
        <span className="text-muted-fg">Al cliente: </span>
        {card.sentence}
      </p>
      <p className="text-[12.5px] text-muted-fg">{card.schedule}</p>
    </li>
  )
}

interface PromotionsSheetProps {
  today: PromotionsTodayDto | undefined
  /** "el salón" for tables. */
  placeLabel?: string
}

/**
 * The "Promociones" button and its sheet "Promociones de hoy" (S11): Ahora,
 * Más tarde hoy, No aplican ahora en el salón. The sheet traps the focus and
 * gives it back to the button on close (Escape too).
 */
export function PromotionsSheet({ today, placeLabel = "el salón" }: PromotionsSheetProps) {
  const [open, setOpen] = useState(false)
  const groups = sheetGroups(today)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <PromotionsButton count={today?.active.length ?? 0} />
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-[440px] max-w-full flex-col gap-0 overflow-hidden p-0 motion-reduce:animate-none motion-reduce:transition-none sm:max-w-[440px]"
      >
        <SheetHeader className="border-b border-line px-4 py-3.5 pr-12 text-left">
          <SheetTitle className="text-lg">Promociones de hoy</SheetTitle>
          <SheetDescription className="sr-only">Las promociones que aplican ahora, más tarde hoy y las que no aplican ahora.</SheetDescription>
        </SheetHeader>
        <div className="grid content-start gap-4 overflow-y-auto px-4 pb-5 pt-3.5">
          <section aria-labelledby="promos-now">
            <h3 id="promos-now" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">
              Ahora{today?.localTime ? ` · ${today.localTime}` : ""}
            </h3>
            {groups.now.length ? (
              <ul className="grid gap-2">{groups.now.map((card) => <Card key={card.id} card={card} on />)}</ul>
            ) : (
              <p className="py-1.5 text-[13.5px] text-muted-fg">Ninguna en este momento.</p>
            )}
          </section>
          {groups.later.length > 0 && (
            <section aria-labelledby="promos-later">
              <h3 id="promos-later" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">
                Más tarde hoy
              </h3>
              <ul className="grid gap-2">{groups.later.map((card) => <Card key={card.id} card={card} />)}</ul>
            </section>
          )}
          {groups.others.length > 0 && (
            <section aria-labelledby="promos-others">
              <h3 id="promos-others" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-fg">
                No aplican ahora en {placeLabel}
              </h3>
              <ul className="grid gap-2">{groups.others.map((card) => <Card key={card.id} card={card} />)}</ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
