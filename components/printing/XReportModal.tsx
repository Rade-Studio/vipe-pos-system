"use client"

import type { ReactNode } from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { XReportSlip, cashSalesOf, type XReportSlipProps } from "./XReportSlip"
import { pesos, printSlip, slipDateTime } from "./slip-format"
import { taxBreakdown, taxLabel } from "./tax-label"

export type XReportData = Omit<XReportSlipProps, "paperMm">

interface XReportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: XReportData | null
  /** The browser blocked the print window of "Imprimir". */
  onPrintBlocked?: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="space-y-1">{children}</dl>
    </section>
  )
}

function Row({ label, value, strong = false }: { label: ReactNode; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 text-sm", strong && "border-t pt-1.5 text-base font-semibold")}>
      <dt className="min-w-0 truncate">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * "Informe X" on screen (informe-x-termico S2): the same data as the slip,
 * read from the register summary as the server answered it. "Imprimir"
 * prints the browser slip; nothing prints until the cashier asks.
 */
export function XReportModal({ open, onOpenChange, report, onPrintBlocked }: XReportModalProps) {
  if (!report) return null
  const { business, cashierName, openedAt, printedAt, summary, tax } = report
  const methods = summary.methods.filter((method) => method.total > 0 || method.isActive)
  const taxes = tax ? taxBreakdown(summary.totalSales, tax.rate) : null

  const print = () => {
    if (!printSlip(<XReportSlip {...report} />, { title: "Informe X" })) onPrintBlocked?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Informe X · parcial</DialogTitle>
          <DialogDescription>
            {business.name}
            {business.nit ? ` · NIT ${business.nit}` : ""} · No reinicia contadores
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Section title="Turno">
            <Row label="Cajero" value={cashierName ?? "—"} />
            <Row label="Abierto" value={slipDateTime(openedAt)} />
            <Row label="Impreso" value={slipDateTime(printedAt)} />
          </Section>

          <Section title="Ventas por método">
            {methods.map((method) => (
              <Row
                key={method.paymentMethodId}
                label={
                  <>
                    {method.name} <span className="text-muted-foreground">({method.tendersCount})</span>
                  </>
                }
                value={pesos(method.total)}
              />
            ))}
            <Row label="Ventas" value={pesos(summary.totalSales)} strong />
            {tax && taxes && (
              <>
                <Row label="Base" value={pesos(taxes.base)} />
                <Row label={taxLabel(tax.type, tax.rate)} value={pesos(taxes.tax)} />
              </>
            )}
            <Row label="Tiquetes" value={String(summary.paymentsCount)} />
          </Section>

          <Section title="Efectivo en caja">
            <Row label="Fondo de caja" value={pesos(summary.initialCash)} />
            <Row label="+ Ventas en efectivo" value={pesos(cashSalesOf(summary))} />
            {summary.totalChange > 0 && <Row label="− Cambio entregado" value={pesos(summary.totalChange)} />}
            <Row label="+ Entradas" value={pesos(summary.cashDeposits)} />
            <Row label="− Salidas" value={pesos(summary.cashWithdrawals)} />
            <Row label="Esperado ahora" value={pesos(summary.expectedCash)} strong />
          </Section>

          <Section title="Propinas">
            <Row label="Propinas (aparte)" value={pesos(summary.totalTips)} />
            <p className="text-xs text-muted-foreground">No son ingreso del restaurante.</p>
          </Section>

          <p className="rounded-md bg-muted px-3 py-2 text-center text-sm font-medium">Este informe no cierra el turno.</p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={print}>
            <Printer aria-hidden="true" className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <DialogClose asChild>
            <Button type="button">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
