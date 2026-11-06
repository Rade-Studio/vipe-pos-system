"use client"

import { useEffect, useState } from "react"
import { realtimeService } from "@/lib/api/realtime"
import { Chip } from "./cashier-ui"

/**
 * "En vivo" / "Sin conexión" (T24): the realtime socket state. Until the
 * first connect it reads "Conectando…", so a fresh load never flashes an
 * outage.
 */
export function LivePill() {
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting")
  useEffect(
    () =>
      realtimeService.subscribeToConnectionStatus((connected) =>
        setState((prev) => (connected ? "live" : prev === "connecting" ? "connecting" : "offline")),
      ),
    [],
  )
  return (
    <span role="status" className="inline-flex">
      <Chip tone={state === "live" ? "ok" : state === "offline" ? "danger" : "reserved"} dot>
        {state === "live" ? "En vivo" : state === "offline" ? "Sin conexión" : "Conectando…"}
      </Chip>
    </span>
  )
}
