"use client"

import type { ReactNode } from "react"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { summaryRows } from "@/lib/payments/register-summary"
import { differenceStatus } from "@/lib/payments/denominations"
import { Chip, Money } from "@/components/cashier/cashier-ui"
import { differenceText, pesos } from "@/components/printing/slip-format"

const Row = ({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) => (
  <div className={strong ? "flex justify-between gap-3 font-semibold" : "flex justify-between gap-3"}>
    <span>{label}</span>
    {children}
  </div>
)

/** Step 4 (caja-cierres S3): what the close stores and the slip prints. */
export function ConfirmStep({
  summary,
  counted,
  note,
  leftOpen,
}: {
  summary: RegisterSummary
  counted: number | null
  note: string
  /** Open orders passed to the next register, 0 when none. */
  leftOpen: number
}) {
  const difference = counted === null ? 0 : counted - summary.expectedCashAfterTips
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-fg">Esto queda guardado y sale en la tirilla de cierre de turno.</p>
      <div className="space-y-1 rounded-md border border-line p-3">
        <Row label="Fondo de caja"><Money>{pesos(summary.initialCash)}</Money></Row>
        {summaryRows(summary).map((method) => (
          <Row key={method.paymentMethodId} label={method.name}><Money>{pesos(method.total)}</Money></Row>
        ))}
        <Row label="Ventas" strong><Money>{pesos(summary.totalSales)}</Money></Row>
        <Row label="Propinas (aparte)"><Money>{pesos(summary.totalTips)}</Money></Row>
        <Row label="Entradas"><Money>{pesos(summary.cashDeposits)}</Money></Row>
        <Row label="Salidas"><Money>{pesos(-summary.cashWithdrawals)}</Money></Row>
        <Row label="Propinas a pagar en efectivo"><Money>{pesos(-summary.tipsPayout)}</Money></Row>
      </div>
      <div className="space-y-1 rounded-md border border-line p-3">
        <Row label="Esperado" strong><Money>{pesos(summary.expectedCashAfterTips)}</Money></Row>
        <Row label="Contado" strong><Money>{counted === null ? "Sin contar" : pesos(counted)}</Money></Row>
        {counted !== null && (
          <Row label="Diferencia">
            <Chip tone={differenceStatus(difference).tone}><Money>{differenceText(difference)}</Money></Chip>
          </Row>
        )}
        {difference !== 0 && note.trim() && <p className="text-muted-fg">Nota: {note.trim()}</p>}
        {leftOpen > 0 && <Row label="Órdenes dejadas a la siguiente caja"><span className="tabular-nums">{leftOpen}</span></Row>}
      </div>
    </div>
  )
}
