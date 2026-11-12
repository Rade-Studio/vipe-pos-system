"use client"

import { useState } from "react"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { CashDayView } from "@/components/admin/cash/CashDayView"
import { CashPeriodView } from "@/components/admin/cash/CashPeriodView"
import { Segmented } from "@/components/admin/cash/Segmented"
import { useBusinessDayCutoff } from "@/hooks/admin/use-cash"
import { businessDayFor } from "@/lib/admin/cash"

type CashView = "day" | "period"

interface CashPageProps {
  description: string
  /**
   * Kept for the admin shell; Caja picks its own business day (S5), so the
   * shell's calendar date is not used here.
   */
  selectedDate?: Date | undefined
  onDateChange?: (date: Date | undefined) => void
  onRegisterDate?: (date: Date) => void
}

/** Admin Caja (caja-cierres S6): Día (tablero + libro) and Período. */
export function CashPage({ description }: CashPageProps) {
  const cutoffHour = useBusinessDayCutoff()
  const today = businessDayFor(new Date(), cutoffHour)
  const [view, setView] = useState<CashView>("day")
  // null follows the current business day until the user picks one.
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const date = pickedDate ?? today

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Caja"
        description={description}
        actions={
          <Segmented
            label="Vista de caja"
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "Día" },
              { value: "period", label: "Período" },
            ]}
          />
        }
      />
      {view === "day" ? (
        <CashDayView date={date} today={today} onDateChange={setPickedDate} />
      ) : (
        <CashPeriodView
          today={today}
          onOpenDay={(day) => {
            setPickedDate(day)
            setView("day")
          }}
        />
      )}
    </div>
  )
}
