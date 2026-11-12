"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, Printer } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useCashDay, useCashLedger, useEmitZReport, useValidateRegister } from "@/hooks/admin/use-cash"
import type { CashDay } from "@/lib/api/cash"
import { ApiError } from "@/lib/api/errors"
import { formatBusinessDay, formatTime, shiftDay, zNumberLabel } from "@/lib/admin/cash"
import { CashDayBoard } from "./CashDayBoard"
import { CashLedgerView } from "./CashLedgerView"
import { Segmented } from "./Segmented"
import { usePrintZ } from "./use-print-z"

type DayTab = "board" | "ledger"

interface DayPickerProps {
  date: string
  today: string
  onChange: (date: string) => void
}

export function DayPicker({ date, today, onChange }: DayPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" className="size-11" aria-label="Día anterior" onClick={() => onChange(shiftDay(date, -1))}>
        <ChevronLeft aria-hidden />
      </Button>
      <label className="sr-only" htmlFor="cash-day">
        Elegir día
      </label>
      <Input
        id="cash-day"
        type="date"
        className="h-11 w-auto"
        value={date}
        max={today}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        aria-label="Día siguiente"
        disabled={date >= today}
        onClick={() => onChange(shiftDay(date, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
      <Button variant="outline" className="min-h-11" disabled={date === today} onClick={() => onChange(today)}>
        Hoy
      </Button>
    </div>
  )
}

function StatusLine({ day }: { day: CashDay }) {
  const open = day.registers.find((register) => register.status === "open")
  if (open) {
    return (
      <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        Turno abierto: {open.openedBy?.name ?? "Sin cajero"}, desde las {formatTime(open.openedAt)}. Las cifras se actualizan con cada cobro.
      </p>
    )
  }
  const pending = day.registers.filter((register) => !register.validatedBy).length
  return (
    <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      Día cerrado · {day.registers.length} {day.registers.length === 1 ? "turno" : "turnos"}
      {pending > 0 ? ` · ${pending} por validar` : " · todos validados"}
    </p>
  )
}

/**
 * Informe Z of the day (S8): "Emitir informe Z" once every turno closed,
 * after a confirmation (it numbers the day and cannot be undone); then the
 * Z number, who emitted it and when, with "Reimprimir Z".
 */
function ZReportBar({ date, day }: { date: string; day: CashDay }) {
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const emit = useEmitZReport(date)
  const { print, reprint, printing } = usePrintZ()

  if (day.z) {
    const z = day.z
    return (
      <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium">
          {`Z N.º ${zNumberLabel(z.number)} emitido · por ${z.emittedBy?.name ?? "—"} · ${formatTime(z.emittedAt)}`}
        </p>
        <Button variant="outline" className="min-h-11" onClick={() => void reprint(z.number)} disabled={printing === z.number}>
          {printing === z.number ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
          Reimprimir Z
        </Button>
      </div>
    )
  }

  const closed = day.status === "closed"
  const onConfirm = () =>
    emit.mutate(undefined, {
      onSuccess: (z) => {
        setConfirming(false)
        toast({ title: `Informe Z N.º ${zNumberLabel(z.number)} emitido` })
        print(z)
      },
      onError: (error) => {
        setConfirming(false)
        toast({
          title: "No se pudo emitir el informe Z",
          description: error instanceof ApiError ? error.message : "Intenta nuevamente.",
          variant: "destructive",
        })
      },
    })

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {closed ? "Informe Z sin emitir." : "Cierra todos los turnos del día para emitir el informe Z."}
      </p>
      <Button className="min-h-11" disabled={!closed || emit.isPending} onClick={() => setConfirming(true)}>
        Emitir informe Z
      </Button>
      <AlertDialog open={confirming} onOpenChange={(open) => !emit.isPending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Emitir el informe Z del día?</AlertDialogTitle>
            <AlertDialogDescription>
              El informe Z cierra el {formatBusinessDay(date)}: le da el siguiente número consecutivo y guarda sus totales tal como están.
              Esta acción no se puede deshacer; después solo se puede reimprimir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={emit.isPending}>
              Cancelar
            </AlertDialogCancel>
            <Button className="min-h-11" onClick={onConfirm} disabled={emit.isPending}>
              {emit.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Emitir informe Z
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface CashDayViewProps {
  date: string
  today: string
  onDateChange: (date: string) => void
}

export function CashDayView({ date, today, onDateChange }: CashDayViewProps) {
  const [tab, setTab] = useState<DayTab>("board")
  const { toast } = useToast()
  const dayQuery = useCashDay(date)
  const ledgerQuery = useCashLedger(date, tab === "ledger")
  const validate = useValidateRegister(date)
  const day = dayQuery.data

  const onValidate = (id: string) =>
    validate.mutate(id, {
      onSuccess: () => toast({ title: "Turno validado" }),
      onError: () => toast({ title: "Error", description: "No se pudo validar el turno. Intenta nuevamente.", variant: "destructive" }),
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DayPicker date={date} today={today} onChange={onDateChange} />
        <p className="text-sm font-medium">{formatBusinessDay(date)}</p>
      </div>

      {dayQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando el día">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : dayQuery.isError || !day ? (
        <EmptyState
          title="No se pudo cargar la caja del día"
          description="Revisa la conexión e intenta de nuevo."
          action={
            <Button variant="outline" className="min-h-11" onClick={() => void dayQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : day.status === "empty" ? (
        <EmptyState title="Sin movimientos este día" description="Ningún turno de caja abrió en este día de negocio." />
      ) : (
        <>
          <StatusLine day={day} />
          <ZReportBar date={date} day={day} />
          <Segmented
            label="Vista del día"
            value={tab}
            onChange={setTab}
            options={[
              { value: "board", label: "Tablero" },
              { value: "ledger", label: "Libro" },
            ]}
          />
          {tab === "board" ? (
            <CashDayBoard day={day} validatingId={validate.isPending ? (validate.variables ?? null) : null} onValidate={onValidate} />
          ) : (
            <CashLedgerView day={day} ledger={ledgerQuery.data} isLoading={ledgerQuery.isLoading} />
          )}
        </>
      )}
    </div>
  )
}
