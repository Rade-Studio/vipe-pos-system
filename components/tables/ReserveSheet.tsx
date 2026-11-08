"use client"

import { useRef, useState, type FormEvent } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { STEP_SHEET_CLASS, StepHeader } from "@/components/voids/sheet"
import * as tablesApi from "@/lib/api/tables"
import type { TableDto } from "@/lib/api/tables"
import { NAME_MAX, reserveErrorMessage, validateReservation } from "@/lib/tables/reservation"
import { useToast } from "@/hooks/use-toast"

interface ReserveSheetProps {
  /** The free table to reserve; null keeps the sheet closed. */
  table: { id: string; number: number } | null
  onClose: () => void
  /** The reserved table as the API answers it; the caller closes the sheet. */
  onReserved: (table: TableDto) => void
}

/**
 * "Reservar mesa 7" (odd/tasks/reservas-mesas.md T2, S2, S3): the name the
 * table is held under and an optional arrival time today. The same sheet for
 * admin, caja and meseros; it is the step sheet of the voids and the PIN (a
 * bottom sheet on a phone, a dialog from 768 px).
 */
export function ReserveSheet({ table, onClose, onReserved }: ReserveSheetProps) {
  return (
    <DialogPrimitive.Root open={table !== null} onOpenChange={(next) => !next && onClose()}>
      {table && (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <ReserveForm key={table.id} table={table} onClose={onClose} onReserved={onReserved} />
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  )
}

function ReserveForm({ table, onClose, onReserved }: Omit<ReserveSheetProps, "table"> & { table: { id: string; number: number } }) {
  const { toast } = useToast()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [time, setTime] = useState("")
  const [error, setError] = useState<{ field: "name" | "time"; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const check = validateReservation({ name, time })
    if (!check.ok) {
      setError({ field: check.field, message: check.message })
      return
    }
    setError(null)
    setBusy(true)
    try {
      onReserved(await tablesApi.reserveTable(table.id, check.body))
    } catch (err) {
      toast({ title: "No se pudo reservar", description: reserveErrorMessage(err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const nameError = error?.field === "name" ? error.message : null
  const timeError = error?.field === "time" ? error.message : null
  return (
    <DialogPrimitive.Content
      aria-describedby={undefined}
      // The name is the one question: it takes the focus.
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        nameRef.current?.focus()
      }}
      className={STEP_SHEET_CLASS}
    >
      <StepHeader eyebrow="Reserva" title={`Reservar mesa ${table.number}`} />
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-2">
        <div className="grid gap-1.5">
          <Label htmlFor="reserve-name">¿A nombre de quién?</Label>
          <Input
            ref={nameRef}
            id="reserve-name"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "reserve-name-error" : undefined}
            className="min-h-11 text-base"
          />
          {nameError && (
            <p id="reserve-name-error" className="text-sm text-status-danger-fg">
              {nameError}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reserve-time">
            Hora de llegada <span className="font-normal text-muted-fg">(opcional, hoy)</span>
          </Label>
          <Input
            id="reserve-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeError ? "reserve-time-error" : undefined}
            className="min-h-11 text-base"
          />
          {timeError && (
            <p id="reserve-time-error" className="text-sm text-status-danger-fg">
              {timeError}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy}>
            Reservar
          </Button>
        </div>
      </form>
    </DialogPrimitive.Content>
  )
}
