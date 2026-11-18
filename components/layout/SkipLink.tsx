"use client"

import type { MouseEvent } from "react"

/**
 * H-102: "Saltar al contenido", the first Tab stop of every staff view (WCAG 2.4.1).
 * It moves focus to the view's single `<main>` (H-009), so no view needs a fixed id.
 */
export function SkipLink() {
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById("main-content") ?? document.querySelector<HTMLElement>("main")
    if (!main) return
    event.preventDefault()
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1")
    main.focus()
    main.scrollIntoView?.({ block: "start" })
  }
  return (
    <a
      href="#main-content"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
    >
      Saltar al contenido
    </a>
  )
}
