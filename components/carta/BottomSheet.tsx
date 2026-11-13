"use client"

import type React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { FOCUS } from "./styles"

/**
 * The carta's bottom sheet (artboard `.sheet`): Radix Dialog, so Escape and
 * the scrim close it and focus returns to the control that opened it. The
 * content carries `carta-root` because the portal leaves the page's root and
 * its brand variables.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  titleHidden = false,
  closeLabel,
  lang,
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  titleHidden?: boolean
  closeLabel: string
  lang: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 dark:bg-[rgba(7,6,13,0.72)]" />
        <Dialog.Content
          lang={lang}
          aria-describedby={undefined}
          className="carta-root fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-card-lg border-t border-line-strong md:inset-0 md:m-auto md:h-fit md:max-h-[85dvh] md:max-w-lg md:rounded-card-lg md:border md:shadow-2xl bg-canvas text-fg motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-300"
        >
          <div className="relative flex flex-none items-center justify-between gap-3 py-2.5 pl-[18px] pr-2.5">
            <span aria-hidden="true" className="absolute left-[calc(50%-20px)] top-2 h-1 w-10 rounded bg-line-strong md:hidden" />
            <Dialog.Title className={cn("text-base font-semibold", titleHidden && "sr-only")}>{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className={cn("ml-auto grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-surface text-xl", FOCUS)}
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>
          <div className="grid min-h-0 gap-3.5 overflow-y-auto px-[18px] pb-[18px]">{children}</div>
          {footer && (
            <div className="flex flex-none gap-2.5 border-t border-line bg-canvas px-[18px] pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
