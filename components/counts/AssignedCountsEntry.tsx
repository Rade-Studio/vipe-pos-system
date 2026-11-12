"use client"

import { useContext, useState } from "react"
import { QueryClientContext } from "@tanstack/react-query"
import { ClipboardCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useMyCounts } from "@/hooks/counts/use-counts"
import { MyCountsScreen } from "./MyCountsScreen"

/**
 * Entry to the counter screen for every role (S5): a button that appears only
 * while the person has a count to do, and opens the counts full screen.
 */
export function AssignedCountsEntry() {
  // Role views also render in isolation (tests, previews) without a query client.
  return useContext(QueryClientContext) ? <AssignedCountsButton /> : null
}

function AssignedCountsButton() {
  const counts = useMyCounts()
  const [open, setOpen] = useState(false)
  const pending = (counts.data ?? []).filter((c) => c.stage === "counting").length
  if (pending === 0 && !open) return null

  return (
    <>
      <Button variant="outline" className="mb-2 h-11 w-full justify-start gap-2 sm:w-auto" onClick={() => setOpen(true)}>
        <ClipboardCheck className="h-4 w-4" aria-hidden />
        Conteos asignados ({pending})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-dvh max-w-none overflow-y-auto p-0 sm:h-[90dvh] sm:max-w-lg">
          <DialogTitle className="sr-only">Conteos asignados</DialogTitle>
          <DialogDescription className="sr-only">Cuenta lo que hay en la bodega, sin ver el stock del sistema.</DialogDescription>
          <MyCountsScreen />
        </DialogContent>
      </Dialog>
    </>
  )
}
