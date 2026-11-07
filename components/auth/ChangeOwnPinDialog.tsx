"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { changeOwnPin, pinFailureOf } from "@/lib/api/auth"
import { newPinError } from "@/lib/terminal/pin"
import { PinField, PinFormError } from "./PinField"

interface ChangeOwnPinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "Carlos Pérez · Administrador" under the title. */
  who?: string
}

/**
 * Any staff member changes their own PIN after typing the current one (F4).
 * A wrong current PIN counts as a failed attempt on the API (5 lock it 5
 * minutes); the server's Spanish refusal is shown verbatim.
 */
export function ChangeOwnPinDialog({ open, onOpenChange, who }: ChangeOwnPinDialogProps) {
  const { toast } = useToast()
  const [current, setCurrent] = useState("")
  const [pin, setPin] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = (next: boolean) => {
    if (!next) {
      setCurrent("")
      setPin("")
      setAgain("")
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = async () => {
    const local = current.length < 4 ? "Escribe tu PIN actual" : newPinError(pin, again)
    if (local) {
      setError(local)
      return
    }
    setSaving(true)
    try {
      await changeOwnPin(current, pin)
      toast({ title: "PIN cambiado", description: "Usa el PIN nuevo desde ahora." })
      close(false)
    } catch (err) {
      setError(pinFailureOf(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[460px]">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar mi PIN</DialogTitle>
            <DialogDescription>
              {who ? `${who}. ` : ""}Lo usas para identificarte en la terminal y para autorizar anulaciones.
            </DialogDescription>
          </DialogHeader>
          <PinField label="PIN actual" value={current} onChange={setCurrent} autoFocus />
          <PinField label="PIN nuevo" value={pin} onChange={setPin} describedBy="own-pin-rules" invalid={!!error} />
          <p id="own-pin-rules" className="text-xs text-muted-foreground">
            De 4 a 6 dígitos. No uses 1111, 1234 ni 1212.
          </p>
          <PinField label="Repite el PIN nuevo" value={again} onChange={setAgain} invalid={!!error} />
          <PinFormError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving}>
              Cambiar PIN
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
