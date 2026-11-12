import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"
import { isComboLine } from "@/lib/promotions/waiter"
import type { CartItem, Order, OrderItem, OrderStatus } from "@/types"

/**
 * Orders through the API (T8b). The server owns what the web used to split
 * with SQL: catalog pricing (a shown `unitPrice` that differs answers 409
 * `Price changed`), the stock check and consumption (409 `Insufficient stock`
 * unless `force`), the bill (`recompute_order_bill`), table status and every
 * timestamp.
 *
 * `toOrder` is the ONE mapper from the API shape to the domain `Order`; the
 * waiter, kitchen, cashier and admin screens and the order store all go
 * through it. Realtime rows (snake_case `pos_changes`) reach it through
 * `orderDtoFromWire`.
 */

type Schemas = components["schemas"]
export type OrderDto = Schemas["Order"]
export type OrderItemDto = Schemas["OrderItem"]
export type OrderItemInput = Schemas["OrderItemInput"]
/** S5: one combo line: the promotion and one dish per group. */
export type ComboLineInput = Schemas["ComboLineRequest"]
export type OrderDiscountDto = Schemas["OrderDiscount"]
export type StockShortage = Schemas["StockShortage"]
export type DishPrice = Schemas["DishPrice"]
/** F7: a line of the 409 `Price changed` body, sent only when the request had options. */
export interface LinePrice {
  index: number
  dishId: string
  unitPrice: number
}
/** PATCH /orders/:id: guests and/or the order note; null (or a blank note) clears. */
export type OrderDetails = Schemas["UpdateOrderDetailsRequest"]
/** F1: reason (fixed list), optional text and the supervisor authorization of a cancellation. */
export type CancelOrderBody = Schemas["CancelOrderRequest"]
export type VoidOrderItemsBody = Schemas["VoidOrderItemsRequest"]
export type CancelledOrderDto = Schemas["CancelledOrder"]

/** The contract marks the defaulted fields as required; the API does not. */
export type CreateOrderBody = Omit<Schemas["CreateOrderRequest"], "orderType" | "force"> & {
  orderType?: "dine_in"
  force?: boolean
}

/**
 * A domain item that also carries its dish (the API always sends it) and, with
 * stations (F6), its station; with promotions (S8) its discounts and combo, only
 * when it has them.
 */
export type ApiOrderItem = OrderItem & {
  dishId?: string
  stationId?: string
  discounts?: Pick<OrderDiscountDto, "id" | "kind" | "label" | "amount" | "promotionId" | "authorizedBy">[]
  comboId?: string
}

export const ORDER_INCLUDES = ["table", "waiter"] as const
export type OrderInclude = (typeof ORDER_INCLUDES)[number]

const ITEM_IMAGE = "/placeholder.svg?height=50&width=50"

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

const toDate = (value: string | null | undefined): Date | undefined => (value ? new Date(value) : undefined)

// ---- Mapping ----------------------------------------------------------------

function toOrderItem(item: OrderItemDto): ApiOrderItem {
  return {
    id: item.id,
    dishId: item.dishId ?? undefined,
    stationId: item.stationId ?? undefined,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    comments: item.comments ?? undefined,
    modifiers: item.modifiers?.length ? item.modifiers : undefined,
    categoryId: "",
    image: ITEM_IMAGE,
    status: item.status,
    addedAt: toDate(item.addedAt ?? item.createdAt),
    ...(item.discounts?.length
      ? {
          discounts: item.discounts.map(({ id, kind, label, amount, promotionId, authorizedBy }) => ({
            id,
            kind,
            label,
            amount,
            promotionId,
            authorizedBy,
          })),
        }
      : {}),
    ...(item.comboId ? { comboId: item.comboId } : {}),
  }
}

/** API order -> domain `Order`. Items keep the server order (oldest first). */
export function toOrder(dto: OrderDto): Order {
  return {
    id: dto.id,
    orderNumber: dto.orderNumber,
    guests: dto.guests ?? undefined,
    notes: dto.notes ?? undefined,
    tableId: dto.tableId ?? "",
    orderType: dto.orderType,
    items: dto.items.map(toOrderItem),
    status: dto.status,
    bill: {
      subtotal: dto.subtotal,
      tax: dto.tax,
      taxPercentage: dto.taxPercentage,
      tip: dto.tip,
      tipPercentage: dto.tipPercentage,
      total: dto.total,
      totalDiscounts: dto.totalDiscounts,
    },
    waiter: dto.waiterId ?? "",
    createdAt: toDate(dto.createdAt) ?? new Date(),
    isPartialOrder: dto.isPartialOrder,
    parentOrderId: dto.parentOrderId ?? undefined,
  }
}

type WireRow = Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === "string" ? value : null)
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0)

const STATION_SOURCES = ["dish", "category", "fallback"] as const

function itemDtoFromWire(row: WireRow): OrderItemDto {
  return {
    id: String(row.id),
    orderId: str(row.order_id),
    dishId: str(row.dish_id),
    name: String(row.name ?? ""),
    price: num(row.price),
    quantity: num(row.quantity) || 1,
    comments: str(row.comments),
    status: row.status === "served" ? "served" : "kitchen",
    stationId: str(row.station_id),
    stationSource: STATION_SOURCES.find((source) => source === row.station_source) ?? null,
    addedAt: str(row.added_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    // Realtime rows do not carry the snapshots or the discounts; the next read fills them.
    modifiers: [],
    discounts: [],
    promotionId: str(row.promotion_id),
    promotionName: null,
    comboId: str(row.combo_id),
  }
}

/**
 * A `pos_changes` orders row (snake_case, `order_items` attached by the API
 * listener) -> the API `Order` shape, so realtime rows go through `toOrder`
 * too. Null when the row lacks the id and status every consumer needs.
 */
export function orderDtoFromWire(row: unknown): OrderDto | null {
  if (row === null || typeof row !== "object") return null
  const wire = row as WireRow
  if (typeof wire.id !== "string" || !wire.id || typeof wire.status !== "string") return null
  const items = Array.isArray(wire.order_items) ? (wire.order_items as WireRow[]) : []
  return {
    id: wire.id,
    orderNumber: num(wire.order_number),
    guests: typeof wire.guests === "number" ? wire.guests : null,
    notes: str(wire.notes),
    tableId: str(wire.table_id),
    waiterId: str(wire.waiter_id),
    status: wire.status as OrderStatus,
    orderType: wire.order_type === "delivery" ? "delivery" : "dine_in",
    subtotal: num(wire.subtotal),
    tax: num(wire.tax),
    taxPercentage: num(wire.tax_percentage),
    tip: num(wire.tip),
    tipPercentage: num(wire.tip_percentage),
    total: num(wire.total),
    totalDiscounts: num(wire.total_discounts),
    // subtotal is the net base (S2).
    grossSubtotal: num(wire.subtotal) + num(wire.total_discounts),
    discounts: [],
    isPartialOrder: wire.is_partial_order === true,
    parentOrderId: str(wire.parent_order_id),
    createdAt: str(wire.created_at),
    updatedAt: str(wire.updated_at),
    items: items.map(itemDtoFromWire),
  }
}

/**
 * Cart lines -> order lines: the dish behind each cart id, the price the waiter
 * saw (the server answers 409 `Price changed` when it no longer holds), the
 * comments and, with F7, the chosen options as `modifiers: [{optionId}]`. A line with no dish cannot be priced, so it is refused here.
 */
export function orderItemsFromCart(cart: readonly CartItem[]): OrderItemInput[] {
  // S12: combo lines go in `combos` (combosFromCart).
  return cart.filter((item) => !isComboLine(item)).map((item) => {
    const dishId = dishIdFromCartItemId(item.id)
    if (!dishId) throw new Error(`El producto ${item.name} no corresponde a un plato del menú`)
    const line: OrderItemInput = { dishId, quantity: item.quantity, unitPrice: item.price, comments: item.comments || null }
    // F7: only lines with options carry the key, so plain lines go out as before.
    if (item.modifiers?.length) line.modifiers = item.modifiers.map(({ optionId }) => ({ optionId }))
    return line
  })
}

/** S5/S12: the cart's combo lines, one per unit, each choice with its group. */
export function combosFromCart(cart: readonly CartItem[]): ComboLineInput[] {
  return cart.flatMap((item) =>
    isComboLine(item)
      ? Array.from({ length: item.quantity }, () => ({
          comboPromotionId: item.combo.promotionId,
          choices: item.combo.choices.map(({ groupId, dishId }) => ({ groupId, dishId })),
        }))
      : [],
  )
}

// ---- 409 bodies -------------------------------------------------------------

export type OrderConflict =
  | { kind: "shortage"; shortages: StockShortage[] }
  | { kind: "priceChanged"; prices: DishPrice[]; lines?: LinePrice[] }
  | { kind: "openOrder"; orderId: string }

/** The 409 answers of `POST /orders` and `POST /orders/:id/items` the waiter acts on. */
export function orderConflictOf(error: unknown): OrderConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const { shortages, prices, orderId, lines } = error.body
  if (error.message === "Insufficient stock" && Array.isArray(shortages)) {
    return { kind: "shortage", shortages: shortages as StockShortage[] }
  }
  if (error.message === "Price changed" && Array.isArray(prices)) {
    const priced = { kind: "priceChanged" as const, prices: prices as DishPrice[] }
    return Array.isArray(lines) ? { ...priced, lines: lines as LinePrice[] } : priced
  }
  if (error.message === "Table has an open order" && typeof orderId === "string") {
    return { kind: "openOrder", orderId }
  }
  return null
}

// ---- Requests ---------------------------------------------------------------

/** Orders in any of `statuses`, newest first, in ONE request (the API caps at 500). */
export async function getByStatus(
  statuses: OrderStatus | readonly OrderStatus[],
  options: { include?: readonly OrderInclude[]; stationId?: string } = {},
): Promise<OrderDto[]> {
  const status = (Array.isArray(statuses) ? statuses : [statuses]).join(",")
  const query: Record<string, string> = { status }
  if (options.include?.length) query.include = options.include.join(",")
  // F6: only the orders with a line of this station, each with only those lines.
  if (options.stationId) query.stationId = options.stationId
  const { data } = await api.GET("/api/orders", { params: { query } })
  return required(data)
}

export async function getById(orderId: string): Promise<OrderDto> {
  const { data } = await api.GET("/api/orders/{id}", byId(orderId))
  return required(data)
}

/** Dine-in order in the kitchen: priced, billed and stock-checked by the server. */
export async function create(body: CreateOrderBody): Promise<OrderDto> {
  const { data } = await api.POST("/api/orders", { body: body as Schemas["CreateOrderRequest"] })
  return required(data)
}

/** New items on an open order; the order goes back to the kitchen. Guests and notes are set only when given. */
export async function addItemsToOrder(
  orderId: string,
  items: OrderItemInput[],
  options: { force?: boolean; combos?: ComboLineInput[] } & OrderDetails = {},
): Promise<OrderDto> {
  const body: Partial<Schemas["AddOrderItemsRequest"]> = { items }
  if (options.combos?.length) body.combos = options.combos
  if (options.force) body.force = true
  if (options.guests !== undefined) body.guests = options.guests
  if (options.notes !== undefined) body.notes = options.notes
  const { data } = await api.POST("/api/orders/{id}/items", {
    ...byId(orderId),
    body: body as Schemas["AddOrderItemsRequest"],
  })
  return required(data)
}

/** Guests and/or the note of an open order (409 `Order is closed` when paid or cancelled). */
export async function updateDetails(orderId: string, details: OrderDetails): Promise<OrderDto> {
  const { data } = await api.PATCH("/api/orders/{id}", { ...byId(orderId), body: details })
  return required(data)
}

/** Only `kitchen -> delivered`; payments close orders, not this. */
export async function updateStatus(orderId: string, status: "delivered"): Promise<OrderDto> {
  const { data } = await api.PATCH("/api/orders/{id}/status", { ...byId(orderId), body: { status } })
  return required(data)
}

/** Kitchen: items served. With no kitchen item left the order is delivered and its table served. */
export async function serveItems(orderId: string, itemIds: string[]): Promise<OrderDto> {
  const { data } = await api.POST("/api/orders/{id}/items/served", { ...byId(orderId), body: { itemIds } })
  return required(data)
}

/**
 * F1: the order is cancelled, never deleted (reason, actor, supervisor and
 * bill are stored) and the table freed when no other open order remains. A
 * supervisor authorization (`authorizeSupervisor`, action cancel_order) is
 * required when the order has items or payments; refusals carry a `code`
 * (`voidRefusalOf`): 403 authorization_required / authorization_invalid /
 * self_authorization_not_allowed, 409 order_paid / order_cancelled.
 */
export async function cancelOrder(orderId: string, body: CancelOrderBody): Promise<CancelledOrderDto> {
  const { data } = await api.POST("/api/orders/{id}/cancel", { ...byId(orderId), body })
  return required(data)
}

/** F1: voids units of lines (authorization void_item: every server line was sent); returns the order with the bill recomputed. */
export async function voidOrderItems(orderId: string, body: VoidOrderItemsBody): Promise<OrderDto> {
  const { data } = await api.POST("/api/orders/{id}/items/void", { ...byId(orderId), body })
  return required(data)
}

/** Admin: orders cancelled on `date` (YYYY-MM-DD, restaurant day) with the bill at that moment and who cancelled. */
export async function getCancelledOrders(date: string): Promise<CancelledOrderDto[]> {
  const { data } = await api.GET("/api/orders/cancelled", { params: { query: { date } } })
  return required(data)
}

/**
 * Old call kept: DELETE is now the same audited cancellation as `cancelOrder`.
 * Without a body only an order with nothing on it is cancelled; otherwise 403
 * authorization_required.
 */
export async function deleteOrder(orderId: string, body?: CancelOrderBody): Promise<void> {
  await api.DELETE("/api/orders/{id}", body ? { ...byId(orderId), body } : byId(orderId))
}
