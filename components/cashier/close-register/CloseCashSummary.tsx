"use client"

import type { ReactNode } from "react"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { summaryRows } from "@/lib/payments/register-summary"
import { Money } from "@/components/cashier/cashier-ui"
import { pesos } from "@/components/printing/slip-format"

const Row = ({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) => (
  <li className={strong ? "flex justify-between gap-3 border-t border-line pt-1 font-semibold" : "flex justify-between gap-3"}>
    <span>{label}</span>
    {children}
  </li>
)

function Block({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  const id = `close-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section aria-labelledby={id} className="space-y-1 rounded-md border border-line p-3 text-sm">
      <h4 id={id} className="font-medium">
        {title}
      </h4>
      <ul className="space-y-1">{children}</ul>
      {note}
    </section>
  )
}

/**
 * H-063: the close summary the cashier can add up. The cash list sums to
 * "Efectivo esperado" (initial + cash sales + deposits − withdrawals, the
 * server's `expected_cash`); cash sales are the cash tenders, change already
 * netted. Electronic methods have their own block, and one sales total
 * ("Total cobrado") is explained as sales plus tips and as cash plus
 * electronic.
 */
export function CloseCashSummary({ summary }: { summary: RegisterSummary }) {
  const methods = summaryRows(summary)
  const cashSales = summary.methods.filter((m) => m.kind === "cash").reduce((sum, m) => sum + m.total, 0)
  const electronic = methods.filter((m) => m.kind === "electronic")
  const electronicTotal = summary.methods.filter((m) => m.kind === "electronic").reduce((sum, m) => sum + m.total, 0)

  return (
    <div className="space-y-3">
      <Block
        title="Efectivo en caja"
        note={
          summary.totalChange > 0 && (
            <p className="text-xs text-muted-fg">
              Las ventas en efectivo ya descuentan {pesos(summary.totalChange)} de cambio entregado.
            </p>
          )
        }
      >
        <Row label="Efectivo inicial"><Money>{pesos(summary.initialCash)}</Money></Row>
        <Row label="+ Ventas en efectivo"><Money>{pesos(cashSales)}</Money></Row>
        <Row label="+ Ingresos de efectivo"><Money>{pesos(summary.cashDeposits)}</Money></Row>
        <Row label="− Retiros de efectivo"><Money>{pesos(summary.cashWithdrawals)}</Money></Row>
        <Row label="= Efectivo esperado" strong><Money>{pesos(summary.expectedCash)}</Money></Row>
        <Row label="− Propinas a entregar a meseros"><Money>{pesos(summary.tipsPayout)}</Money></Row>
        <Row label="= Efectivo esperado después de propinas" strong><Money>{pesos(summary.expectedCashAfterTips)}</Money></Row>
      </Block>

      {electronic.length > 0 && (
        <Block title="Pagos electrónicos">
          {electronic.map((m) => (
            <Row key={m.paymentMethodId} label={m.name}><Money>{pesos(m.total)}</Money></Row>
          ))}
          <Row label="Total electrónico" strong><Money>{pesos(electronicTotal)}</Money></Row>
        </Block>
      )}

      <Block
        title="Ventas del turno"
        note={
          <p className="text-xs text-muted-fg">
            Efectivo {pesos(cashSales)} + electrónicos {pesos(electronicTotal)} = {pesos(summary.totalSales)}
          </p>
        }
      >
        <Row label="Ventas sin propina"><Money>{pesos(summary.totalBilled)}</Money></Row>
        <Row label="+ Propinas"><Money>{pesos(summary.totalTips)}</Money></Row>
        <Row label="= Total cobrado" strong><Money>{pesos(summary.totalSales)}</Money></Row>
        <Row label="Cuentas pagadas"><span className="tabular-nums">{summary.paymentsCount}</span></Row>
      </Block>
    </div>
  )
}
