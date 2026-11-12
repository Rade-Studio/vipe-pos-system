"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useCashDay, useCashLedger, useValidateRegister } from "@/hooks/admin/use-cash"
import type { CashDay } from "@/lib/api/cash"
import { formatBusinessDay, formatTime, shiftDay } from "@/lib/admin/cash"
import { CashDayBoard } from "./CashDayBoard"
import { CashLedgerView } from "./CashLedgerView"
import { Segmented } from "./Segmented"

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
