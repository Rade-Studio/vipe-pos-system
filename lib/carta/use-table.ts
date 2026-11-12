"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchTableBill, fetchTableStatus, guestKeyFor } from "./table"

/** Guests have no socket (L10): the status is polled while the page is visible. */
export const STATUS_POLL_MS = 10_000
const BILL_POLL_MS = 30_000

/** This browser's guest key for the slug; null until mounted (server render). */
export function useGuestKey(slug: string): string | null {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    setKey(guestKeyFor(typeof window === "undefined" ? undefined : window.localStorage, slug))
  }, [slug])
  return key
}

/**
 * The table's status for this guest (S12): open or not, the waiter's first
 * name and this guest's proposals with their stage. Every 10 s while the tab
 * is visible (TanStack pauses intervals in the background) and on focus.
 */
export function useTableStatus(slug: string, token: string | undefined, enabled: boolean) {
  const guestKey = useGuestKey(slug)
  const query = useQuery({
    queryKey: ["carta-table-status", slug, token ?? null, guestKey],
    queryFn: () => fetchTableStatus({ slug, token: token! }, guestKey!),
    enabled: enabled && !!token && !!guestKey,
    refetchInterval: STATUS_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  const { refetch } = query
  const active = enabled && !!token && !!guestKey
  useEffect(() => {
    if (!active) return
    const onFocus = () => void refetch()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, refetch])
  return { ...query, guestKey }
}

/** The open order, read-only (S13); null when the table is closed or the bill hidden. */
export function useTableBill(slug: string, token: string | undefined, enabled: boolean, live: boolean) {
  return useQuery({
    queryKey: ["carta-table-bill", slug, token ?? null],
    queryFn: () => fetchTableBill({ slug, token: token! }),
    enabled: enabled && !!token,
    refetchInterval: live ? BILL_POLL_MS : false,
    retry: false,
  })
}
