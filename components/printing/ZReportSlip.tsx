import type { CashZReport } from "@/lib/api/cash"
import { formatBusinessDay, zNumberLabel } from "@/lib/admin/cash"
import { differenceStatus } from "@/lib/payments/denominations"
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
  slipTime,
  type PaperMm,
  type SlipBusiness,
  type SlipLine,
  wrapText,
} from "./slip-format"

export interface ZReportSlipProps {
  business: SlipBusiness
  z: CashZReport
  printedAt: Date
  paperMm?: PaperMm
}

type VoidKind = CashZReport["snapshot"]["voids"]["items"][number]["kind"]
const VOID_LABEL: Record<VoidKind, string> = {
  item_void: "Platos anulados",
  payment_void: "Cobros anulados",
  order_cancellation: "Órdenes canceladas",
}

/** Title of the slip and of its print window: `Informe Z N.º 000214`. */
export const zReportTitle = (number: number) => `Informe Z N.º ${zNumberLabel(number)}`

/**
 * "Informe Z" (caja-cierres S8-S10, artboard 06 slip c): the numbered close
 * of a business day, printed from the stored snapshot, so a reprint shows
 * exactly what was emitted. Sales, the base and the tax (rate stored with
 * the Z) come first; tips are a block of their own after the methods, never
 * part of sales or the tax base. Gross sales and discounts print only when
 * the day had discounts.
 */
export function zReportLines({ business, z, printedAt, paperMm = 80 }: ZReportSlipProps): SlipLine[] {
  const width = slipChars(paperMm)
  const row = (left: string, right: string, bold = false): SlipLine => ({ text: padLine(left, right, width), bold })
  const { snapshot } = z
  const { totals, registers, taxes } = snapshot
  const openedAt = registers.map((r) => r.openedAt).sort()[0]
  const closedAt = registers
    .map((r) => r.closedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1)
  const voidKinds = (Object.keys(VOID_LABEL) as VoidKind[])
    .map((kind) => {
      const items = snapshot.voids.items.filter((item) => item.kind === kind)
      return { kind, count: items.length, amount: items.reduce((sum, item) => sum + item.amount, 0) }
    })
    .filter((group) => group.count > 0)
  const methods = totals.methods.filter((method) => method.total > 0 || method.count > 0)

  return [
    ...businessLines(business, width),
    ruleLine(width),
    { text: centerLine(zReportTitle(z.number).toUpperCase(), width), bold: true },
    { text: centerLine("Cierre del día de negocio", width) },
    { text: centerLine(formatBusinessDay(z.businessDay), width) },
    ruleLine(width),
    ...(openedAt ? [row("Horario", `${slipTime(new Date(openedAt))} – ${closedAt ? slipTime(new Date(closedAt)) : "—"}`)] : []),
    row("Turnos", String(registers.length)),
    row("Emitido", slipDateTime(new Date(z.emittedAt))),
    row("Emitido por", z.emittedBy?.name ?? "—"),
    row("Impreso", slipDateTime(printedAt)),
    ruleLine(width),
    { text: "Ventas", bold: true },
    ...(snapshot.discounts > 0
      ? [row("Ventas brutas", pesos(totals.salesNet + snapshot.discounts)), row("− Descuentos", pesos(snapshot.discounts))]
      : []),
    row("VENTAS NETAS", pesos(totals.salesNet), true),
    row("Base gravable", pesos(taxes.base)),
    row(`Impuesto (${taxes.rate} %)`, pesos(taxes.tax)),
    ...(snapshot.voids.count > 0
      ? [
          row(`Anulaciones (${snapshot.voids.count})`, pesos(snapshot.voids.amount)),
          ...voidKinds.map((group) => row(`   ${VOID_LABEL[group.kind]} (${group.count})`, pesos(group.amount))),
          { text: "   No suman a las ventas netas." },
        ]
      : []),
    row(`Domicilios (${totals.deliveries.count})`, pesos(totals.deliveries.amount)),
    row("Tiquetes", String(totals.tickets)),
    row("Ticket promedio", pesos(totals.avgTicket)),
    row("Mesas atendidas", String(totals.tables)),
    ...(snapshot.orders.first !== null && snapshot.orders.last !== null
      ? [row("Órdenes", `N.º ${snapshot.orders.first} a ${snapshot.orders.last}`)]
      : []),
    ruleLine(width),
    { text: "Métodos de pago", bold: true },
    ...methods.map((method) => row(`${method.name} (${method.count})`, pesos(method.total))),
    ruleLine(width),
    ...wrapText("Propinas (no son ingreso del restaurante)", width).map((text) => ({ text, bold: true })),
    ...wrapText("No suman a ventas ni al impuesto.", width).map((text) => ({ text })),
    ...(totals.tips === 0
      ? [{ text: "Sin propinas." }]
      : [
          { text: "Por método", bold: true },
          ...snapshot.tipsByMethod.map((tip) => row(tip.name, pesos(tip.amount))),
          { text: "Por mesero", bold: true },
          ...snapshot.tipsByWaiter.map((tip) => row(tip.name ?? "Sin mesero", pesos(tip.amount))),
        ]),
    row("Total propinas", pesos(totals.tips), true),
    ruleLine(width),
    { text: "Efectivo por turno", bold: true },
    ...registers.flatMap((register, index): SlipLine[] => {
      const counted = register.cashDifference !== null && register.countedCash !== null
      const status = counted ? differenceStatus(register.cashDifference ?? 0) : null
      return [
        { text: padLine(`T${index + 1} ${register.openedBy?.name ?? "Sin cajero"}`, "", width) },
        row("   Esperado", pesos(register.expected)),
        row("   Contado", counted ? pesos(register.countedCash ?? 0) : "—"),
        status
          ? row(`   ${status.label}`, status.kind === "even" ? pesos(0) : signedPesos(register.cashDifference ?? 0))
          : row("   Sin arqueo", "—"),
      ]
    }),
    row("Diferencia neta día", totals.difference === 0 ? pesos(0) : signedPesos(totals.difference), true),
    ruleLine(width),
    { text: "Z cerrado." },
    { text: "Los totales no se pueden editar." },
    { text: "" },
    { text: "" },
    { text: "_".repeat(Math.min(28, width)) },
    { text: "Administrador" },
    { text: z.emittedBy?.name ?? "" },
  ]
}

export function ZReportSlip(props: ZReportSlipProps) {
  return <SlipDocument label={zReportTitle(props.z.number)} lines={zReportLines(props)} paperMm={props.paperMm} />
}
