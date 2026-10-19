"use client"

import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_ADMIN_SECTION,
  parseSectionHash,
  serializeSectionHash,
  type AdminSectionId,
} from "@/lib/admin/navigation"

function readHash(): AdminSectionId {
  if (typeof window === "undefined") return DEFAULT_ADMIN_SECTION
  return parseSectionHash(window.location.hash)
}

/**
 * The open admin section, mirrored in `window.location.hash`. Navigating
 * pushes a history entry, so reload and the back button keep the section.
 */
export function useHashSection(): [AdminSectionId, (id: AdminSectionId) => void] {
  const [section, setSection] = useState<AdminSectionId>(readHash)

  useEffect(() => {
    const sync = () => setSection(readHash())
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  const navigate = useCallback((id: AdminSectionId) => {
    setSection(id)
    const next = serializeSectionHash(id)
    if (window.location.hash !== next) window.location.hash = next
  }, [])

  return [section, navigate]
}
