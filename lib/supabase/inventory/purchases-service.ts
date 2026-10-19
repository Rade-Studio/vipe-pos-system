/**
 * Purchase orders. The admin writes headers and draft lines directly (RLS);
 * status moves draft -> ordered / cancelled by update (a trigger assigns the
 * number and `ordered_at`), and receiving goes through
 * `receive_purchase_order`, which also writes `received_quantity`.
 */

import { db, embeddedName, num, rpc, unwrap } from "./shared"
import type {
  CreatePurchaseOrderInput,
  PaymentStatus,
  PurchaseOrder,
  PurchaseOrderFilters,
  PurchaseOrderLine,
  PurchaseOrderLineInput,
  PurchaseOrderStatus,
  ReceiveLineInput,
  ReceivePurchaseResult,
} from "./types"

const COLUMNS =
  "id, number, supplier_id, location_id, status, expected_on, payment_status, notes, ordered_at, received_at, created_at, " +
  "suppliers(name), inventory_locations(name), " +
  "purchase_order_lines(id, ingredient_id, quantity, unit_cost, received_quantity, ingredients(name, unit, sku))"

interface LineRow {
  id: string
  ingredient_id: string
  quantity: number | string
  unit_cost: number | string
  received_quantity: number | string
  ingredients?: { name: string; unit: string; sku: string } | null
}

interface PurchaseOrderRow {
  id: string
  number: number
  supplier_id: string
  location_id: string
  status: string
  expected_on: string | null
  payment_status: string
  notes: string | null
  ordered_at: string | null
  received_at: string | null
  created_at: string
  suppliers?: { name: string } | null
  inventory_locations?: { name: string } | null
  purchase_order_lines?: LineRow[] | null
}

/** Rounded to cents so float noise never reaches a total. */
const money = (n: number) => Math.round(n * 100) / 100

const mapLine = (r: LineRow): PurchaseOrderLine => {
  const quantity = num(r.quantity)
  const unitCost = num(r.unit_cost)
  const receivedQuantity = num(r.received_quantity)
  return {
    id: r.id,
    itemId: r.ingredient_id,
    itemName: r.ingredients?.name ?? null,
    sku: r.ingredients?.sku ?? null,
    unit: r.ingredients?.unit ?? null,
    quantity,
    unitCost,
    receivedQuantity,
    pendingQuantity: Math.max(0, Math.round((quantity - receivedQuantity) * 1000) / 1000),
    total: money(quantity * unitCost),
  }
}

const mapPurchaseOrder = (r: PurchaseOrderRow): PurchaseOrder => {
  const lines = (r.purchase_order_lines ?? []).map(mapLine)
  return {
    id: r.id,
    number: r.number,
    supplierId: r.supplier_id,
    supplierName: embeddedName(r.suppliers),
    locationId: r.location_id,
    locationName: embeddedName(r.inventory_locations),
    status: r.status as PurchaseOrderStatus,
    expectedOn: r.expected_on,
    paymentStatus: r.payment_status as PaymentStatus,
    notes: r.notes,
    orderedAt: r.ordered_at,
    receivedAt: r.received_at,
    createdAt: r.created_at,
    lines,
    total: money(lines.reduce((sum, l) => sum + l.total, 0)),
  }
}

const toLineRow = (purchaseOrderId: string, line: PurchaseOrderLineInput) => ({
  purchase_order_id: purchaseOrderId,
  ingredient_id: line.itemId,
  quantity: line.quantity,
  unit_cost: line.unitCost,
})

/** Newest first. */
export async function listPurchaseOrders(filters: PurchaseOrderFilters = {}): Promise<PurchaseOrder[]> {
  let query = db.from("purchase_orders").select(COLUMNS)
  if (filters.status && filters.status.length > 0) query = query.in("status", filters.status)
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId)
  const rows = await unwrap<PurchaseOrderRow[] | null>(query.order("number", { ascending: false }))
  return (rows ?? []).map(mapPurchaseOrder)
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return mapPurchaseOrder(await unwrap<PurchaseOrderRow>(db.from("purchase_orders").select(COLUMNS).eq("id", id).single()))
}

/**
 * Draft header, then its lines. Two writes (no RPC exists for this): if the
 * lines insert fails the empty draft remains and the error is thrown.
 */
export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const header = await unwrap<{ id: string }>(
    db
      .from("purchase_orders")
      .insert({
        supplier_id: input.supplierId,
        location_id: input.locationId,
        expected_on: input.expectedOn ?? null,
        notes: input.notes ?? null,
        status: "draft",
      })
      .select("id")
      .single(),
  )
  if (input.lines.length > 0) {
    await unwrap(db.from("purchase_order_lines").insert(input.lines.map((l) => toLineRow(header.id, l))))
  }
  return getPurchaseOrder(header.id)
}

export async function updatePurchaseOrder(
  id: string,
  patch: { supplierId?: string; locationId?: string; expectedOn?: string | null; notes?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId
  if (patch.locationId !== undefined) row.location_id = patch.locationId
  if (patch.expectedOn !== undefined) row.expected_on = patch.expectedOn
  if (patch.notes !== undefined) row.notes = patch.notes
  await unwrap(db.from("purchase_orders").update(row).eq("id", id))
}

export async function setPurchaseOrderStatus(id: string, status: "ordered" | "cancelled"): Promise<void> {
  await unwrap(db.from("purchase_orders").update({ status }).eq("id", id))
}

export async function setPurchaseOrderPaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void> {
  await unwrap(db.from("purchase_orders").update({ payment_status: paymentStatus }).eq("id", id))
}

/** Only draft orders can be deleted (trigger). */
export async function deletePurchaseOrder(id: string): Promise<void> {
  await unwrap(db.from("purchase_orders").delete().eq("id", id))
}

export async function addPurchaseOrderLine(purchaseOrderId: string, line: PurchaseOrderLineInput): Promise<void> {
  await unwrap(db.from("purchase_order_lines").insert(toLineRow(purchaseOrderId, line)))
}

export async function updatePurchaseOrderLine(
  lineId: string,
  patch: { quantity?: number; unitCost?: number },
): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.quantity !== undefined) row.quantity = patch.quantity
  if (patch.unitCost !== undefined) row.unit_cost = patch.unitCost
  await unwrap(db.from("purchase_order_lines").update(row).eq("id", lineId))
}

export async function removePurchaseOrderLine(lineId: string): Promise<void> {
  await unwrap(db.from("purchase_order_lines").delete().eq("id", lineId))
}

export async function receivePurchaseOrder(
  purchaseOrderId: string,
  lines: ReceiveLineInput[],
): Promise<ReceivePurchaseResult> {
  const r = await rpc<Record<string, unknown>>("receive_purchase_order", {
    p_purchase_order_id: purchaseOrderId,
    p_lines: lines.map((l) => {
      const line: Record<string, unknown> = { line_id: l.lineId, quantity: l.quantity }
      if (l.unitCost !== undefined) line.unit_cost = l.unitCost
      if (l.lotCode !== undefined) line.lot_code = l.lotCode
      if (l.expiresOn !== undefined) line.expires_on = l.expiresOn
      return line
    }),
  })
  return {
    purchaseOrderId: r.purchase_order_id as string,
    status: r.status as PurchaseOrderStatus,
    receivedLines: num(r.received_lines),
    totalCost: num(r.total_cost),
  }
}
