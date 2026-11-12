import type { CashMovement } from "@/lib/api/registers"
import { CASH_MOVEMENT_REASONS } from "@/lib/api/registers"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { BILL_VALUES, denominationSubtotal, differenceStatus } from "@/lib/payments/denominations"
import { cashSalesOf, methodLines } from "./XReportSlip"
import {
  SlipDocument,
  businessLines,
  centerLine,
  padLine,
  pesos,
  ruleLine,
  signedPesos,
  slipChars,
  slipDateTime,
  type PaperMm,
  type SlipBusiness,
  type SlipLine,
  wrapText,
} from "./slip-format"

export interface ShiftCloseSlipProps {
  business: SlipBusiness
  cashierName: string | null
  closedByName: string | null
  openedAt: Date
  /** Null on the preview printed before the close. */
  closedAt: Date | null
  summary: RegisterSummary
  movements: readonly CashMovement[]
  countedCash: number
  difference: number
  note: string | null
  denominations: readonly { value: number; quantity: number }[] | null
  preview?: boolean
  paperMm?: PaperMm
}

const reasonLabel = (movement: CashMovement) =>
  CASH_MOVEMENT_REASONS.find((reason) => reason.value === movement.reason)?.label ?? (movement.description || "Sin motivo")

/** Movements of one type, totalled per reason, indented under their line. */
function movementDetail(movements: readonly CashMovement[], type: CashMovement["type"], width: number): SlipLine[] {
  const totals = new Map<string, number>()
  for (const movement of movements) {
    if (movement.type !== type) continue
    const label = reasonLabel(movement)
    totals.set(label, (totals.get(label) ?? 0) + movement.amount)
  }
  return [...totals].map(([label, amount]) => ({ text: padLine(`   ${label}`, pesos(amount), width) }))
}

/**
 * "Cierre de turno" (caja-cierres S4): the shift's cash, the arqueo by
 * denomination, expected, counted and difference, the note and the signature
 * lines. The preview (before closing) is marked "VISTA PREVIA".
 */
export function shiftCloseLines(props: ShiftCloseSlipProps): SlipLine[] {
  const { business, summary, denominations, paperMm = 80 } = props
  const width = slipChars(paperMm)
  const row = (left: string, right: string, bold = false): SlipLine => ({ text: padLine(left, right, width), bold })
  const status = differenceStatus(props.difference)
  const counted = (denominations ?? []).filter((row) => row.quantity > 0)
  const bills = counted.filter((row) => (BILL_VALUES as readonly number[]).includes(row.value))
  const coins = counted.filter((row) => !(BILL_VALUES as readonly number[]).includes(row.value))
  const arqueo = (title: string, rows: typeof counted): SlipLine[] =>
    rows.length === 0
      ? []
      : [
          { text: title, bold: true },
          ...rows.map((r) => row(`${pesos(r.value)} × ${r.quantity}`, pesos(denominationSubtotal(r.value, r.quantity)))),
          row(`Total ${title.toLowerCase()}`, pesos(rows.reduce((sum, r) => sum + denominationSubtotal(r.value, r.quantity), 0))),
        ]
  const signature = (role: string): SlipLine[] => [{ text: "" }, { text: "" }, { text: "_".repeat(Math.min(28, width)) }, { text: role }]

  return [
    ...businessLines(business, width),
    ruleLine(width),
    { text: centerLine("CIERRE DE TURNO", width), bold: true },
    { text: centerLine("Arqueo de caja", width) },
    ...(props.preview ? [{ text: centerLine("VISTA PREVIA", width), bold: true }] : []),
    ruleLine(width),
    row("Cajero", props.cashierName ?? "—"),
    row("Apertura", slipDateTime(props.openedAt)),
    row("Cierre", props.closedAt ? slipDateTime(props.closedAt) : "—"),
    ...(props.closedByName ? [row("Cerró", props.closedByName)] : []),
    ruleLine(width),
    { text: "Ventas por método", bold: true },
    ...methodLines(summary, width),
    row("Ventas netas turno", pesos(summary.totalSales), true),
    row("Tiquetes", String(summary.paymentsCount)),
    row("Propinas (aparte)", pesos(summary.totalTips)),
    ruleLine(width),
    { text: "Cuadre de efectivo", bold: true },
    row("Fondo de caja", pesos(summary.initialCash)),
    row("+ Ventas en efectivo", pesos(cashSalesOf(summary))),
    ...(summary.totalChange > 0 ? [row("− Cambio entregado", pesos(summary.totalChange))] : []),
    row("+ Entradas", pesos(summary.cashDeposits)),
    ...movementDetail(props.movements, "deposit", width),
    row("− Salidas", pesos(summary.cashWithdrawals)),
    ...movementDetail(props.movements, "withdrawal", width),
    row("− Propinas pagadas", pesos(summary.tipsPayout)),
    row("Esperado", pesos(summary.expectedCashAfterTips), true),
    ...(counted.length > 0 ? [ruleLine(width), ...arqueo("Billetes", bills), ...arqueo("Monedas", coins)] : []),
    ruleLine(width),
    row("Contado", pesos(props.countedCash), true),
    row(status.label.toUpperCase(), status.kind === "even" ? pesos(0) : signedPesos(props.difference), true),
    ...(props.note ? wrapText(`Nota: ${props.note}`, width).map((text) => ({ text })) : []),
    ruleLine(width),
    ...signature("Cajero"),
    ...signature("Supervisor"),
  ]
}

export function ShiftCloseSlip(props: ShiftCloseSlipProps) {
  return <SlipDocument label="Cierre de turno" lines={shiftCloseLines(props)} paperMm={props.paperMm} />
}
