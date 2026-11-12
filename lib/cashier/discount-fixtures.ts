import type { PromotionDto } from "@/lib/api/catalog"
import type { OrderDiscountDto, OrderDto, OrderItemDto } from "@/lib/api/orders"

/**
 * Test fixtures of design/promociones/03 panel 2 (Mesa 7): two Mojitos and a
 * Margarita at 18:10 with the happy hour 2x1, and a birthday courtesy on the
 * Tres leches authorized by Paula R. Times are local, as the screen shows them.
 */

const at = (hours: number, minutes: number) => new Date(2026, 10, 12, hours, minutes).toISOString()

function item(id: string, name: string, price: number, quantity: number, addedAt: string, orderId: string): OrderItemDto {
  return {
    id,
    orderId,
    dishId: `dish-${id}`,
    name,
    price,
    quantity,
    comments: null,
    status: "kitchen",
    stationId: null,
    stationSource: null,
    addedAt,
    createdAt: addedAt,
    updatedAt: addedAt,
    modifiers: [],
    discounts: [],
    promotionId: null,
    promotionName: null,
    comboId: null,
  }
}

export function mesa7(overrides: { id?: string } = {}): OrderDto {
  const id = overrides.id ?? "o-1"
  const items = [
    item(`${id}-mojito`, "Mojito", 24000, 2, at(18, 10), id),
    item(`${id}-margarita`, "Margarita", 26000, 1, at(18, 10), id),
    item(`${id}-burger`, "Hamburguesa clásica", 29000, 1, at(18, 12), id),
    item(`${id}-mojito2`, "Mojito", 24000, 1, at(19, 40), id),
    item(`${id}-tres`, "Tres leches", 14000, 1, at(20, 5), id),
  ]
  const discounts: OrderDiscountDto[] = [
    {
      id: id === "o-1" ? "d-2x1" : `${id}-d-2x1`,
      kind: "promotion_item",
      source: "automatic",
      label: "Happy hour 2x1",
      amount: 24000,
      promotionId: "p-2x1",
      orderItemId: `${id}-mojito`,
      comboId: null,
      reason: null,
      authorizedBy: null,
    },
    {
      id: id === "o-1" ? "d-cortesia" : `${id}-d-cortesia`,
      kind: "manual_item",
      source: "manual",
      label: "Cortesía de cumpleaños",
      amount: 14000,
      promotionId: "p-cortesia",
      orderItemId: `${id}-tres`,
      comboId: null,
      reason: "Cumpleaños de la mesa",
      authorizedBy: { id: "s-paula", name: "Paula Rodríguez" },
    },
  ]
  return {
    id,
    orderNumber: 128,
    guests: 4,
    notes: null,
    tableId: "t-7",
    waiterId: "w-1",
    status: "kitchen",
    orderType: "dine_in",
    subtotal: 103000,
    tax: 8240,
    taxPercentage: 8,
    tip: 0,
    tipPercentage: 10,
    total: 111240,
    totalDiscounts: 38000,
    grossSubtotal: 141000,
    discounts,
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: at(17, 52),
    updatedAt: at(20, 5),
    items: items.map((line) => ({ ...line, discounts: discounts.filter((d) => d.orderItemId === line.id) })),
  } as OrderDto
}

export function promo(overrides: Partial<PromotionDto> = {}): PromotionDto {
  return {
    id: "p-cortesia",
    name: "Cortesía de cumpleaños",
    description: null,
    kind: "product_discount",
    mode: "manual_pin",
    discountType: "percentage",
    discountValue: 100,
    active: true,
    sentence: "Postre gratis · 1 por cuenta",
    maxUsesPerOrder: 1,
    ...overrides,
  } as PromotionDto
}
