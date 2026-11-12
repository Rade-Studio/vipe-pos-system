/**
 * lib/cashier/discounts.ts
 *
 * S13 (design/promociones/03 panel 2): the cashier's bill with its discounts.
 * Pure: the server's orders (`GET /orders/:id`, list price per line and every
 * discount as its own record) come in, the rows the order detail renders come
 * out. Every amount is the server's; nothing here recomputes a discount.
 *
 * Also the rules of the "Agregar cortesía o descuento" sheet: which
 * promotions the cashier can apply, when a PIN is needed and the body of
 * POST /orders/:id/discounts.
 */
import type { AddOrderDiscountBody } from "@/lib/api/discounts"
import type { PromotionDto } from "@/lib/api/catalog"
import type { OrderDiscountDto, OrderDto } from "@/lib/api/orders"
import type { OrderItemModifier } from "@/types"
import type { CashierOrder } from "./orders"
import { clockTime } from "./queue"

/** One order as the bill reads it: from `GET /orders/:id` or from the cashier list (both the API's `Order`). */
export interface BillOrderInput {
  id: string
  items: {
    id: string
    name: string
    price: number
    quantity: number
    comments?: string | null
    modifiers?: OrderItemModifier[]
    addedAt?: Date | string | null
  }[]
  discounts: readonly OrderDiscountDto[]
  grossSubtotal: number
  totalDiscounts: number
  subtotal: number
  tax: number
  taxPercentage: number
  tip: number
  total: number
}

export function billInputFromDto(dto: OrderDto): BillOrderInput {
  return {
    id: dto.id,
    items: dto.items.map((item) => ({ ...item, addedAt: item.addedAt ?? item.createdAt ?? null })),
    discounts: dto.discounts,
    grossSubtotal: dto.grossSubtotal,
    totalDiscounts: dto.totalDiscounts,
    subtotal: dto.subtotal,
    tax: dto.tax,
    taxPercentage: dto.taxPercentage,
    tip: dto.tip,
    total: dto.total,
  }
}

/**
 * The cashier list's order, when its discount records match its bill (the
 * list read carries them; a realtime patch can change the bill without them).
 * Null means the records are stale: read the order again.
 */
export function billInputFromCashierOrder(order: CashierOrder): BillOrderInput | null {
  const discounts = order.discounts ?? []
  const totalDiscounts = order.bill.totalDiscounts ?? 0
  if (discounts.reduce((sum, discount) => sum + discount.amount, 0) !== totalDiscounts) return null
  return {
    id: order.id,
    items: order.items,
    discounts,
    grossSubtotal: order.grossSubtotal ?? order.bill.subtotal + totalDiscounts,
    totalDiscounts,
    subtotal: order.bill.subtotal,
    tax: order.bill.tax,
    taxPercentage: order.bill.taxPercentage,
    tip: order.bill.tip,
    total: order.bill.total,
  }
}

export interface CashierDiscountLine {
  id: string
  orderId: string
  label: string
  amount: number
  /** "fijado 18:10" for an automatic one, "Paula R. · PIN" for a manual one. */
  note: string
  /** Manual discounts can be removed by the cashier (same authorization rule). */
  manual: boolean
  promotionId: string | null
}

export interface CashierBillLine {
  key: string
  orderId: string
  itemId: string
  name: string
  quantity: number
  /** Unit list price, options included. */
  unitPrice: number
  /** unitPrice × quantity, at list price. */
  total: number
  comments: string | null
  modifiers: OrderItemModifier[]
  discounts: CashierDiscountLine[]
}

export interface CashierBill {
  lines: CashierBillLine[]
  /** Discounts on the whole bill (no line). */
  billDiscounts: CashierDiscountLine[]
  /** "Subtotal (precio de lista)". */
  grossSubtotal: number
  /** One row per discount label, in the order they first appear. */
  discountRows: { label: string; amount: number }[]
  totalDiscounts: number
  /** The net base the tax is computed on. */
  subtotal: number
  tax: number
  /** The rate when every order shares it; null when they differ. */
  taxPercentage: number | null
  tip: number
  total: number
}

/** "Paula Rodríguez" → "Paula R.". */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ""
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`
}

function discountNote(discount: OrderDiscountDto, addedAt: Date | string | null, noPin: boolean): string {
  if (discount.source === "manual") {
    const name = discount.authorizedBy?.name
    if (!name) return ""
    return noPin ? shortName(name) : `${shortName(name)} · PIN`
  }
  return addedAt ? `fijado ${clockTime(new Date(addedAt))}` : ""
}

export function cashierBill(
  orders: readonly BillOrderInput[],
  options: { noPinPromotionIds?: ReadonlySet<string> } = {},
): CashierBill {
  const noPin = options.noPinPromotionIds ?? new Set<string>()
  const lines: CashierBillLine[] = []
  const billDiscounts: CashierDiscountLine[] = []
  const rows = new Map<string, number>()

  for (const order of orders) {
    const addedAt = new Map(order.items.map((item) => [item.id, item.addedAt ?? null] as const))
    const byItem = new Map<string, CashierDiscountLine[]>()
    for (const discount of order.discounts) {
      const line: CashierDiscountLine = {
        id: discount.id,
        orderId: order.id,
        label: discount.label,
        amount: discount.amount,
        note: discountNote(
          discount,
          discount.orderItemId ? (addedAt.get(discount.orderItemId) ?? null) : null,
          discount.promotionId !== null && noPin.has(discount.promotionId),
        ),
        manual: discount.source === "manual",
        promotionId: discount.promotionId,
      }
      rows.set(discount.label, (rows.get(discount.label) ?? 0) + discount.amount)
      if (discount.orderItemId && addedAt.has(discount.orderItemId)) {
        byItem.set(discount.orderItemId, [...(byItem.get(discount.orderItemId) ?? []), line])
      } else billDiscounts.push(line)
    }
    for (const item of order.items) {
      lines.push({
        key: `${order.id}:${item.id}`,
        orderId: order.id,
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        total: item.price * item.quantity,
        comments: item.comments ?? null,
        modifiers: item.modifiers ?? [],
        discounts: byItem.get(item.id) ?? [],
      })
    }
  }

  const rates = new Set(orders.map((order) => order.taxPercentage))
  const sum = (pick: (order: BillOrderInput) => number) => orders.reduce((total, order) => total + pick(order), 0)
  return {
    lines,
    billDiscounts,
    grossSubtotal: sum((order) => order.grossSubtotal),
    discountRows: [...rows].map(([label, amount]) => ({ label, amount })),
    totalDiscounts: sum((order) => order.totalDiscounts),
    subtotal: sum((order) => order.subtotal),
    tax: sum((order) => order.tax),
    taxPercentage: rates.size === 1 ? [...rates][0]! : null,
    tip: sum((order) => order.tip || 0),
    total: sum((order) => order.total),
  }
}

/* --------------------------------------------- "Agregar cortesía o descuento" */

/** The promotions the cashier applies by hand: active, manual or manual_pin, per product or per bill. */
export function manualPromotions(promotions: readonly PromotionDto[]): PromotionDto[] {
  return promotions.filter(
    (promotion) =>
      promotion.active &&
      (promotion.mode === "manual" || promotion.mode === "manual_pin") &&
      (promotion.kind === "product_discount" || promotion.kind === "bill_discount"),
  )
}

export type FreeDiscountType = "percentage" | "fixed_amount"

export type DiscountChoice =
  | { type: "promotion"; promotion: PromotionDto }
  | { type: "free"; discountType: FreeDiscountType; value: number }

/** A `manual` promotion needs no PIN; a `manual_pin` one and a free discount do (S7). */
export function needsPin(choice: DiscountChoice): boolean {
  return choice.type === "free" || choice.promotion.mode !== "manual"
}

/** Same bounds as the API: 3 to 200 characters once trimmed. */
export function reasonError(text: string): string | null {
  const value = text.trim()
  if (value.length === 0) return "Escribe el motivo."
  if (value.length < 3) return "Escribe al menos 3 letras."
  if (value.length > 200) return "Máximo 200 caracteres."
  return null
}

export function freeValueError(type: FreeDiscountType, value: number): string | null {
  if (type === "percentage") {
    return Number.isInteger(value) && value >= 1 && value <= 100 ? null : "Escribe un porcentaje de 1 a 100."
  }
  return Number.isInteger(value) && value > 0 ? null : "Escribe un valor mayor que cero."
}

/** The body of POST /orders/:id/discounts; `itemId` null = "Toda la cuenta". */
export function discountBody(
  choice: DiscountChoice,
  itemId: string | null,
  reason: string,
  authorizationId?: string,
): AddOrderDiscountBody {
  return {
    ...(choice.type === "promotion"
      ? { promotionId: choice.promotion.id }
      : { discountType: choice.discountType, discountValue: choice.value }),
    ...(itemId ? { orderItemId: itemId } : {}),
    reason: reason.trim(),
    ...(authorizationId ? { authorizationId } : {}),
  }
}
