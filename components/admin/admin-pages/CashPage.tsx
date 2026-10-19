"use client"

import { PageHeader } from "@/components/admin/common/PageHeader"
import { SectionHeader, segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { CashRegisterSummary } from "@/components/admin/CashRegisterSummary"
import { TransactionsByRegisterId } from "@/components/admin/TransactionsByRegisterId"
import { RegisterHistoryTable } from "@/components/cashier/RegisterHistoryTable"
import { DatePicker } from "@/components/ui/date-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface CashPageProps {
  description: string
  selectedDate: Date | undefined
  onDateChange: (date: Date | undefined) => void
  /** A row of the register history moves the page to that register's day. */
  onRegisterDate: (date: Date) => void
}

export function CashPage({ description, selectedDate, onDateChange, onRegisterDate }: CashPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Caja"
        description={description}
        actions={<DatePicker date={selectedDate} onDateChange={onDateChange} />}
      />

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className={segmentedListClass}>
          <TabsTrigger value="summary" className={segmentedTriggerClass}>
            Resumen
          </TabsTrigger>
          <TabsTrigger value="transactions" className={segmentedTriggerClass}>
            Transacciones
          </TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-0">
          <CashRegisterSummary selectedDate={selectedDate} />
        </TabsContent>
        <TabsContent value="transactions" className="mt-0">
          <TransactionsByRegisterId selectedDate={selectedDate} />
        </TabsContent>
      </Tabs>

      <section className="min-w-0 space-y-3">
        <SectionHeader title="Historial de aperturas de caja" description="Seleccione una caja para ver su día." />
        <RegisterHistoryTable changeRegisterDetails={onRegisterDate} />
      </section>
    </div>
  )
}
