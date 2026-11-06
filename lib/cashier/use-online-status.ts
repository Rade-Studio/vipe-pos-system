"use client"

import { useSyncExternalStore } from "react"

/**
 * The browser's own network flag (`navigator.onLine` + the `online` /
 * `offline` events). The cashier pauses charging while it is false so a
 * request that cannot reach the API is never retried into a double charge.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

const getSnapshot = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false)
const getServerSnapshot = () => true

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
