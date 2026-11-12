import type { RegisterSummary } from "@/lib/payments/register-summary"
import {
  SlipDocument,
  businessLines,
  centerLine,
  padLine,
  pesos,
  ruleLine,
  slipChars,
  slipDateTime,
  type PaperMm,
  type SlipBusiness,
  type SlipLine,
} from "./slip-format"

export interface XReportSlipProps {
  business: SlipBusiness
  cashierName: string | null
  openedAt: Date
  printedAt: Date
  summary: RegisterSummary
  paperMm?: PaperMm
}

/** Cash tendered in the shift: the catalog's cash methods. */
export const cashSalesOf = (summary: RegisterSummary): number =>
  summary.methods.filter((method) => method.kind === "cash").reduce((sum, method) => sum + method.total, 0)

/** "Efectivo (15)  $ 584.000" per method with sales or still active. */
export function methodLines(summary: RegisterSummary, width: number): SlipLine[] {
  return summary.methods
    .filter((method) => method.total > 0 || method.isActive)
    .map((method) => ({ text: padLine(`${method.name} (${method.tendersCount})`, pesos(method.total), width) }))
}

/**
 * "Informe X" (caja-cierres S4): a partial summary of the open shift. It
 * prints any time and resets nothing; tips are shown apart.
 */
export function xReportLines({ business, cashierName, openedAt, printedAt, summary, paperMm = 80 }: XReportSlipProps): SlipLine[] {
  const width = slipChars(paperMm)
  const row = (left: string, right: string, bold = false): SlipLine => ({ text: padLine(left, right, width), bold })
  return [
    ...businessLines(business, width),
    ruleLine(width),
    { text: centerLine("INFORME X", width), bold: true },
    { text: centerLine("Parcial · No reinicia contadores", width) },
    ruleLine(width),
    row("Cajero", cashierName ?? "—"),
    row("Abierto", slipDateTime(openedAt)),
    row("Impreso", slipDateTime(printedAt)),
    ruleLine(width),
    { text: "Ventas por método", bold: true },
    ...methodLines(summary, width),
    row("Ventas", pesos(summary.totalSales), true),
    row("Tiquetes", String(summary.paymentsCount)),
    ruleLine(width),
    { text: "Efectivo en caja", bold: true },
    row("Fondo de caja", pesos(summary.initialCash)),
    row("+ Ventas en efectivo", pesos(cashSalesOf(summary))),
    ...(summary.totalChange > 0 ? [row("− Cambio entregado", pesos(summary.totalChange))] : []),
    row("+ Entradas", pesos(summary.cashDeposits)),
    row("− Salidas", pesos(summary.cashWithdrawals)),
    row("Esperado ahora", pesos(summary.expectedCash), true),
    ruleLine(width),
    row("Propinas (aparte)", pesos(summary.totalTips)),
    { text: "No son ingreso del restaurante." },
    ruleLine(width),
    { text: centerLine("Este informe no cierra el turno.", width) },
  ]
}

export function XReportSlip(props: XReportSlipProps) {
  return <SlipDocument label="Informe X" lines={xReportLines(props)} paperMm={props.paperMm} />
}
