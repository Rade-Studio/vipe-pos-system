import { deliveryOf, type RegisterDeliverySummary } from "@/lib/payments/register-summary"
import { padLine, pesos, ruleLine, type SlipLine } from "./slip-format"

/**
 * H-080 (S3): "Domicilios" apart from the food sales and, per courier, the
 * cash they bring and the fees to pay them. Nothing for a shift or day
 * without deliveries, or a Z stored before the block existed.
 */
export function deliverySlipLines(source: { delivery?: RegisterDeliverySummary }, width: number): SlipLine[] {
  const delivery = deliveryOf(source)
  if (!delivery) return []
  const row = (left: string, right: string): SlipLine => ({ text: padLine(left, right, width) })
  return [
    ruleLine(width),
    { text: "Domicilios", bold: true },
    row("Ventas de comida", pesos(delivery.foodBilled)),
    row(`Tarifas de domicilio (${delivery.ordersCount})`, pesos(delivery.fees)),
    ...delivery.couriers.flatMap((courier): SlipLine[] => [
      { text: padLine(`${courier.name ?? "Sin repartidor"} (${courier.ordersCount})`, "", width) },
      row("   Efectivo que trae", pesos(courier.cashCollected)),
      row("   Tarifas a pagar", pesos(courier.feesOwed)),
    ]),
  ]
}
