"use client"

import { useCallback, useEffect, useReducer, useRef } from "react"
import { cartReducer, loadLines, saveLines, type CartAction, type CartLine } from "./cart"

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage
}

/**
 * The guest's lines for one restaurant, persisted in localStorage per slug.
 * Read after mount so the server render and the first client render agree.
 */
export function useCartaCart(slug: string) {
  const [lines, dispatch] = useReducer(cartReducer, [] as CartLine[])
  const loaded = useRef<string | null>(null)

  useEffect(() => {
    dispatch({ type: "replace", lines: loadLines(browserStorage(), slug) })
    loaded.current = slug
  }, [slug])

  useEffect(() => {
    if (loaded.current === slug) saveLines(browserStorage(), slug, lines)
  }, [slug, lines])

  const act = useCallback((action: CartAction) => dispatch(action), [])
  return { lines, dispatch: act }
}
