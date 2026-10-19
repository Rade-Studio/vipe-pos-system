"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SaveBarProps {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  message?: string
}

/** Sticky bar at the bottom of a settings page; rendered only while the page has unsaved changes. */
export function SaveBar({ dirty, saving = false, onSave, onDiscard, message = "Tienes cambios sin guardar" }: SaveBarProps) {
  if (!dirty) return null

  return (
    <div
      role="region"
      aria-label="Cambios sin guardar"
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onDiscard} disabled={saving}>
            Descartar
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  )
}
